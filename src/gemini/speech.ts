import { generateContent, GeminiError } from './api';
import { loadSettings } from './settings';
import {
  BoundedCache,
  speechScheduler,
  cacheContext,
  combineSignals,
  assertCurrent,
  registerCache,
} from './cache';
const cache = new BoundedCache<Blob>(500, 32 * 1024 * 1024);
const pending = new Map<string, Promise<Blob>>();
registerCache(() => {
  cache.clear();
  pending.clear();
});
export async function identity(): Promise<string> {
  const settings = await loadSettings();
  const ctx = cacheContext(settings);
  return JSON.stringify([ctx.revision, settings.ttsModel, settings.ttsVoice]);
}
export function decodeAudio(data: string, mime: string): Blob {
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    throw new GeminiError('InvalidAudioResponse');
  }
  if (!binary.length || binary.length > 32 * 1024 * 1024)
    throw new GeminiError('InvalidAudioResponse');
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const parts = mime
    .toLowerCase()
    .split(';')
    .map((part) => part.trim());
  if (parts[0] === 'audio/wav' || parts[0] === 'audio/x-wav') {
    if (bytes.length < 44 || binary.slice(0, 4) !== 'RIFF' || binary.slice(8, 12) !== 'WAVE')
      throw new GeminiError('InvalidAudioResponse');
    return new Blob([bytes], { type: 'audio/wav' });
  }
  const rate = parts.find((part) => part.startsWith('rate='))?.slice(5);
  const channels = parts.find((part) => part.startsWith('channels='))?.slice(9);
  if (
    parts[0] !== 'audio/l16' ||
    !rate ||
    !/^\d+$/.test(rate) ||
    +rate < 8000 ||
    +rate > 96000 ||
    (channels && channels !== '1') ||
    bytes.length % 2 ||
    parts.slice(1).some((part) => !/^(rate=\d+|channels=1|codec=pcm)$/.test(part))
  )
    throw new GeminiError('InvalidAudioResponse');
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset: number, text: string) =>
    [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + bytes.length, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, +rate, true);
  view.setUint32(28, +rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, bytes.length, true);
  return new Blob([header, bytes], { type: 'audio/wav' });
}
export async function synthesize(
  text: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; engine: string }> {
  if (typeof text !== 'string' || !text.trim() || text.length > 6000)
    throw new GeminiError('InvalidInput');
  const settings = await loadSettings();
  const ctx = cacheContext(settings);
  const combined = combineSignals(signal, ctx.signal);
  assertCurrent(combined);
  const key = JSON.stringify([ctx.revision, settings.ttsModel, settings.ttsVoice, text]);
  let blob = cache.get(key);
  if (!blob) {
    let work = !signal ? pending.get(key) : undefined;
    if (!work) {
      work = speechScheduler.run(async () => {
        const response = await generateContent(
          settings,
          settings.ttsModel,
          {
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.ttsVoice } },
              },
            },
          },
          combined,
        );
        assertCurrent(combined);
        const parts = (
          response as {
            candidates?: Array<{
              content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
            }>;
          }
        )?.candidates?.[0]?.content?.parts;
        const audio = parts?.find((part) => part.inlineData)?.inlineData;
        if (typeof audio?.data !== 'string' || typeof audio.mimeType !== 'string')
          throw new GeminiError('InvalidAudioResponse');
        const result = decodeAudio(audio.data, audio.mimeType);
        cache.set(key, result, result.size);
        return result;
      }, combined);
      if (!signal) pending.set(key, work);
    }
    try {
      blob = await work;
    } finally {
      if (pending.get(key) === work) pending.delete(key);
    }
  }
  assertCurrent(combined);
  return { blob, engine: settings.ttsModel };
}
