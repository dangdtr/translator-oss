export interface GeminiSettings {
  apiKey: string;
  textModel: string;
  textEnabled: boolean;
  ttsModel: string;
  liveModel: string;
  ttsVoice: 'Aoede' | 'Kore' | 'Charon' | 'Puck' | 'Fenrir';
  mode: 'subtitles' | 'live';
  speechEnabled: boolean;
}
export const GEMINI_MODEL_OPTIONS = {
  textModel: [
    {
      value: 'gemini-3.5-flash-lite',
      label: 'Gemini 3.5 Flash Lite — mặc định',
    },
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  ],
  ttsModel: [
    {
      value: 'gemini-2.5-flash-preview-tts',
      label: 'Gemini 2.5 Flash TTS — mặc định',
    },
  ],
  liveModel: [
    {
      value: 'gemini-3.1-flash-live-preview',
      label: 'Gemini 3 Flash Live',
      disabled: false,
    },
    {
      value: 'gemini-3.5-live-translate-preview',
      label: 'Gemini 3.5 Live Translate',
      disabled: false,
    },
    {
      value: 'gemini-3.5-transcribe',
      label: 'Gemini 3.5 Transcribe',
      disabled: true,
    },
    {
      value: 'gemini-3.5-transcribe-live',
      label: 'Gemini 3.5 Transcribe Live',
      disabled: true,
    },
    { value: 'gemini-3.8-live', label: 'Gemini 3.8 Live', disabled: false },
    {
      value: 'gemini-3.8-live-extended-thinking',
      label: 'Gemini 3.8 Live Extended Thinking',
      disabled: false,
    },
  ],
} as const;
export const DEFAULT_GEMINI_SETTINGS: GeminiSettings = {
  apiKey: '',
  textModel: 'gemini-3.5-flash-lite',
  textEnabled: false,
  ttsModel: 'gemini-2.5-flash-preview-tts',
  liveModel: 'gemini-3.5-live-translate-preview',
  ttsVoice: 'Kore',
  mode: 'live',
  speechEnabled: true,
};
export function normalizeSettings(value: unknown): GeminiSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const model = (field: 'textModel' | 'ttsModel' | 'liveModel') =>
    typeof raw[field] === 'string' && /^[A-Za-z0-9._-]+$/.test(raw[field].trim())
      ? raw[field].trim()
      : DEFAULT_GEMINI_SETTINGS[field];
  return {
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
    // Upgrade the previous default, including settings saved before this release.
    textModel:
      model('textModel') === 'gemini-2.5-flash-lite'
        ? DEFAULT_GEMINI_SETTINGS.textModel
        : model('textModel'),
    ttsModel: model('ttsModel'),
    textEnabled:
      typeof raw.textEnabled === 'boolean' ? raw.textEnabled : DEFAULT_GEMINI_SETTINGS.textEnabled,
    liveModel: GEMINI_MODEL_OPTIONS.liveModel.some((option) => option.value === model('liveModel'))
      ? model('liveModel')
      : DEFAULT_GEMINI_SETTINGS.liveModel,
    ttsVoice: ['Aoede', 'Kore', 'Charon', 'Puck', 'Fenrir'].includes(String(raw.ttsVoice))
      ? (raw.ttsVoice as GeminiSettings['ttsVoice'])
      : 'Kore',
    mode: raw.mode === 'live' || raw.mode === 'subtitles' ? raw.mode : DEFAULT_GEMINI_SETTINGS.mode,
    speechEnabled: typeof raw.speechEnabled === 'boolean' ? raw.speechEnabled : true,
  };
}
export async function loadSettings(): Promise<GeminiSettings> {
  // Offscreen documents expose chrome.runtime only. The background validates
  // this caller as an extension page before returning the private settings.
  if (!chrome.storage?.local) {
    const response = await chrome.runtime.sendMessage({
      type: 'settings-secret',
    });
    if (!response?.ok) throw new Error('Không đọc được cài đặt Gemini.');
    return normalizeSettings(response.data);
  }
  await chrome.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  return normalizeSettings((await chrome.storage.local.get('geminiSettings')).geminiSettings);
}
export async function saveSettings(settings: GeminiSettings): Promise<void> {
  await chrome.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  });
  await chrome.storage.local.set({
    geminiSettings: normalizeSettings(settings),
  });
  clearCaches();
}
export function publicSettings(settings: GeminiSettings) {
  const { apiKey, ...rest } = settings;
  return { ...rest, configured: Boolean(apiKey) };
}
import { clearCaches } from './cache';
