import {
  appendSamples,
  downsampleTo16k,
  OUTPUT_RATE,
  MAX_OUTPUT_SECONDS,
  PLAYBACK_LEAD_SECONDS,
  SCHEDULE_AHEAD_SECONDS,
} from '../../core/live-audio';
import { loadSettings } from '../../gemini/settings';
import { GeminiLiveClient } from '../../gemini/live-client';
import { LTLog } from '../../core/logger';

interface Session {
  tabId: number;
  sessionId: string;
  epoch: number;
  state: string;
  paused: boolean;
  captureReady: boolean;
  socketReady: boolean;
  startedAt: number;
  timings: Record<string, number>;
  inputChunkSamples: number;
  closed: boolean;
  input: Float32Array;
  inputBytes: number;
  sendAudio(data: ArrayBuffer): void;
  context: AudioContext | null;
  stream: MediaStream | null;
  source?: MediaStreamAudioSourceNode;
  processor?: AudioWorkletNode;
  sink?: MediaStreamAudioDestinationNode;
  client: GeminiLiveClient | null;
  socket: { readyState: number; bufferedAmount: number; send(data: ArrayBuffer): void };
  output: Array<{ pcm: ArrayBuffer; duration: number }>;
  sources: Set<AudioBufferSourceNode>;
  queued: number;
  nextAt: number;
  timer: ReturnType<typeof setInterval> | null;
}
let live: Session | null = null;
let generation = 0;
const owns = (session: Session | null, tabId?: number): boolean =>
  Boolean(session && (tabId === undefined || session.tabId === tabId));

function notify(session: Session, event: string, fields: Record<string, unknown> = {}) {
  void chrome.runtime
    .sendMessage({
      ...fields,
      // Payloads (including Transcript's `type: caption`) must never replace
      // the trusted routing and session envelope.
      type: 'live-event',
      event,
      tabId: session.tabId,
      sessionId: session.sessionId,
      epoch: session.epoch,
    })
    .catch(() => {});
}
function mark(session: Session, stage: string, fields: Record<string, unknown> = {}) {
  if (session.timings[stage] !== undefined) return;
  session.timings[stage] = Math.round(performance.now() - session.startedAt);
  LTLog('gemini.live.timing', {
    tabId: session.tabId, sessionId: session.sessionId, epoch: session.epoch,
    stage, elapsedMs: session.timings[stage], ...fields,
  });
}
function activate(session: Session) {
  if (live !== session || session.closed || session.paused || !session.captureReady || !session.socketReady) return;
  session.state = 'active';
  session.input = new Float32Array();
  mark(session, 'ready');
  notify(session, 'ready');
}
function flush(session: Session) {
  session.input = new Float32Array();
  session.output = [];
  session.queued = 0;
  for (const source of session.sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {}
    source.disconnect();
  }
  session.sources.clear();
  session.nextAt = session.context?.currentTime || 0;
}
function pump(session: Session) {
  const context = session.context;
  if (
    live !== session ||
    !context ||
    session.paused ||
    session.closed ||
    context.state === 'closed'
  )
    return;
  const now = context.currentTime;
  session.nextAt = Math.max(session.nextAt, now + PLAYBACK_LEAD_SECONDS);
  while (session.output.length && session.nextAt - now < SCHEDULE_AHEAD_SECONDS) {
    const { pcm, duration } = session.output.shift()!;
    session.queued -= duration;
    const data = new DataView(pcm);
    const buffer = context.createBuffer(1, pcm.byteLength / 2, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = data.getInt16(i * 2, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    session.sources.add(source);
    source.onended = () => {
      session.sources.delete(source);
      source.disconnect();
    };
    source.start(session.nextAt);
    mark(session, 'playback-scheduled', {
      scheduledLeadMs: Math.round((session.nextAt - now) * 1000),
      timings: { ...session.timings },
    });
    session.nextAt += duration;
  }
}
async function cleanup(session: Session) {
  session.closed = true;
  session.client?.stop();
  flush(session);
  if (session.timer) clearInterval(session.timer);
  if (session.processor) {
    session.processor.port.onmessage = null;
    session.processor.port.close();
    session.processor.disconnect();
  }
  session.source?.disconnect();
  session.sink?.disconnect();
  for (const track of session.stream?.getTracks() || []) {
    track.onended = null;
    track.stop();
  }
  if (session.context?.state !== 'closed') await session.context?.close().catch(() => {});
  if (live === session) live = null;
}
async function fail(session: Session, code: string) {
  if (live !== session || session.closed) return;
  await cleanup(session);
  notify(session, 'error', { code });
}

export async function start({
  tabId,
  streamId,
  sessionId = crypto.randomUUID(),
}: {
  tabId: number;
  streamId: string;
  sessionId?: string;
}) {
  const startedAt = performance.now();
  const run = ++generation;
  if (live) await cleanup(live);
  if (run !== generation) return { ok: false, error: 'Superseded' };
  const settings = await loadSettings();
  if (!settings.apiKey) return { ok: false, error: 'MissingApiKey' };
  if (run !== generation) return { ok: false, error: 'Superseded' };
  const session: Session = {
    tabId,
    sessionId,
    epoch: 0,
    state: 'connecting',
    paused: false,
    captureReady: false,
    socketReady: false,
    startedAt,
    timings: {},
    inputChunkSamples: 640,
    closed: false,
    input: new Float32Array(),
    inputBytes: 0,
    context: null,
    stream: null,
    client: null,
    output: [],
    sources: new Set(),
    queued: 0,
    nextAt: 0,
    timer: null,
    sendAudio: (pcm) => {
      session.client?.sendAudio(pcm);
      mark(session, 'first-input-sent');
    },
    socket: {
      get readyState() {
        return session.client?.socket?.readyState ?? 0;
      },
      get bufferedAmount() {
        return session.client?.socket?.bufferedAmount ?? 0;
      },
      send: (pcm) => session.client?.sendAudio(pcm),
    },
  };
  live = session;
  try {
    session.client = new GeminiLiveClient(settings, {
      ready() {
        session.socketReady = true;
        mark(session, 'gemini-setup-ready');
        activate(session);
      },
      audio(pcm) {
        if (live !== session || session.paused || session.state !== 'active') return;
        mark(session, 'first-output-received');
        const duration = pcm.byteLength / 2 / OUTPUT_RATE;
        if (
          session.queued +
            duration +
            Math.max(0, session.nextAt - (session.context?.currentTime || 0)) >
          MAX_OUTPUT_SECONDS
        ) {
          void fail(session, 'OutputBackpressure');
          return;
        }
        session.output.push({ pcm, duration });
        session.queued += duration;
        pump(session);
      },
      caption(value) {
        if (live === session && !session.paused) notify(session, 'transcript', value);
      },
      interrupted() {
        flush(session);
      },
      reconnecting(attempt) {
        if (live !== session || session.closed) return;
        session.epoch++;
        session.socketReady = false;
        session.startedAt = performance.now();
        session.timings = {};
        session.state = session.paused ? 'paused' : 'connecting';
        flush(session);
        if (!session.paused) notify(session, 'reconnecting', { attempt });
      },
      error(code) {
        void fail(session, code);
      },
    });
    mark(session, 'connecting');
    session.client.connect();
    session.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
      } as any,
      video: false,
    });
    if (live !== session || run !== generation) {
      await cleanup(session);
      return { ok: false, error: 'Superseded' };
    }
    mark(session, 'capture-acquired');
    session.stream.getTracks().forEach((track) => {
      track.onended = () => void fail(session, 'CaptureEnded');
    });
    session.context = new AudioContext();
    await session.context.resume();
    await session.context.audioWorklet.addModule(chrome.runtime.getURL('live-capture-worklet.js'));
    if (live !== session || run !== generation) {
      await cleanup(session);
      return { ok: false, error: 'Superseded' };
    }
    session.source = session.context.createMediaStreamSource(session.stream);
    session.processor = new AudioWorkletNode(session.context, 'live-capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    // Tab capture suppresses source-tab playback. Route capture only to a silent
    // sink; translated audio plays in this separate offscreen context.
    session.sink = session.context.createMediaStreamDestination();
    session.source.connect(session.processor);
    session.processor.connect(session.sink);
    session.processor.port.onmessage = (event) => {
      if (
        live !== session ||
        session.closed ||
        session.paused ||
        session.state !== 'active' ||
        !session.context
      )
        return;
      if (session.socket.bufferedAmount > 64_000) {
        void fail(session, 'InputBackpressure');
        return;
      }
      const samples = new Float32Array(event.data);
      if (session.timings['first-non-silent-input'] === undefined &&
          samples.some((sample) => Math.abs(sample) > 0.005)) {
        mark(session, 'first-non-silent-input');
      }
      appendSamples(session, downsampleTo16k(samples, session.context.sampleRate));
    };
    session.timer = setInterval(() => pump(session), 25);
    session.captureReady = true;
    mark(session, 'capture-ready', { sampleRate: session.context.sampleRate });
    activate(session);
    return { ok: true, state: session.state, sessionId, epoch: session.epoch };
  } catch (error: any) {
    await fail(
      session,
      error.code ||
        (error.name === 'NotAllowedError' ? 'CapturePermissionDenied' : 'LiveAudioError'),
    );
    return { ok: false, error: 'LiveAudioError' };
  }
}

