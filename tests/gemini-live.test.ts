import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiLiveClient, liveSetup } from '../src-gemini/core/live-client';
import { DEFAULT_GEMINI_SETTINGS } from '../src-gemini/core/settings';
import * as live from '../src-gemini/entrypoints/offscreen/live-coordinator';
import { validateConnection } from '../src-gemini/core/validate';
import { classifyLiveClose, liveErrorMessage } from '../src-gemini/core/live-errors';

test('Live close classification separates quota, authentication, setup and transient failures', () => {
  assert.equal(classifyLiveClose(1008, 'Operation is not implemented, or supported, or enabled'), 'LiveConfigurationError');
  assert.equal(classifyLiveClose(1007, 'Invalid JSON payload received. Unknown name'), 'LiveConfigurationError');
  assert.equal(classifyLiveClose(1008, 'Requested entity was not found'), 'LiveConfigurationError');
  assert.equal(classifyLiveClose(1008, 'Permission denied'), 'AuthenticationError');
  assert.equal(classifyLiveClose(1008, 'RESOURCE_EXHAUSTED'), 'QuotaExceeded');
  assert.equal(classifyLiveClose(1011, 'Internal error encountered'), undefined);
  assert.equal(classifyLiveClose(1006, ''), undefined);
  assert.match(liveErrorMessage('LiveAudioError'), /capture/);
  assert.match(liveErrorMessage('CapturePermissionDenied'), /Chrome/);
  assert.match(liveErrorMessage('LiveConfigurationError'), /cấu hình/);
  assert.match(liveErrorMessage('ServiceUnavailable'), /Dịch vụ/);
});

