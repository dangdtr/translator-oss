import { generateContent, GeminiError, type GeminiErrorCode } from './api';
import { GeminiLiveClient } from './live-client';
import type { GeminiSettings } from './settings';

export async function validateConnection(
  settings: GeminiSettings,
  socketFactory?: (url: string) => WebSocket,
): Promise<{ validated: true; provider: 'live' | 'text' }> {
  if (settings.mode === 'live' || !settings.textEnabled) {
    // Validate the actual Live setup without capturing audio or generating a turn.
    await new Promise<void>((resolve, reject) => {
      const client = new GeminiLiveClient(settings, {
        ready() {
          client.stop();
          resolve();
        },
        error(code) {
          client.stop();
          reject(new GeminiError(code as GeminiErrorCode));
        },
        reconnecting() {},
        audio() {},
        caption() {},
        interrupted() {},
      }, socketFactory);
      client.connect();
    });
    return { validated: true, provider: 'live' };
  }
  await generateContent(settings, settings.textModel, {
    contents: [{ parts: [{ text: 'Reply with OK.' }] }],
    generationConfig: { maxOutputTokens: 16 },
  });
  return { validated: true, provider: 'text' };
}
