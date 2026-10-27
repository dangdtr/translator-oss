import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GEMINI_SETTINGS,
  GEMINI_MODEL_OPTIONS,
  normalizeSettings,
  saveSettings,
  publicSettings,
} from '../src-gemini/core/settings';
import { generateContent, GeminiError } from '../src-gemini/core/api';
import {
  translateTexts,
  polishCaptions,
  validateTranslations,
  validatePolishedSentences,
} from '../src-gemini/core/text';
import { synthesize, decodeAudio } from '../src-gemini/core/speech';
import { clearCaches, Scheduler } from '../src-gemini/core/cache';
import { Transcript } from '../src-gemini/core/transcript';
let stored = { ...DEFAULT_GEMINI_SETTINGS, textEnabled: true, apiKey: 'secret-test-key' };
(globalThis as any).chrome = {
  storage: {
    local: {
      setAccessLevel: async () => {},
      get: async () => ({ geminiSettings: stored }),
      set: async (value: any) => {
        stored = value.geminiSettings;
      },
    },
  },
};
const json = (value: unknown) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
    }),
    { status: 200 },
  );
const code = (expected: string) => (error: unknown) =>
  error instanceof GeminiError && error.code === expected;
test('settings normalize and never expose credentials', () => {
  assert.equal(normalizeSettings({}).textEnabled, false);
  assert.equal(normalizeSettings({ textEnabled: true }).textEnabled, true);
  assert.equal(normalizeSettings({ textEnabled: false }).textEnabled, false);
  assert.deepEqual(
    GEMINI_MODEL_OPTIONS.liveModel.map((option) => option.label),
    [
      'Gemini 3 Flash Live',
      'Gemini 3.5 Live Translate',
      'Gemini 3.5 Transcribe',
      'Gemini 3.5 Transcribe Live',
      'Gemini 3.8 Live',
      'Gemini 3.8 Live Extended Thinking',
    ],
  );
  assert.equal(
    normalizeSettings({ liveModel: 'custom-live' }).liveModel,
    DEFAULT_GEMINI_SETTINGS.liveModel,
  );
  assert.equal(
    normalizeSettings({ liveModel: 'gemini-3.8-live-extended-thinking' }).liveModel,
    'gemini-3.8-live-extended-thinking',
  );
  assert.equal(DEFAULT_GEMINI_SETTINGS.textModel, 'gemini-3.5-flash-lite');
  assert.equal(DEFAULT_GEMINI_SETTINGS.liveModel, 'gemini-3.5-live-translate-preview');
  assert.equal(normalizeSettings({}).mode, 'live');
  assert.equal(normalizeSettings({ mode: 'subtitles' }).mode, 'subtitles');
  assert.equal(normalizeSettings({ mode: 'live' }).mode, 'live');
  assert.equal(
    normalizeSettings({ textModel: ' gemini-2.5-flash-lite ' }).textModel,
    'gemini-3.5-flash-lite',
  );
  assert.equal(normalizeSettings({ textModel: 'custom-model' }).textModel, 'custom-model');
  assert.equal(
    normalizeSettings({ textModel: '../bad' }).textModel,
    DEFAULT_GEMINI_SETTINGS.textModel,
  );
  assert.equal(normalizeSettings({ apiKey: ' a ', speechEnabled: false }).apiKey, 'a');
  assert.equal(normalizeSettings({ speechEnabled: false }).speechEnabled, false);
  assert.ok(!('apiKey' in publicSettings(stored)));
});
test('offscreen reads private settings through trusted runtime instead of unavailable storage API', async () => {
  const chromeMock = (globalThis as any).chrome;
  try {
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (message: any) => {
          assert.equal(message.type, 'settings-secret');
          return { ok: true, data: stored };
        },
      },
    };
    const { loadSettings } = await import('../src-gemini/core/settings');
    assert.equal((await loadSettings()).apiKey, stored.apiKey);
  } finally {
    (globalThis as any).chrome = chromeMock;
  }
});
test('REST requires key, uses header, sanitizes authentication errors', async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.ok(!String(url).includes('secret'));
    assert.equal((init!.headers as any)['x-goog-api-key'], stored.apiKey);
    return new Response('secret raw failure', { status: 403 });
  };
  await assert.rejects(
    generateContent({ ...stored, apiKey: '' }, stored.textModel, {}),
    code('MissingApiKey'),
  );
  assert.equal(calls, 0);
  await assert.rejects(generateContent(stored, '../bad', {}), code('InvalidModel'));
  await assert.rejects(
    generateContent(stored, stored.textModel, {}),
    (error) => code('AuthenticationError')(error) && !String(error).includes('secret'),
  );
  assert.equal(calls, 1);
});
test('strict text validators reject malformed count, blank and overlapping ranges', () => {
  assert.deepEqual(validateTranslations({ translations: [' Một '] }, 1), ['Một']);
  for (const value of [{ translations: [] }, { translations: [''] }, null])
    assert.throws(() => validateTranslations(value, 1));
  assert.throws(() =>
    validatePolishedSentences(
      {
        sentences: [
          { start: 0, end: 2, original: 'a', translation: 'b' },
          { start: 1, end: 3, original: 'a', translation: 'b' },
        ],
      },
      3,
    ),
  );
});
test('REST cancellation stops fetch and malformed JSON is sanitized', async () => {
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) =>
      init!.signal!.addEventListener('abort', () => reject(new Error('secret raw aborted')), {
        once: true,
      }),
    );
  };
  const work = generateContent(stored, stored.textModel, {}, controller.signal);
  controller.abort();
  await assert.rejects(work, code('Aborted'));
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response('not json');
  await assert.rejects(generateContent(stored, stored.textModel, {}), code('InvalidResponse'));
});
test('translation batching, dedupe, malformed output and credential invalidation', async () => {
  clearCaches();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init!.body as string);
    const input = JSON.parse(body.contents[0].parts[0].text.split('Input: ')[1]);
    return json({ translations: input.map((text: string) => 'vi:' + text) });
  };
  const input = Array.from({ length: 20 }, (_, i) => String(i));
  const [a, b] = await Promise.all([translateTexts(input), translateTexts(input)]);
  assert.deepEqual(a, b);
  assert.equal(calls, 2);
  assert.equal(a.translations[19], 'vi:19');
  await translateTexts(input);
  assert.equal(calls, 2);
  await saveSettings({ ...stored, apiKey: 'different-key' });
  await translateTexts(input);
  assert.equal(calls, 4);
  clearCaches();
  globalThis.fetch = async () => json({ translations: [] });
  await assert.rejects(translateTexts(['x']), code('InvalidResponse'));
  await assert.rejects(polishCaptions(['x']), code('InvalidResponse'));
});
test('queued cancellation never starts task; active credential change rejects stale result', async () => {
  const scheduler = new Scheduler(1);
  let release!: () => void;
  let calls = 0;
  const active = scheduler.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const controller = new AbortController();
  const queued = scheduler.run(async () => {
    calls++;
  }, controller.signal);
  controller.abort();
  await assert.rejects(queued, code('Aborted'));
  release();
  await active;
  assert.equal(calls, 0);
  clearCaches();
  let finish!: (response: Response) => void;
  globalThis.fetch = async () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const work = translateTexts(['stale']);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await saveSettings({ ...stored, textModel: 'changed-model' });
  finish(json({ translations: ['cũ'] }));
  await assert.rejects(work, code('Aborted'));
});
test('TTS PCM WAV header, MIME rejection and audio cache invalidation', async () => {
  const blob = decodeAudio(btoa('\u0001\u0000\u0002\u0000'), 'audio/L16;codec=pcm;rate=24000');
  const bytes = await blob.arrayBuffer();
  assert.equal(blob.size, 48);
  assert.equal(new DataView(bytes).getUint32(24, true), 24000);
  const wave = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  assert.equal(decodeAudio(wave, 'audio/wav').size, 48);
  for (const mime of ['audio/mp3', 'audio/L16', 'audio/L16;rate=24000;channels=2'])
    assert.throws(() => decodeAudio('AQACAA==', mime));
  assert.throws(() => decodeAudio('', 'audio/wav'));
  clearCaches();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: 'AQACAA==',
                    mimeType: 'audio/L16;rate=24000',
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  };
  await synthesize('Xin chào');
  await synthesize('Xin chào');
  assert.equal(calls, 1);
  await saveSettings({ ...stored, ttsVoice: 'Aoede' });
  await synthesize('Xin chào');
  assert.equal(calls, 2);
});
test('transcript accepts delta/cumulative and resets completed turn', () => {
  const t = new Transcript();
  t.apply({ original: 'hello' });
  t.apply({ original: 'hello world' });
  assert.equal(t.apply({ original: 'world' }).original, 'hello world');
  assert.equal(t.apply({ translation: 'Xin chào', complete: true }).complete, true);
  assert.equal(t.apply({ original: 'new' }).original, 'new');
  t.reset();
  assert.equal(t.original, '');
});
test('disabled text model blocks translation and caption polishing without API requests', async () => {
  const originalFetch = globalThis.fetch;
  const previous = stored;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('must not fetch');
  };
  try {
    await saveSettings({ ...previous, textEnabled: false });
    await assert.rejects(translateTexts(['hello']), code('TextModelDisabled'));
    await assert.rejects(polishCaptions(['hello']), code('TextModelDisabled'));
    assert.equal(calls, 0);
    const setup = (await import('../src-gemini/core/live-client')).liveSetup(stored.liveModel);
    assert.equal(setup.setup.model, `models/${stored.liveModel}`);
  } finally {
    globalThis.fetch = originalFetch;
    await saveSettings(previous);
  }
});

test('429 is returned once and global cooldown prevents request loops', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('raw quota secret', { status: 429 });
  };
  await assert.rejects(generateContent(stored, stored.textModel, {}), code('QuotaExceeded'));
  await assert.rejects(generateContent(stored, stored.ttsModel, {}), code('QuotaExceeded'));
  assert.equal(calls, 1);
});