test('Live model selection uses compatible translation or conversational setup', () => {
  const translation = liveSetup('gemini-3.5-live-translate-preview').setup;
  assert.ok('translationConfig' in translation.generationConfig);
  assert.equal(translation.generationConfig.translationConfig?.targetLanguageCode, 'vi');
  assert.equal('systemInstruction' in translation, false);
  for (const model of ['gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'custom-live']) {
    const setup = liveSetup(model).setup;
    assert.equal(setup.model, `models/${model}`);
    assert.equal('translationConfig' in setup.generationConfig, false);
    assert.match(setup.systemInstruction!.parts[0].text, /Vietnamese interpreter/);
    assert.ok('speechConfig' in setup.generationConfig);
    assert.equal(
      setup.generationConfig.speechConfig?.voiceConfig.prebuiltVoiceConfig.voiceName,
      'Kore',
    );
    assert.deepEqual(setup.inputAudioTranscription, {});
    assert.deepEqual(setup.outputAudioTranscription, {});
    assert.equal(setup.realtimeInputConfig?.automaticActivityDetection.silenceDurationMs, 500);
  }
  assert.equal('speechConfig' in translation.generationConfig, false);
  assert.equal('realtimeInputConfig' in translation, false);
  const selected = liveSetup('gemini-3.8-live', 'Aoede').setup;
  assert.ok('speechConfig' in selected.generationConfig);
  assert.equal(
    selected.generationConfig.speechConfig?.voiceConfig.prebuiltVoiceConfig.voiceName,
    'Aoede',
  );
});

class Socket {
  readyState = 0;
  bufferedAmount = 0;
  sent: string[] = [];
  closed = false;
  onopen: any;
  onmessage: any;
  onclose: any;
  onerror: any;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(value: unknown) {
    return this.onmessage?.({ data: JSON.stringify(value) });
  }
}

test('Live validation waits for setup, closes the socket and never calls REST', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Live must not call REST'); };
  try {
    for (const settings of [
      { mode: 'live' as const, textEnabled: true },
      { mode: 'live' as const, textEnabled: false },
      { mode: 'subtitles' as const, textEnabled: false },
    ]) {
      const socket = new Socket();
      const pending = validateConnection(
        { ...DEFAULT_GEMINI_SETTINGS, apiKey: 'secret', ...settings },
        (url) => {
          assert.match(url, /BidiGenerateContent/);
          return socket as any;
        },
      );
      socket.open();
      assert.equal(JSON.parse(socket.sent[0]).setup.model, `models/${DEFAULT_GEMINI_SETTINGS.liveModel}`);
      assert.equal(socket.closed, false);
      await socket.message({ setupComplete: {} });
      assert.deepEqual(await pending, { validated: true, provider: 'live' });
      assert.equal(socket.closed, true);
      assert.equal(socket.sent.length, 1, 'validation sends only setup, no audio or text turn');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Live validation reports sanitized key, quota and model errors and closes the socket', async () => {
  for (const [status, code] of [[403, 'AuthenticationError'], [429, 'QuotaExceeded'], [400, 'LiveConfigurationError']] as const) {
    const socket = new Socket();
    const pending = validateConnection(
      { ...DEFAULT_GEMINI_SETTINGS, apiKey: 'secret' },
      () => socket as any,
    );
    socket.open();
    await socket.message({ error: { code: status, message: 'secret raw error' } });
    await assert.rejects(pending, (error: any) => error.code === code && !error.message.includes('secret'));
    assert.equal(socket.closed, true);
  }
  await assert.rejects(validateConnection(DEFAULT_GEMINI_SETTINGS), (error: any) => error.code === 'MissingApiKey');
});
const output = {
  serverContent: {
    modelTurn: {
      parts: [
        {
          inlineData: {
            mimeType: 'audio/pcm;rate=24000',
            data: btoa('\x00\x01\x02\x03'),
          },
        },
      ],
    },
  },
};
function fixture(settings = {}) {
  const sockets: Socket[] = [],
    audio: ArrayBuffer[] = [],
    errors: string[] = [],
    ready: number[] = [],
    retries: number[] = [];
  const client = new GeminiLiveClient(
    { ...DEFAULT_GEMINI_SETTINGS, apiKey: 'secret', ...settings },
    {
      ready: () => ready.push(1),
      audio: (pcm) => audio.push(pcm),
      error: (code) => errors.push(code),
      reconnecting: (attempt) => retries.push(attempt),
      caption() {},
      interrupted() {},
    },
    () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as any;
    },
  );
  client.connect();
  sockets[0].open();
  return { client, sockets, audio, errors, ready, retries };
}

test('selected Live voice is sent again after pause/resume', () => {
  const f = fixture({ liveModel: 'gemini-3.8-live', ttsVoice: 'Aoede' });
  try {
    f.client.pause();
    f.client.resume();
    f.sockets[1].open();
    for (const socket of f.sockets) {
      const setup = JSON.parse(socket.sent[0]).setup;
      assert.equal(
        setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
        'Aoede',
      );
    }
  } finally {
    f.client.stop();
  }
});

test('Gemini setup gates input and output; PCM input uses 16k JSON base64 and Blob output decodes', async () => {
  const f = fixture();
  try {
    const socket = f.sockets[0],
      pcm = new Uint8Array([0, 128, 255, 127]).buffer;
    assert.equal(
      JSON.parse(socket.sent[0]).setup.model,
      `models/${DEFAULT_GEMINI_SETTINGS.liveModel}`,
    );
    const setup = JSON.parse(socket.sent[0]).setup;
    assert.deepEqual(setup.inputAudioTranscription, {});
    assert.deepEqual(setup.outputAudioTranscription, {});
    assert.equal('inputAudioTranscription' in setup.generationConfig, false);
    assert.equal(setup.generationConfig.translationConfig.targetLanguageCode, 'vi');
    f.client.sendAudio(pcm);
    await socket.message(output);
    assert.equal(socket.sent.length, 1);
    assert.equal(f.audio.length, 0);
    await socket.onmessage({
      data: new Blob([JSON.stringify({ setupComplete: {} })]),
    });
    f.client.sendAudio(pcm);
    const input = JSON.parse(socket.sent[1]).realtimeInput.audio;
    assert.equal(input.mimeType, 'audio/pcm;rate=16000');
    assert.deepEqual(
      [...Uint8Array.from(atob(input.data), (c) => c.charCodeAt(0))],
      [0, 128, 255, 127],
    );
    await socket.onmessage({ data: new Blob([JSON.stringify(output)]) });
    assert.deepEqual([...new Uint8Array(f.audio[0])], [0, 1, 2, 3]);
    assert.equal(f.ready.length, 1);
  } finally {
    f.client.stop();
  }
});
test('transient socket failures retry at most three times before becoming terminal', () => {
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let next = 0;
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    timers.set(++next, { callback, delay });
    return next;
  }) as any;
  globalThis.clearTimeout = ((id: number) => timers.delete(id)) as any;
  const f = fixture();
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const socket = f.sockets.at(-1)!;
      socket.onclose({ code: 1006, reason: '' });
      if (attempt < 3) {
        const retry = [...timers.values()].find((timer) => timer.delay < 3000)!;
        assert.ok(retry);
        retry.callback();
        f.sockets.at(-1)!.open();
      }
    }
    assert.deepEqual(f.retries, [1, 2, 3]);
    assert.deepEqual(f.errors, ['GeminiDisconnected']);
    assert.equal(f.sockets.length, 4);
  } finally {
    f.client.stop();
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});

