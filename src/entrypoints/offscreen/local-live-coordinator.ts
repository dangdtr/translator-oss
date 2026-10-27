import {
  OUTPUT_RATE,
  MAX_OUTPUT_SECONDS,
  PLAYBACK_LEAD_SECONDS,
  SCHEDULE_AHEAD_SECONDS,
  downsampleTo16k,
  ownsLiveSession,
  appendSamples,
} from '../../core/live-audio';
import { LTLog } from '../../core/logger';
import { encodeLiveAudio, decodeLiveAudio } from '../../core/live-protocol';

interface LiveSession {
  run: number;
  tabId: number;
  websocketUrl: string;
  state: string;
  paused: boolean;
  closed: boolean;
  input: Float32Array;
  inputBytes: number;
  outputBytes: number;
  outputQueue: Array<{ data: ArrayBuffer; duration: number }>;
  queuedSeconds: number;
  outputSources: Set<AudioBufferSourceNode>;
  nextPlaybackAt: number;
  playbackTimer: any;
  readyTimer: ReturnType<typeof setTimeout> | null;
  sessionId: string;
  epoch: number;
  inputSequence: number;
  outputSequence: number;
  requestSequence: number;
  lastMetricsAt: number;
  sendAudio?: (data: ArrayBuffer) => void;
  context: AudioContext | null;
  socket: WebSocket | null;
  stream: MediaStream | null;
  source?: MediaStreamAudioSourceNode;
  processor?: AudioWorkletNode;
  sink?: MediaStreamAudioDestinationNode;
}

let live: LiveSession | null = null;
let generation = 0;

function notify(event: string, fields: Record<string, unknown> = {}): void {
  chrome.runtime
    .sendMessage({ type: 'live-event', event, ...fields })
    .catch(() => {});
}

function notifySession(session: LiveSession, event: string, fields: Record<string, unknown> = {}): void {
  notify(event, { ...fields, tabId: session.tabId, sessionId: session.sessionId, epoch: session.epoch });
}

function errorCode(error: any): string {
  return error?.name || error?.code || 'LiveAudioError';
}

function pumpOutput(session: LiveSession): void {
  if (live !== session || !session.context || session.context.state === 'closed' || session.paused) {
    return;
  }
  const now = session.context.currentTime;
  session.nextPlaybackAt = Math.max(session.nextPlaybackAt, now + PLAYBACK_LEAD_SECONDS);
  while (
    session.outputQueue.length &&
    session.nextPlaybackAt - now < SCHEDULE_AHEAD_SECONDS
  ) {
    const item = session.outputQueue.shift();
    if (!item) break;
    session.queuedSeconds -= item.duration;
    const pcm = new Int16Array(item.data);
    const buffer = session.context.createBuffer(1, pcm.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) {
      channel[i] = pcm[i] / (pcm[i] < 0 ? 32768 : 32767);
    }
    const source = session.context.createBufferSource();
    source.buffer = buffer;
    source.connect(session.context.destination);
    session.outputSources.add(source);
    source.onended = () => {
      session.outputSources.delete(source);
      source.disconnect();
    };
    source.start(session.nextPlaybackAt);
    session.nextPlaybackAt += buffer.duration;
  }
}

function enqueueOutput(session: LiveSession, data: ArrayBuffer): void {
  if (!data.byteLength || session.paused) return;
  const duration = data.byteLength / 2 / OUTPUT_RATE;
  if (session.queuedSeconds + duration > MAX_OUTPUT_SECONDS) {
    void fail(session, 'OutputBackpressure');
    return;
  }
  session.outputQueue.push({ data, duration });
  session.queuedSeconds += duration;
  session.outputBytes += data.byteLength;
  pumpOutput(session);
}

function clearOutput(session: LiveSession): void {
  session.outputQueue = [];
  session.queuedSeconds = 0;
  for (const source of session.outputSources) {
    source.onended = null;
    try {
      source.stop();
    } catch {}
    source.disconnect();
  }
  session.outputSources.clear();
  session.nextPlaybackAt = session.context?.currentTime || 0;
}

async function cleanup(session: LiveSession | null): Promise<void> {
  if (!session) return;
  session.closed = true;
  clearInterval(session.playbackTimer);
  if (session.readyTimer) clearTimeout(session.readyTimer);
  if (session.processor?.port) {
    session.processor.port.onmessage = null;
    session.processor.port.close();
  }
  session.processor?.disconnect();
  session.source?.disconnect();
  session.sink?.disconnect();
  clearOutput(session);
  for (const track of session.stream?.getTracks() || []) {
    track.onended = null;
    track.stop();
  }
  if (session.socket) {
    session.socket.onopen =
      session.socket.onmessage =
      session.socket.onerror =
      session.socket.onclose =
        null;
    if (session.socket.readyState < WebSocket.CLOSING) {
      session.socket.close(1000, 'stopped');
    }
  }
  if (session.context && session.context.state !== 'closed') {
    await session.context.close().catch(() => {});
  }
  if (live === session) live = null;
}

