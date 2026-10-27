import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeLiveAudio, decodeLiveAudio } from '../src/core/live-protocol';
import * as live from '../src/entrypoints/offscreen/live-coordinator';

test('audio framing preserves PCM and rejects truncated or odd frames', () => {
  const pcm = new Int16Array([-300, 200]).buffer;
  const decoded = decodeLiveAudio(encodeLiveAudio(8, 12, pcm));
  assert.equal(decoded.epoch, 8);
  assert.equal(decoded.sequence, 12);
  assert.deepEqual(new Int16Array(decoded.pcm), new Int16Array(pcm));
  assert.throws(() => decodeLiveAudio(new ArrayBuffer(9)));
});

test('pause/seek stop scheduled audio, discard stale output, and preserve local capture/socket', async () => {
  const globals = ['chrome', 'navigator', 'AudioContext', 'AudioWorkletNode', 'WebSocket'];
  const saved = globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const sources: any[] = [];
  const sockets: any[] = [];
  const events: any[] = [];
  let tracksStopped = 0;
  let captures = 0;
  class Socket {
    static OPEN = 1;
    static CLOSING = 2;
    readyState = 0;
    bufferedAmount = 0;
    sent: any[] = [];
    onopen: any;
    onmessage: any;
    onclose: any;
    onerror: any;
    constructor() { sockets.push(this); }
    send(data: any) { this.sent.push(data); }
    close() { this.readyState = 3; }
  }
  class Context {
    state = 'running';
    currentTime = 1;
    sampleRate = 48000;
    destination = {};
    audioWorklet = { addModule: async () => {} };
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createMediaStreamDestination() { return { disconnect() {} }; }
    createBuffer(_channels: number, length: number, rate: number) {
      return { duration: length / rate, getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start() {}, stopped: false,
        stop() { this.stopped = true; }, onended: null, buffer: null };
      sources.push(source);
      return source;
    }
  }
  class Worklet {
    port = { onmessage: null, close() {} };
    connect() {}
    disconnect() {}
  }
  const mocks: Record<string, any> = {
    WebSocket: Socket, AudioContext: Context, AudioWorkletNode: Worklet,
    chrome: { runtime: { getURL: (path: string) => path,
      sendMessage: async (message: any) => { events.push(message); } } },
    navigator: { mediaDevices: { getUserMedia: async () => {
      captures++;
      return { getTracks: () => [{ onended: null, stop: () => tracksStopped++ }] };
    } } },
  };
  for (const name of globals) Object.defineProperty(globalThis, name, { configurable: true, value: mocks[name] });
  try {
    await live.start({ tabId: 42, streamId: 'capture', websocketUrl: 'ws://local', sessionId: 'test' });
    const socket = sockets[0];
    socket.readyState = 1;
    socket.onopen();
    const command = () => JSON.parse(socket.sent.at(-1));
    assert.equal(command().protocolVersion, 2);
    const ready = async (epoch: number) => socket.onmessage({ data: JSON.stringify({
      type: 'state', state: 'ready', epoch, sessionId: 'test',
    }) });
    const audio = async (epoch: number, seq = 0) => socket.onmessage({
      data: encodeLiveAudio(epoch, seq, new Int16Array(2400).buffer),
    });
    await ready(0);
    await audio(0);
    assert.equal(sources.length, 1);
    await live.pause({ tabId: 42 });
    assert.equal(command().type, 'pause');
    assert.equal(command().epoch, 1);
    assert.equal(sources[0].stopped, true);
    await audio(0, 1);
    assert.equal(sources.length, 1);
    await live.resume({ tabId: 42 });
    assert.equal(command().type, 'resume');
    await ready(1); // stale ready must not activate a new epoch
    assert.equal(live.state().state, 'connecting');
    await ready(2);
    await audio(2);
    assert.equal(sources.length, 2);
    await live.seek({ tabId: 42, complete: false });
    assert.equal(sources[1].stopped, true);
    assert.equal(command().paused, true);
    await live.seek({ tabId: 42, complete: true, paused: false });
    await ready(4);
    await audio(2, 2);
    await audio(4);
    await audio(4); // duplicate sequence
    assert.equal(sources.length, 3);
    assert.equal(captures, 1);
    assert.equal(sockets.length, 1);
    assert.equal(tracksStopped, 0);
    await live.stop({ tabId: 99 });
    assert.equal(tracksStopped, 0);
    await live.stop({ tabId: 42 });
    assert.equal(tracksStopped, 1);
    assert.ok(events.some(e => e.event === 'ready' && e.epoch === 4));
  } finally {
    await live.stop({ tabId: 42 });
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
