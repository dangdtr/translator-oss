import { defineBackground } from 'wxt/utils/define-background';
import { installBackground } from '../../src/shared/background';
import { loadSettings, saveSettings, publicSettings, normalizeSettings } from '../core/settings';
import { GeminiError } from '../core/api';
import { validateConnection } from '../core/validate';
import { translateTexts, polishCaptions } from '../core/text';
import type { FrameOwner } from '../../src/types/messages';
import { identity, synthesize } from '../core/speech';

export default defineBackground(() => {
  const jobs = new Map<AbortController, FrameOwner & { scope?: string }>();
  const speechJobs = new Map<string, { controller: AbortController; url?: string }>();
  // Configure trust before any content script can read the credential storage area.
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  installBackground({
    async initialize() {
      if (!(await loadSettings()).apiKey) throw new GeminiError('MissingApiKey');
    },
    cancelOwner(owner) {
      for (const [controller, job] of jobs) {
        if (
          job.tabId === owner.tabId &&
          (owner.frameId === undefined || job.frameId === owner.frameId) &&
          (owner.scope === undefined || job.scope === owner.scope)
        )
          controller.abort();
      }
    },
    async api(path, body, signal, owner) {
      if (path === '/health') {
        const settings = await loadSettings();
        return {
          ok: true,
          configured: Boolean(settings.apiKey),
          offline: false,
          translation_ready: Boolean(settings.apiKey) && settings.textEnabled,
          voice_ready: Boolean(settings.apiKey),
          live: { configured: Boolean(settings.apiKey) },
          caption_polish: { provider: 'gemini' },
        };
      }
      const controller = new AbortController();
      if (owner) jobs.set(controller, owner);
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      try {
        if (path === '/translate') return await translateTexts(body.texts, combined);
        if (path === '/captions/polish') return await polishCaptions(body.cues, combined);
        throw new Error('Chế độ này chưa có trong bản Gemini.');
      } finally {
        jobs.delete(controller);
      }
    },
    async liveConfig() {
      return {};
    },
    async speechConfig() {
      return { voice: (await loadSettings()).ttsVoice };
    },
    customMessages: [
      'settings-public',
      'settings-secret',
      'settings-save',
      'gemini-validate',
      'speech-synthesize',
      'speech-cancel',
      'speech-identity',
    ],
    async customDispatch(message, sender) {
      if (!sender.url?.startsWith(chrome.runtime.getURL('')) && message.type !== 'settings-public')
        throw new Error('Không có quyền truy cập cài đặt.');
      if (message.type === 'settings-public') return publicSettings(await loadSettings());
      if (message.type === 'settings-secret') return loadSettings();
      if (message.type === 'speech-identity') return identity();
      if (message.type === 'speech-cancel') {
        const job = speechJobs.get(message.requestId);
        if (job?.url === sender.url) job?.controller.abort();
        return null;
      }
      if (message.type === 'speech-synthesize') {
        if (typeof message.requestId !== 'string' || speechJobs.has(message.requestId))
          throw new Error('Yêu cầu giọng không hợp lệ.');
        const controller = new AbortController();
        speechJobs.set(message.requestId, { controller, url: sender.url });
        try {
          const clip = await synthesize(message.text, controller.signal);
          const bytes = new Uint8Array(await clip.blob.arrayBuffer());
          let binary = '';
          for (let start = 0; start < bytes.length; start += 8192)
            binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
          return { audio: btoa(binary), engine: clip.engine };
        } finally {
          speechJobs.delete(message.requestId);
        }
      }
      if (message.type === 'settings-save') {
        await saveSettings(normalizeSettings(message.settings));
        const tabs = await chrome.tabs.query({});
        await Promise.all(
          tabs
            .filter((tab) => tab.id !== undefined)
            .map((tab) =>
              chrome.tabs.sendMessage(tab.id!, { type: 'save-and-reload' }).catch(() => {}),
            ),
        );
        return publicSettings(await loadSettings());
      }
      if (message.type === 'gemini-validate') {
        const settings = normalizeSettings(message.settings);
        return validateConnection(settings);
      }
    },
  });
});