async function fail(session: LiveSession, code: string): Promise<void> {
  if (live !== session || session.closed) return;
  LTLog('live.error', { error: code }, 'error');
  await cleanup(session);
  notifySession(session, 'error', { code });
}

function connectSocket(session: LiveSession): void {
  if (live !== session || session.closed) return;
  const socket = (session.socket = new WebSocket(session.websocketUrl));
  waitForReady(session);
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => {
    sendControl(session, 'start');
  };
  session.sendAudio = data => {
    socket.send(encodeLiveAudio(session.epoch, session.inputSequence++, data));
  };
  socket.onmessage = async (event: MessageEvent) => {
    if (live !== session || session.closed || session.socket !== socket) return;
    if (typeof event.data === 'string') {
      let message: any;
      try {
        message = JSON.parse(event.data);
      } catch {
        return void fail(session, 'InvalidServerMessage');
      }
      if (message.type === 'ready' || (message.type === 'error' && !message.sessionId)) {
        return void fail(session, 'ProtocolVersionMismatch');
      }
      if (message.sessionId !== session.sessionId || message.epoch !== session.epoch) return;
      if (message.type === 'state' && message.state === 'ready' && !session.paused) {
        if (session.readyTimer) clearTimeout(session.readyTimer);
        session.state = 'active';
        appendSamples(session as any, new Float32Array());
        notifySession(session, 'ready');
      } else if (message.type === 'state' && message.state === 'paused') {
        session.state = 'paused';
        notifySession(session, 'paused');
      } else if (message.type === 'state' && ['connecting', 'reconnecting'].includes(message.state)) {
        session.state = 'connecting';
        session.input = new Float32Array();
        clearOutput(session);
        notifySession(session, 'reconnecting', { attempt: message.attempt || 0 });
      } else if (message.type === 'caption' && !session.paused && session.state === 'active') {
        notifySession(session, 'transcript', {
          tabId: session.tabId,
          original: typeof message.original === 'string' ? message.original : undefined,
          translation:
            typeof message.translation === 'string' ? message.translation : undefined,
          complete: message.complete === true,
        });
      } else if (message.type === 'error') {
        fail(session, message.code || 'LiveAPIError');
      }
      return;
    }
    const data =
      event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
    if (
      live === session &&
      !session.closed &&
      session.socket === socket &&
      data instanceof ArrayBuffer
    ) {
      try {
        const frame = decodeLiveAudio(data);
        if (frame.epoch !== session.epoch || frame.sequence <= session.outputSequence ||
            session.paused || session.state !== 'active') return;
        session.outputSequence = frame.sequence;
        enqueueOutput(session, frame.pcm);
      } catch {
        fail(session, 'InvalidLiveAudioFrame');
      }
    }
  };
  socket.onerror = () => LTLog('live.local-connection-failed');
  socket.onclose = event => {
    if (session.closed || session.socket !== socket) return;
    if (event.code === 1008) return void fail(session, 'Unauthorized');
    fail(session, 'BackendDisconnected');
  };
}

function sendControl(session: LiveSession, type: string): void {
  if (session.socket?.readyState !== WebSocket.OPEN) return;
  session.socket.send(JSON.stringify({ type, protocolVersion: 2,
    sessionId: session.sessionId, epoch: session.epoch,
    requestId: String(++session.requestSequence), paused: session.paused }));
}

function resetLocal(session: LiveSession): void {
  session.epoch++;
  session.inputSequence = 0;
  session.outputSequence = -1;
  session.input = new Float32Array();
  clearOutput(session);
  waitForReady(session);
}

function waitForReady(session: LiveSession): void {
  if (session.readyTimer) clearTimeout(session.readyTimer);
  session.readyTimer = session.paused ? null : setTimeout(() => {
    void fail(session, 'LiveReadyTimeout');
  }, 35000);
}

