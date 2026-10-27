import { defineContentScript } from 'wxt/utils/define-content-script';
import { installContent } from '../shared/content-controller';
import { SegmentedPlayer } from '../core/segmented-player';
import { liveErrorMessage } from '../gemini/live-errors';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',
  main() {
    installContent({
      label: 'Translator',
      subtitleLabel: 'Song ngữ',
      segmentedPlayer: SegmentedPlayer,
      voiceName: (engine) => {
        if (['Aoede', 'Kore', 'Charon', 'Puck', 'Fenrir'].includes(engine || '')) {
          return `Gemini (${engine})`;
        }
        return engine === 'vieneu' ? 'VieNeu' : 'Piper';
      },
      connectionError: 'Mất kết nối tới bộ dịch. Kiểm tra cài đặt và khởi động lại.',
      liveError: (code) => {
        if (code === 'UnsupportedTab') return 'Chỉ hỗ trợ trên YouTube.';
        if (code === 'Unauthorized') return 'Chưa kết nối bộ dịch (chạy ./start.sh để kết nối).';
        if (code === 'MissingGeminiKey')
          return 'Backend chưa có GEMINI_API_KEY. Cấu hình API key rồi khởi động lại ./start.sh.';
        if (code === 'BackendDisconnected')
          return 'Mất kết nối backend local. Kiểm tra ./start.sh rồi bật lại Live.';
        return liveErrorMessage(code);
      },
      loadPublicSettings: async () => {
        const response = await chrome.runtime.sendMessage({ type: 'settings-public' });
        if (!response?.ok) {
          return { mode: 'subtitles', speechEnabled: true };
        }
        return response.data;
      },
    });
  },
});