export async function stop({ tabId }: { tabId?: number } = {}) {
  const session = live;
  if (!session || !owns(session, tabId)) return { ok: true, stopped: false, tabId: session?.tabId };
  generation++;
  await cleanup(session);
  return { ok: true, stopped: true, state: 'idle' };
}
function reset(session: Session, paused: boolean) {
  session.epoch++;
  session.startedAt = performance.now();
  session.timings = {};
  session.paused = paused;
  session.state = paused ? 'paused' : 'connecting';
  flush(session);
  if (paused) {
    session.socketReady = false;
    session.client?.pause();
    session.client?.prepare();
  } else session.client?.resume();
  return { ok: true, paused, epoch: session.epoch, sessionId: session.sessionId };
}
export function pause({ tabId }: { tabId?: number } = {}) {
  return live && owns(live, tabId) ? reset(live, true) : { ok: true, paused: false };
}
export function resume({ tabId }: { tabId?: number } = {}) {
  return live && owns(live, tabId) ? reset(live, false) : { ok: true, paused: false };
}
export function seek({
  tabId,
  complete = false,
  paused = true,
}: { tabId?: number; complete?: boolean; paused?: boolean } = {}) {
  return live && owns(live, tabId) ? reset(live, !complete || paused) : { ok: true };
}
export function state() {
  return {
    ok: true,
    state: live?.state || 'idle',
    tabId: live?.tabId,
    paused: Boolean(live?.paused),
    epoch: live?.epoch,
    sessionId: live?.sessionId,
    timings: live ? { ...live.timings } : undefined,
  };
}
export const liveHandlers = { start, stop, pause, resume, seek, state };
