import { decodeAudio } from './speech';
import { GeminiError } from './api';

// REST/TTS lives in the background; offscreen owns decoding and playback.
// Chrome's JSON message transport cannot transfer Blob or AbortSignal.
export async function identity(): Promise<string> {
  const response = await chrome.runtime.sendMessage({ type: 'speech-identity' });
  if (!response?.ok) throw new GeminiError('RequestFailed');
  return response.data;
}
export async function synthesize(
  text: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; engine: string }> {
  if (signal?.aborted) throw new GeminiError('Aborted');
  const requestId = crypto.randomUUID();
  const abort = () => {
    void chrome.runtime.sendMessage({ type: 'speech-cancel', requestId }).catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'speech-synthesize',
      requestId,
      text,
    });
    if (signal?.aborted) throw new GeminiError('Aborted');
    if (!response?.ok) throw new Error(response?.error || 'Không tạo được giọng Gemini.');
    return { blob: decodeAudio(response.data.audio, 'audio/wav'), engine: response.data.engine };
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
