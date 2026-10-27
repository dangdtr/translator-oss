import { defineContentScript } from 'wxt/utils/define-content-script';
import { installContent } from '../../src/shared/content-controller';
import { liveErrorMessage } from '../core/live-errors';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',
  main() {
    installContent({
      label: 'Gemini',
      subtitleLabel: 'Gemini',
      voiceName: () => 'Gemini TTS',
      connectionError: 'Mất kết nối Gemini. Kiểm tra mạng và API key rồi bật lại Live.',
      liveError: liveErrorMessage,
      loadPublicSettings: async () => {
        const response = await chrome.runtime.sendMessage({ type: 'settings-public' });
        if (!response?.ok) throw new Error(response?.error || 'Không đọc được cài đặt Gemini.');
        return response.data;
      },
    });
  },
});
