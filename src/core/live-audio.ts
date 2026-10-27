export const INPUT_RATE = 16000;
export const OUTPUT_RATE = 24000;
export const INPUT_CHUNK_SAMPLES = 1600;
export const MAX_OUTPUT_SECONDS = 5;
export const PLAYBACK_LEAD_SECONDS = 0.05;
export const SCHEDULE_AHEAD_SECONDS = 0.5;

export interface LiveAudioSession {
  tabId: number;
  state: string;
  paused: boolean;
  input: Float32Array;
  inputBytes: number;
  inputChunkSamples?: number;
  sendAudio?: (data: ArrayBuffer) => void;
  socket: {
    readyState: number;
    bufferedAmount: number;
    send(data: ArrayBuffer): void;
  };
}

export function downsampleTo16k(
  samples: Float32Array | number[],
  sampleRate: number,
): Float32Array {
  if (!(samples instanceof Float32Array)) {
    samples = Float32Array.from(samples || []);
  }
  if (!samples.length) return new Float32Array();
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError('Invalid sample rate');
  }
  if (sampleRate === INPUT_RATE) return samples.slice();

  const length = Math.max(1, Math.round((samples.length * INPUT_RATE) / sampleRate));
  const output = new Float32Array(length);
  const scale = sampleRate / INPUT_RATE;
  for (let i = 0; i < length; i++) {
    if (sampleRate > INPUT_RATE) {
      const first = Math.floor(i * scale);
      const last = Math.min(samples.length, Math.max(first + 1, Math.floor((i + 1) * scale)));
      let total = 0;
      for (let j = first; j < last; j++) total += samples[j];
      output[i] = total / (last - first);
      continue;
    }
    const position = i * scale;
    const low = Math.min(samples.length - 1, Math.floor(position));
    const high = Math.min(samples.length - 1, low + 1);
    const mix = position - low;
    output[i] = samples[low] + (samples[high] - samples[low]) * mix;
  }
  return output;
}

export function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const output = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    output[i] = Math.round(sample * (sample < 0 ? 32768 : 32767));
  }
  return output.buffer;
}

export function ownsLiveSession(
  session: { tabId?: number } | null | undefined,
  tabId?: number,
): boolean {
  return Boolean(session && (!Number.isInteger(tabId) || session.tabId === tabId));
}

export function appendSamples(session: LiveAudioSession, samples: Float32Array): void {
  if (session.paused) {
    session.input = new Float32Array();
    return;
  }
  const joined = new Float32Array(session.input.length + samples.length);
  joined.set(session.input);
  joined.set(samples, session.input.length);
  session.input = joined;

  if (
    (session.state !== 'active' || session.socket.bufferedAmount > INPUT_RATE * 4) &&
    session.input.length > INPUT_RATE
  ) {
    session.input = session.input.slice(-INPUT_RATE);
  }

  const chunkSamples = session.inputChunkSamples ?? INPUT_CHUNK_SAMPLES;
  while (session.input.length >= chunkSamples) {
    if (
      session.state !== 'active' ||
      session.socket.readyState !== WebSocket.OPEN ||
      session.socket.bufferedAmount > INPUT_RATE * 4
    ) {
      break;
    }
    const chunk = session.input.subarray(0, chunkSamples);
    const frame = floatToPcm16(chunk);
    if (session.sendAudio) session.sendAudio(frame);
    else session.socket.send(frame);
    session.input = session.input.slice(chunkSamples);
    session.inputBytes += frame.byteLength;
  }
}
