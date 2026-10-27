import { getLocalConfig, ensureLocalConfig } from '../../core/config';
import type { OfflineVoice } from '../../types/settings';
import { createSpeechHandlers } from '../../shared/speech-player';
import { synthesize as geminiSynthesize, identity as geminiIdentity } from '../../gemini/speech-rpc';

const GEMINI_VOICES = ['Aoede', 'Kore', 'Charon', 'Puck', 'Fenrir'];

async function localSynthesize(
  text: string,
  voice: OfflineVoice = 'auto',
): Promise<{ blob: Blob; engine: string }> {
  await ensureLocalConfig();
  const config = getLocalConfig();
  let response: Response;
  const reqVoice = voice === 'piper' ? 'piper' : 'auto';
  try {
    response = await fetch(config.url + '/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + config.token,
      },
      body: JSON.stringify({ text, voice: reqVoice }),
      signal: AbortSignal.timeout(60000),
    });
    if (response.status === 422 && reqVoice !== 'auto') {
      response = await fetch(config.url + '/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + config.token,
        },
        body: JSON.stringify({ text, voice: 'auto' }),
        signal: AbortSignal.timeout(60000),
      });
    }
  } catch {
    throw new Error('Không kết nối được bộ đọc local. Chạy ./start.sh trong thư mục dự án.');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === 'string' ? error.detail : 'Bộ đọc lỗi: ' + response.status,
    );
  }
  return {
    blob: await response.blob(),
    engine: response.headers.get('X-Voice-Engine') || voice,
  };
}

async function synthesize(
  text: string,
  voice: string = 'auto',
  signal?: AbortSignal,
): Promise<{ blob: Blob; engine: string }> {
  if (GEMINI_VOICES.includes(voice)) {
    return geminiSynthesize(text, signal);
  }
  return localSynthesize(text, voice as OfflineVoice);
}

export const speechHandlers = createSpeechHandlers({
  identity: async () => {
    try {
      return await geminiIdentity();
    } catch {
      return 'local';
    }
  },
  synthesize: (text, voice, signal) => synthesize(text, voice, signal),
  async selectClip(text, voice, wait, speech) {
    if (GEMINI_VOICES.includes(voice)) {
      const clip = await speech(text, voice);
      return { ...clip, fallback: false };
    }
    const clip =
      voice === 'piper'
        ? await speech(text, 'piper')
        : await Promise.race([
            speech(text, voice),
            new Promise<null>((resolve) =>
              setTimeout(
                () => resolve(null),
                Number.isFinite(wait) && wait! >= 0 ? Math.min(wait!, 10000) : 1500,
              ),
            ),
          ]);
    return clip
      ? { ...clip, fallback: false }
      : { ...(await speech(text, 'piper')), fallback: true };
  },
});