test('malformed JSON/audio and authentication/quota failures terminate without reconnect', async () => {
  const cases: Array<[any, string]> = [
    ['{', 'InvalidServerMessage'],
    [
      {
        serverContent: {
          modelTurn: {
            parts: [
              {
                inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AA==' },
              },
            ],
          },
        },
      },
      'InvalidServerMessage',
    ],
    [
      {
        serverContent: {
          modelTurn: {
            parts: [
              {
                inlineData: { mimeType: 'audio/pcm;rate=16000', data: 'AAAA' },
              },
            ],
          },
        },
      },
      'InvalidServerMessage',
    ],
    [
      {
        serverContent: {
          modelTurn: {
            parts: [
              {
                inlineData: { mimeType: 'audio/pcm;rate=24000', data: '!!!!' },
              },
            ],
          },
        },
      },
      'InvalidServerMessage',
    ],
    [{ error: { code: 401 } }, 'AuthenticationError'],
    [{ error: { code: 403 } }, 'AuthenticationError'],
    [{ error: { code: 429 } }, 'QuotaExceeded'],
    [{ error: { code: 500 } }, 'ServiceUnavailable'],
  ];
  for (const [message, expected] of cases) {
    const f = fixture();
    try {
      await f.sockets[0].message({ setupComplete: {} });
      if (typeof message === 'string') await f.sockets[0].onmessage({ data: message });
      else await f.sockets[0].message(message);
      assert.deepEqual(f.errors, [expected]);
      assert.deepEqual(f.retries, []);
      assert.equal(f.sockets[0].closed, true);
      f.client.resume();
      assert.equal(f.sockets.length, 1);
    } finally {
      f.client.stop();
    }
  }
});

test('invalid Live socket setup fails immediately without misleading network retries', () => {
  const f = fixture();
  try {
    f.sockets[0].onclose({ code: 1007, reason: 'Invalid JSON payload received. Unknown name' });
    assert.deepEqual(f.errors, ['LiveConfigurationError']);
    assert.deepEqual(f.retries, []);
  } finally {
    f.client.stop();
  }
});

test('pause/resume rejects delayed Blob setup and audio from the previous socket generation', async () => {
  for (const message of [{ setupComplete: {} }, output]) {
    const f = fixture();
    try {
      await f.sockets[0].message({ setupComplete: {} });
      let resolve!: (value: string) => void;
      const delayed = new Blob();
      delayed.text = () =>
        new Promise<string>((r) => {
          resolve = r;
        });
      const pending = f.sockets[0].onmessage({ data: delayed });
      f.client.pause();
      assert.equal(f.sockets[0].closed, true);
      f.client.resume();
      f.sockets[1].open();
      resolve(JSON.stringify(message));
      await pending;
      assert.equal(f.ready.length, 1);
      assert.equal(f.audio.length, 0);
      f.client.sendAudio(new ArrayBuffer(2));
      assert.equal(f.sockets[1].sent.length, 1);
      await f.sockets[1].message({ setupComplete: {} });
      await f.sockets[1].message(output);
      assert.equal(f.audio.length, 1);
    } finally {
      f.client.stop();
    }
  }
});