export async function start({
  tabId,
  streamId,
  websocketUrl,
  sessionId = crypto.randomUUID(),
}: {
  tabId: number;
  streamId: string;
  websocketUrl: string;
  sessionId?: string;
}): Promise<any> {
  if (!streamId || !websocketUrl) {
    return { ok: false, state: 'idle', error: 'InvalidLiveConfig' };
  }
  if (live) await cleanup(live);
  const run = ++generation;
  const session: LiveSession = {
    run,
    tabId,
    websocketUrl,
    state: 'connecting',
    paused: false,
    closed: false,
    input: new Float32Array(),
    inputBytes: 0,
    outputBytes: 0,
    outputQueue: [],
    queuedSeconds: 0,
    outputSources: new Set(),
    nextPlaybackAt: 0,
    playbackTimer: null,
    readyTimer: null,
    sessionId,
    epoch: 0,
    inputSequence: 0,
    outputSequence: -1,
    requestSequence: 0,
    lastMetricsAt: 0,
    context: null,
    socket: null,
    stream: null,
  };
  live = session;

  try {
    session.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as any,
      video: false,
    });
    if (live !== session || run !== generation) {
      await cleanup(session);
      return { ok: false, state: 'idle', error: 'Superseded' };
    }
    for (const track of session.stream.getTracks()) {
      track.onended = () => fail(session, 'CaptureEnded');
    }

    session.context = new AudioContext();
    await session.context.resume();
    await session.context.audioWorklet.addModule(
      chrome.runtime.getURL('live-capture-worklet.js'),
    );
    if (live !== session || run !== generation) {
      await cleanup(session);
      return { ok: false, state: 'idle', error: 'Superseded' };
    }
    session.source = session.context.createMediaStreamSource(session.stream);
    session.processor = new AudioWorkletNode(session.context, 'live-capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    session.sink = session.context.createMediaStreamDestination();
    session.source.connect(session.processor);
    session.processor.connect(session.sink);
    connectSocket(session);
    session.processor.port.onmessage = event => {
      if (live !== session || session.closed || session.paused || session.state !== 'active' || !session.context) return;
      if ((session.socket?.bufferedAmount || 0) > 64000) {
        void fail(session, 'InputBackpressure');
        return;
      }
      appendSamples(
        session as any,
        downsampleTo16k(new Float32Array(event.data), session.context.sampleRate),
      );
    };
    session.playbackTimer = setInterval(() => {
      pumpOutput(session);
      if (session.socket?.readyState === WebSocket.OPEN && Date.now() - session.lastMetricsAt > 5000) {
        session.lastMetricsAt = Date.now();
        session.socket.send(JSON.stringify({ type: 'playback_status', sessionId: session.sessionId,
          epoch: session.epoch, requestId: String(++session.requestSequence),
          queuedSeconds: session.queuedSeconds + Math.max(0, session.nextPlaybackAt - (session.context?.currentTime || 0)) }));
      }
    }, 25);
    return { ok: true, state: session.state };
  } catch (error: any) {
    const code = errorCode(error);
    await cleanup(session);
    LTLog('live.start-failed', { error: code }, 'error');
    notifySession(session, 'error', { code });
    return { ok: false, state: 'idle', error: code };
  }
}

export async function stop({ tabId }: { tabId?: number } = {}): Promise<any> {
  const session = live;
  if (!ownsLiveSession(session, tabId)) {
    return {
      ok: true,
      state: session?.state || 'idle',
      tabId: session?.tabId,
      stopped: false,
    };
  }
  generation++;
  if (session) sendControl(session, 'stop');
  await cleanup(session);
  return { ok: true, state: 'idle', stopped: Boolean(session) };
}

export async function pause({ tabId }: { tabId?: number } = {}): Promise<any> {
  const session = live;
  if (!session || !ownsLiveSession(session, tabId) || session.closed) {
    return { ok: true, paused: false };
  }
  session.paused = true;
  session.state = 'paused';
  resetLocal(session);
  sendControl(session, 'pause');
  return { ok: true, paused: true, epoch: session.epoch, sessionId: session.sessionId };
}

export async function resume({ tabId }: { tabId?: number } = {}): Promise<any> {
  const session = live;
  if (!session || !ownsLiveSession(session, tabId) || session.closed) {
    return { ok: true, paused: false };
  }
  session.paused = false;
  session.state = 'connecting';
  resetLocal(session);
  sendControl(session, 'resume');
  if (session.context && session.context.state === 'suspended') {
    await session.context.resume().catch(() => {});
  }
  return { ok: true, paused: false, epoch: session.epoch, sessionId: session.sessionId };
}

export function seek({ tabId, complete = false, paused = true }: {
  tabId?: number; complete?: boolean; paused?: boolean;
} = {}): { ok: boolean; epoch?: number; sessionId?: string } {
  const session = live;
  if (!session || !ownsLiveSession(session, tabId) || session.closed) return { ok: true };
  session.state = 'connecting';
  session.paused = !complete || paused;
  resetLocal(session);
  sendControl(session, 'seek');
  return { ok: true, epoch: session.epoch, sessionId: session.sessionId };
}

export function state(): Record<string, unknown> {
  return {
    ok: true,
    state: live?.paused ? 'paused' : live?.state || 'idle',
    tabId: live?.tabId,
    paused: Boolean(live?.paused),
    epoch: live?.epoch,
    sessionId: live?.sessionId,
  };
}

export const liveHandlers = {
  start,
  stop,
  pause,
  resume,
  seek,
  state,
};
