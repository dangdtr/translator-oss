import type { LiveVoice } from './live';

export type TranslationProvider = 'gemini' | 'local';
export type OfflineVoice = 'auto' | 'piper' | 'vieneu';

export interface FeatureFlags {
  /** Cho phép dịch trang web song ngữ */
  enablePageTranslation: boolean;
  /** Cho phép dịch & đọc phụ đề video (YouTube, Video.js, HTML5) */
  enableSubtitles: boolean;
  /** Cho phép phát giọng thuyết minh tiếng Việt (TTS) */
  enableSpeech: boolean;
  /** Cho phép dịch âm thanh trực tiếp (Gemini Live Audio) */
  enableLive: boolean;
  /** Cho phép dịch voice theo đoạn (Segmented Dubbing - Local mode) */
  enableSegmentedDubbing: boolean;
  /** Cho phép gửi request tới model dịch text Gemini Flash Lite */
  enableTextModel: boolean;
}

export interface AppSettings extends FeatureFlags {
  provider: TranslationProvider;
  mode: 'subtitles' | 'live';

  // Gemini settings
  apiKey: string;
  textModel: string;
  ttsModel: string;
  liveModel: string;
  ttsVoice: LiveVoice;
  geminiPrompt: string;

  // Local settings
  voice: OfflineVoice;
  geminiVoice: LiveVoice;

  // Aliases for compatibility
  speechEnabled?: boolean;
  textEnabled?: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  enablePageTranslation: true,
  enableSubtitles: true,
  enableSpeech: true,
  enableLive: true,
  enableSegmentedDubbing: true,
  enableTextModel: true,
};

export const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_FEATURE_FLAGS,
  provider: 'gemini',
  mode: 'subtitles',
  apiKey: '',
  textModel: 'gemini-3.5-flash-lite',
  ttsModel: 'gemini-2.5-flash-preview-tts',
  liveModel: 'gemini-3.5-live-translate-preview',
  ttsVoice: 'Aoede',
  geminiPrompt:
    'Dịch tự nhiên sang tiếng Việt, phát âm rõ ràng, giữ nhịp điệu vừa phải và dễ hiểu.',
  voice: 'auto',
  geminiVoice: 'Aoede',
  speechEnabled: true,
  textEnabled: true,
};
