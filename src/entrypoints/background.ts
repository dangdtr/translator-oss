import { defineBackground } from 'wxt/utils/define-background';
import { getLocalConfig, ensureLocalConfig } from '../core/config';
import { LTLog } from '../core/logger';
import { installBackground } from '../shared/background';
import {
  loadSettings,
  saveSettings,
  publicSettings,
  normalizeSettings,
  type GeminiSettings,
} from '../gemini/settings';
import { GeminiError } from '../gemini/api';
import { validateConnection } from '../gemini/validate';
import { translateTexts, polishCaptions } from '../gemini/text';
import { identity, synthesize as synthesizeGeminiVoice } from '../gemini/speech';
import type { FrameOwner } from '../types/messages';
import type { AppSettings, FeatureFlags, OfflineVoice } from '../types/settings';
import { DEFAULT_SETTINGS } from '../types/settings';

try {
  (self as any).importScripts?.('local-config.js');
} catch {}

export default defineBackground(() => {
  const jobs = new Map<AbortController, FrameOwner & { scope?: string }>();
  const speechJobs = new Map<string, { controller: AbortController; url?: string }>();

  // Ensure trusted context security for storage
  void chrome.storage?.local?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

  async function getFullSettings(): Promise<AppSettings> {
    try {
      const data = await chrome.storage.local.get([
        'appSettings',
        'geminiSettings',
        'mode',
        'voice',
        'geminiVoice',
        'geminiPrompt',
        'provider',
      ]);
      const gemini = normalizeSettings(data.geminiSettings || {});
      const appSaved = (data.appSettings || {}) as Partial<AppSettings>;

      const provider = (appSaved.provider || data.provider || (gemini.apiKey ? 'gemini' : 'local')) as
        | 'gemini'
        | 'local';
      const mode = (appSaved.mode || data.mode || gemini.mode || 'subtitles') as 'subtitles' | 'live';

      const flags: FeatureFlags = {
        enablePageTranslation: appSaved.enablePageTranslation ?? true,
        enableSubtitles: appSaved.enableSubtitles ?? true,
        enableSpeech: appSaved.enableSpeech ?? (gemini.speechEnabled ?? true),
        enableLive: appSaved.enableLive ?? true,
        enableSegmentedDubbing: appSaved.enableSegmentedDubbing ?? true,
        enableTextModel: appSaved.enableTextModel ?? (gemini.textEnabled ?? true),
      };

      return {
        ...DEFAULT_SETTINGS,
        ...appSaved,
        ...flags,
        provider,
        mode,
        apiKey: gemini.apiKey,
        textModel: gemini.textModel,
        ttsModel: gemini.ttsModel,
        liveModel: gemini.liveModel,
        ttsVoice: gemini.ttsVoice,
        geminiPrompt:
          (typeof data.geminiPrompt === 'string'
            ? data.geminiPrompt
            : appSaved.geminiPrompt) || DEFAULT_SETTINGS.geminiPrompt,
        voice: (data.voice as OfflineVoice) || appSaved.voice || 'auto',
        geminiVoice: (data.geminiVoice as any) || appSaved.geminiVoice || 'Aoede',
        speechEnabled: flags.enableSpeech,
        textEnabled: flags.enableTextModel,
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  async function persistSettings(newSettings: Partial<AppSettings>): Promise<AppSettings> {
    const current = await getFullSettings();
    const merged: AppSettings = { ...current, ...newSettings };

    if (typeof newSettings.speechEnabled === 'boolean') {
      merged.enableSpeech = newSettings.speechEnabled;
    }
    if (typeof newSettings.textEnabled === 'boolean') {
      merged.enableTextModel = newSettings.textEnabled;
    }
    merged.speechEnabled = merged.enableSpeech;
    merged.textEnabled = merged.enableTextModel;

    const geminiSettings: GeminiSettings = normalizeSettings({
      apiKey: merged.apiKey,
      textModel: merged.textModel,
      textEnabled: merged.enableTextModel,
      ttsModel: merged.ttsModel,
      liveModel: merged.liveModel,
      ttsVoice: merged.ttsVoice,
      mode: merged.mode,
      speechEnabled: merged.enableSpeech,
    });

    await saveSettings(geminiSettings);

    await chrome.storage.local.set({
      appSettings: merged,
      geminiSettings,
      provider: merged.provider,
      mode: merged.mode,
      voice: merged.voice,
      geminiVoice: merged.geminiVoice,
      geminiPrompt: merged.geminiPrompt,
    });

    return merged;
  }

  async function localApi(path: string, body?: any, signal?: AbortSignal): Promise<any> {
    await ensureLocalConfig();
    const config = getLocalConfig();
    const start = performance.now();
    LTLog('api.start', {
      path,
      texts: body?.texts?.length,
      characters: body?.text?.length,
    });
    let response: Response;
    try {
      response = await fetch(config.url + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + config.token,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
          : AbortSignal.timeout(120000),
      });
    } catch (error: any) {
      if (signal?.aborted) throw new Error('Đã hủy đoạn ở vị trí cũ.');
      LTLog(
        'api.connection-failed',
        { path, ms: Math.round(performance.now() - start), error: error.message },
        'error',
      );
      throw new Error('Không kết nối được bộ dịch local. Chạy ./start.sh trong thư mục dự án.');
    }
    LTLog(
      'api.response',
      { path, status: response.status, ms: Math.round(performance.now() - start) },
      response.ok ? 'info' : 'error',
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        typeof error.detail === 'string' ? error.detail : 'Bộ dịch lỗi: ' + response.status,
      );
    }
    return response.json();
  }

  function liveWebsocketUrl(voice?: string, prompt?: string): string {
    const config = getLocalConfig();
    const url = new URL(config.url);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = url.pathname.replace(/\/$/, '') + '/live/translate';
    url.search = '';
    url.searchParams.set('token', config.token);
    url.searchParams.set('protocol', '2');
    if (voice) url.searchParams.set('voice', voice);
    if (prompt) url.searchParams.set('prompt', prompt);
    return url.href;
  }

  installBackground({
    async initialize() {
      const settings = await getFullSettings();
      if (settings.provider === 'gemini') {
        if (!settings.apiKey) throw new GeminiError('MissingApiKey');
      } else {
        await ensureLocalConfig();
      }
    },

    cancelOwner(owner) {
      for (const [controller, job] of jobs) {
        if (
          job.tabId === owner.tabId &&
          (owner.frameId === undefined || job.frameId === owner.frameId) &&
          (owner.scope === undefined || job.scope === owner.scope)
        ) {
          controller.abort();
        }
      }
    },

    async api(path, body, signal, owner) {
      const settings = await getFullSettings();

      if (path === '/health') {
        if (settings.provider === 'gemini') {
          return {
            ok: true,
            provider: 'gemini',
            configured: Boolean(settings.apiKey),
            offline: false,
            translation_ready:
              Boolean(settings.apiKey) && settings.enableTextModel && settings.enablePageTranslation,
            voice_ready: Boolean(settings.apiKey) && settings.enableSpeech,
            live: { configured: Boolean(settings.apiKey) && settings.enableLive },
            caption_polish: { provider: 'gemini' },
          };
        }
        try {
          const localHealth = await localApi('/health', undefined, signal);
          return { ...localHealth, provider: 'local', configured: true };
        } catch (error: any) {
          return {
            ok: false,
            provider: 'local',
            configured: false,
            error: error?.message || 'Local server offline',
          };
        }
      }

      if (path === '/translate') {
        if (!settings.enablePageTranslation && !settings.enableSubtitles) {
          throw new Error('Tính năng dịch đang bị tắt trong cài đặt.');
        }
        if (settings.provider === 'gemini') {
          if (!settings.enableTextModel) {
            throw new GeminiError('TextModelDisabled');
          }
          const controller = new AbortController();
          if (owner) jobs.set(controller, owner);
          const combined = signal
            ? AbortSignal.any([signal, controller.signal])
            : controller.signal;
          try {
            return await translateTexts(body.texts, combined);
          } finally {
            jobs.delete(controller);
          }
        }
        return localApi(path, body, signal);
      }

      if (path === '/captions/polish') {
        if (!settings.enableSubtitles) return body?.cues || [];
        if (settings.provider === 'gemini') {
          if (!settings.enableTextModel) return body?.cues || [];
          const controller = new AbortController();
          if (owner) jobs.set(controller, owner);
          const combined = signal
            ? AbortSignal.any([signal, controller.signal])
            : controller.signal;
          try {
            return await polishCaptions(body.cues, combined);
          } finally {
            jobs.delete(controller);
          }
        }
        return localApi(path, body, signal);
      }

      if (path.startsWith('/dubbing')) {
        if (!settings.enableSegmentedDubbing) {
          throw new Error('Tính năng dịch theo đoạn đang bị tắt trong cài đặt.');
        }
        return localApi(path, body, signal);
      }

      if (settings.provider === 'local') {
        return localApi(path, body, signal);
      }

      throw new Error(`Đường dẫn ${path} chưa hỗ trợ trong chế độ Gemini.`);
    },

    async liveConfig() {
      const settings = await getFullSettings();
      if (!settings.enableLive) {
        throw new Error('Gemini Live đang bị tắt trong cài đặt.');
      }
      if (settings.provider === 'gemini') {
        return {
          mode: 'gemini',
          liveModel: settings.liveModel,
          ttsVoice: settings.ttsVoice,
        };
      }
      return {
        mode: 'local',
        websocketUrl: liveWebsocketUrl(settings.geminiVoice, settings.geminiPrompt),
      };
    },

    async speechConfig() {
      const settings = await getFullSettings();
      if (!settings.enableSpeech) {
        return {
          mode: settings.provider,
          voice: 'disabled',
          speechEnabled: false,
        };
      }
      if (settings.provider === 'gemini') {
        return {
          mode: 'gemini',
          voice: settings.ttsVoice,
          speechEnabled: true,
        };
      }
      return {
        mode: 'local',
        voice: ['piper', 'vieneu'].includes(settings.voice) ? settings.voice : 'auto',
        speechEnabled: true,
      };
    },

    customMessages: [
      'settings-public',
      'settings-secret',
      'settings-save',
      'gemini-validate',
      'speech-synthesize',
      'speech-cancel',
      'speech-identity',
      'toggle-feature',
    ],

    async customDispatch(message, sender) {
      if (
        !sender.url?.startsWith(chrome.runtime.getURL('')) &&
        message.type !== 'settings-public'
      ) {
        throw new Error('Không có quyền truy cập cài đặt.');
      }

      if (message.type === 'settings-public') {
        const settings = await getFullSettings();
        return {
          provider: settings.provider,
          mode: settings.mode,
          speechEnabled: settings.enableSpeech,
          textEnabled: settings.enableTextModel,
          featureFlags: {
            enablePageTranslation: settings.enablePageTranslation,
            enableSubtitles: settings.enableSubtitles,
            enableSpeech: settings.enableSpeech,
            enableLive: settings.enableLive,
            enableSegmentedDubbing: settings.enableSegmentedDubbing,
            enableTextModel: settings.enableTextModel,
          },
          liveModel: settings.liveModel,
          ttsVoice: settings.ttsVoice,
          voice: settings.voice,
          geminiVoice: settings.geminiVoice,
          configured: settings.provider === 'gemini' ? Boolean(settings.apiKey) : true,
        };
      }

      if (message.type === 'settings-secret') {
        return getFullSettings();
      }

      if (message.type === 'speech-identity') {
        return identity();
      }

      if (message.type === 'speech-cancel') {
        const job = speechJobs.get(message.requestId);
        if (job?.url === sender.url) job?.controller.abort();
        return null;
      }

      if (message.type === 'speech-synthesize') {
        if (typeof message.requestId !== 'string' || speechJobs.has(message.requestId)) {
          throw new Error('Yêu cầu giọng không hợp lệ.');
        }
        const controller = new AbortController();
        speechJobs.set(message.requestId, { controller, url: sender.url });
        try {
          const clip = await synthesizeGeminiVoice(message.text, controller.signal);
          const bytes = new Uint8Array(await clip.blob.arrayBuffer());
          let binary = '';
          for (let start = 0; start < bytes.length; start += 8192) {
            binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
          }
          return { audio: btoa(binary), engine: clip.engine };
        } finally {
          speechJobs.delete(message.requestId);
        }
      }

      if (message.type === 'settings-save') {
        const updated = await persistSettings(message.settings || {});
        const tabs = await chrome.tabs.query({});
        await Promise.all(
          tabs
            .filter((tab) => tab.id !== undefined)
            .map((tab) =>
              chrome.tabs.sendMessage(tab.id!, { type: 'save-and-reload' }).catch(() => {}),
            ),
        );
        return publicSettings(
          normalizeSettings({
            apiKey: updated.apiKey,
            textModel: updated.textModel,
            textEnabled: updated.enableTextModel,
            ttsModel: updated.ttsModel,
            liveModel: updated.liveModel,
            ttsVoice: updated.ttsVoice,
            mode: updated.mode,
            speechEnabled: updated.enableSpeech,
          }),
        );
      }

      if (message.type === 'toggle-feature') {
        const { flag, value } = message;
        if (typeof flag === 'string') {
          const cur = await getFullSettings();
          const newVal = typeof value === 'boolean' ? value : !((cur as any)[flag]);
          await persistSettings({ [flag]: newVal });
        }
        return getFullSettings();
      }

      if (message.type === 'gemini-validate') {
        const settings = normalizeSettings(message.settings);
        return validateConnection(settings);
      }
    },
  });
});