test('coordinator pause/seek flush playback, replace sockets, retain capture and respect owner stop', async () => {
  const events: any[] = [];
  const names = ['chrome', 'navigator', 'AudioContext', 'AudioWorkletNode', 'WebSocket'];
  const saved = names.map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  const sockets: Socket[] = [],
    sources: any[] = [],
    contexts: any[] = [],
    worklets: any[] = [];
  let captures = 0,
    stopped = 0;
  let releaseCapture!: () => void;
  let captureStarted!: () => void;
  const captureGate = new Promise<void>((resolve) => { releaseCapture = resolve; });
  const captureRequested = new Promise<void>((resolve) => { captureStarted = resolve; });
  const track = {
    onended: null,
    stop() {
      stopped++;
    },
  };
  class Context {
    state = 'running';
    currentTime = 1;
    sampleRate = 48000;
    destination = {};
    audioWorklet = { addModule: async () => {} };
    constructor() {
      contexts.push(this);
    }
    async resume() {}
    async close() {
      this.state = 'closed';
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createMediaStreamDestination() {
      return { disconnect() {} };
    }
    createBuffer(_channels: number, length: number, rate: number) {
      return {
        duration: length / rate,
        getChannelData: () => new Float32Array(length),
      };
    }
    createBufferSource() {
      const source = {
        buffer: null,
        onended: null,
        stopped: false,
        connect() {},
        disconnect() {},
        start() {},
        stop() {
          this.stopped = true;
        },
      };
      sources.push(source);
      return source;
    }
  }
  class Worklet {
    port = { onmessage: null as any, close() {} };
    constructor() {
      worklets.push(this);
    }
    connect() {}
    disconnect() {}
  }
  const mocks: Record<string, any> = {
    WebSocket: class extends Socket {
      static OPEN = 1;
      constructor() {
        super();
        sockets.push(this);
      }
    },
    AudioContext: Context,
    AudioWorkletNode: Worklet,
    navigator: {
      mediaDevices: {
        getUserMedia: async (constraints: any) => {
          captures++;
          assert.deepEqual(Object.keys(constraints.audio), ['mandatory']);
          captureStarted();
          await captureGate;
          return { getTracks: () => [track] };
        },
      },
    },
    chrome: {
      storage: {
        local: {
          setAccessLevel: async (value: any) => assert.equal(value.accessLevel, 'TRUSTED_CONTEXTS'),
          get: async () => ({ geminiSettings: { apiKey: 'secret' } }),
        },
      },
      runtime: {
        getURL: (path: string) => path,
        sendMessage: async (message: any) => {
          events.push(message);
        },
      },
    },
  };
  names.forEach((name) =>
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: mocks[name],
    }),
  );
  try {
    const starting = live.start({
          tabId: 42,
          streamId: 'capture',
          sessionId: 'session',
        });
    await captureRequested;
    assert.equal(sockets.length, 1, 'Gemini handshake starts while Chrome capture is pending');
    sockets[0].open();
    await sockets[0].message({ setupComplete: {} });
    assert.equal(events.some((event) => event.event === 'ready'), false,
      'video must stay held until both Gemini and capture are ready');
    await sockets[0].message(output);
    assert.equal(sources.length, 0);
    releaseCapture();
    assert.equal((await starting).ok, true);
    assert.equal(live.state().state, 'active');
    assert.equal(events.filter((event) => event.event === 'ready').length, 1);
    worklets[0].port.onmessage({ data: new Float32Array(1920).fill(0.2).buffer });
    assert.equal(sockets[0].sent.length, 2, '40 ms capture sends a packet without waiting for 100 ms');
    assert.equal(atob(JSON.parse(sockets[0].sent[1]).realtimeInput.audio.data).length, 1280);
    await sockets[0].message({
      serverContent: {
        inputTranscription: { text: 'Hello there.' },
        outputTranscription: { text: 'Xin chào.' },
      },
    });
    const caption = events.find((event) => event.event === 'transcript');
    assert.equal(
      caption.type,
      'live-event',
      'transcript payload must not override the runtime routing type',
    );
    assert.equal(caption.tabId, 42);
    assert.equal(caption.sessionId, 'session');
    assert.equal(caption.original, 'Hello there.');
    assert.equal(caption.translation, 'Xin chào.');
    assert.equal(caption.complete, false);
    await sockets[0].message(output);
    assert.equal(sources.length, 1);
    assert.ok(live.state().timings?.['first-input-sent'] !== undefined);
    assert.ok(live.state().timings?.['first-output-received'] !== undefined);
    assert.ok(live.state().timings?.['playback-scheduled'] !== undefined);
    live.pause({ tabId: 42 });
    assert.equal(sources[0].stopped, true);
    assert.equal(sockets[0].closed, true);
    assert.equal(sockets.length, 2);
    sockets[1].open();
    await sockets[1].message({ setupComplete: {} });
    assert.equal(live.state().state, 'paused');
    const readyEvents = events.filter((event) => event.event === 'ready').length;
    worklets[0].port.onmessage({ data: new Float32Array(4800).buffer });
    assert.equal(
      sockets[1].sent.length,
      1,
      'paused capture must not send audio to the prepared session',
    );
    await sockets[1].message(output);
    assert.equal(sources.length, 1, 'prepared session must not play output while paused');
    live.resume({ tabId: 42 });
    assert.equal(sockets.length, 2, 'resume must reuse the fresh prepared socket');
    assert.equal(
      live.state().state,
      'active',
      'prepared setup avoids another handshake after resume',
    );
    assert.equal(events.filter((event) => event.event === 'ready').length, readyEvents + 1);
    await sockets[1].message(output);
    live.seek({ tabId: 42 });
    assert.equal(sources[1].stopped, true);
    live.seek({ tabId: 42, complete: true, paused: false });
    assert.equal(sockets.length, 3);
    assert.equal(captures, 1);
    assert.equal(stopped, 0);
    assert.equal((await live.stop({ tabId: 99 })).stopped, false);
    assert.equal(stopped, 0);
    assert.equal((await live.stop({ tabId: 42 })).stopped, true);
    assert.equal(stopped, 1);
    assert.equal(contexts[0].state, 'closed');
    assert.equal(worklets[0].port.onmessage, null);
    assert.equal(track.onended, null);
  } finally {
    await live.stop();
    saved.forEach(([name, descriptor]) =>
      descriptor
        ? Object.defineProperty(globalThis, name, descriptor)
        : Reflect.deleteProperty(globalThis, name),
    );
  }
});
