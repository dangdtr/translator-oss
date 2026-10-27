// Real packaged extension, native Chrome messaging/offscreen; only Google HTTP
// responses and fixture pages are mocked. No Python server or model is involved.
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
function wave() {
  const pcm = Buffer.alloc(24000 * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

(async () => {
  const extension = path.resolve('.output/gemini/chrome-mv3');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-browser-'));
  let context;
  const localhost = [],
    requests = [],
    errors = [];
  let releasePageRequest, pageRequestStarted;
  const pageRequestGate = new Promise((resolve) => {
    releasePageRequest = resolve;
  });
  const pageStarted = new Promise((resolve) => {
    pageRequestStarted = resolve;
  });
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    context.on('request', (request) => {
      if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(request.url())) localhost.push(request.url());
    });
    await context.route('https://fixture.test/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith('/vendor/'))
        return route.fulfill({
          contentType: pathname.endsWith('.js') ? 'text/javascript' : 'text/css',
          body: fs.readFileSync(require.resolve('video.js/dist/' + path.basename(pathname))),
        });
      const body =
        pathname === '/videojs'
          ? fs.readFileSync(path.join(__dirname, 'videojs-fixture.html'))
          : fixture;
      await route.fulfill({ contentType: 'text/html', body });
    });
    await context.route('https://www.youtube.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: fixture
          .replace(
            '<video id="video"',
            '<div id="movie_player"><div class="ytp-chrome-bottom"><div class="ytp-chrome-controls"><div class="ytp-right-controls"></div></div></div><video id="video"',
          )
          .replace('</video>', '</video></div>'),
      }),
    );
    await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
      const request = route.request();
      const body = request.postDataJSON();
      requests.push(body);
      assert.equal(request.headers()['x-goog-api-key'], 'browser-fixture-key');
      assert.ok(!request.url().includes('browser-fixture-key'));
      let parts;
      if (body.generationConfig?.responseModalities?.includes('AUDIO')) {
        parts = [{ inlineData: { data: wave(), mimeType: 'audio/wav' } }];
      } else {
        const prompt = body.contents[0].parts[0].text;
        const input = prompt.includes('Input: ') ? JSON.parse(prompt.split('Input: ')[1]) : null;
        if (input?.some((text) => text.includes('PENDING_PAGE'))) {
          pageRequestStarted();
          await pageRequestGate;
        }
        parts = [
          {
            text: input
              ? JSON.stringify({
                  translations: input.map((text) => 'Bản dịch: ' + text),
                })
              : 'OK',
          },
        ];
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ content: { parts } }] }),
      });
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByRole('button', { name: 'Lưu & Áp dụng' }).waitFor();
    try {
      await popup.waitForFunction(() => !document.querySelector('.save-btn').disabled, null, {
        timeout: 5000,
      });
    } catch (error) {
      console.error('Popup state:', await popup.locator('body').innerText());
      throw error;
    }
    await popup.locator('#api-key').fill('browser-fixture-key');
    await popup.locator('#liveModel-preset').selectOption('gemini-3.8-live');
    assert.equal(await popup.locator('#liveModel').count(), 0);
    await popup.getByRole('button', { name: 'Phụ đề Gemini', exact: true }).click();
    assert.equal(await popup.locator('#text-enabled').isChecked(), false);
    await popup.locator('#text-enabled').check();
    await popup.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
    await popup.getByRole('status').filter({ hasText: 'Kết nối model dịch thành công' }).waitFor();
    const checkedSettings = await worker.evaluate(async () =>
      (await chrome.storage.local.get('geminiSettings')).geminiSettings,
    );
    assert.equal(checkedSettings.apiKey, 'browser-fixture-key', 'successful validation must save the entered key');
    assert.equal(checkedSettings.liveModel, 'gemini-3.8-live');
    await popup.getByRole('button', { name: 'Lưu & Áp dụng' }).click();
    await popup.getByRole('status').filter({ hasText: 'Đã lưu cài đặt' }).waitFor();
    await popup.reload();
    await popup.waitForFunction(
      () => document.querySelector('#api-key').value === 'browser-fixture-key',
    );
    assert.equal(await popup.locator('#offline-voice').count(), 0);
    assert.equal(await popup.locator('#live-prompt').count(), 0);
    assert.equal(await popup.locator('#liveModel-preset').inputValue(), 'gemini-3.8-live');
    assert.equal(await popup.locator('#liveModel-preset option').count(), 6);
    assert.equal(await popup.locator('#liveModel-preset option:disabled').count(), 2);
    console.log('PASS: popup stores, validates and restores user API key');

    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('https://fixture.test/');
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    const tabs = await worker.evaluate(() => chrome.tabs.query({}));
    const tab = tabs.find((tab) => tab.url === 'https://fixture.test/');
    const command = (message) =>
      worker.evaluate(
        ({ tabId, message }) => chrome.tabs.sendMessage(tabId, message, { frameId: 0 }),
        { tabId: tab.id, message },
      );
    const denied = await worker.evaluate(
      async (tabId) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId },
            func: async () => {
              try {
                return (
                  (await chrome.storage.local.get('geminiSettings')).geminiSettings?.apiKey || null
                );
              } catch {
                return null;
              }
            },
          })
        )[0].result,
      tab.id,
    );
    assert.equal(denied, null, 'content context must not read the API key');
    await command({ type: 'start-page' });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-local-translation]').length >= 2,
    );
    assert.ok(
      (await page.locator('[data-local-translation]').allTextContents()).every((text) =>
        text.startsWith('Bản dịch:'),
      ),
    );
    await command({ type: 'stop-page' });
    assert.equal(await page.locator('[data-local-translation]').count(), 0);
    console.log(
      'PASS: page translation/restoration through background; key is inaccessible to content',
    );

    const inspect = await command({ type: 'inspect' });
    await command({ type: 'start-page' });
    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.id = 'pending-page';
      paragraph.textContent = 'PENDING_PAGE should continue translating when video mode starts.';
      document.body.prepend(paragraph);
    });
    await Promise.race([
      pageStarted,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Page request did not start')), 5000),
      ),
    ]);
    await command({ type: 'start-video', videoId: inspect.videos[0].id });
    releasePageRequest();
    await page.waitForFunction(() =>
      document.querySelector('#pending-page [data-local-translation]'),
    );
    await command({ type: 'stop-page' });
    await page.waitForFunction(() =>
      document
        .querySelector('#local-translator-root')
        ?.shadowRoot.querySelector('#target')
        .textContent.startsWith('Bản dịch:'),
    );
    await page.waitForFunction(() => !document.querySelector('video').paused);
    const speechState = () =>
      popup.evaluate(() => chrome.runtime.sendMessage({ type: 'state', target: 'offscreen' }));
    const deadline = Date.now() + 15_000;
    while (!(await speechState())?.playing && Date.now() < deadline) await page.waitForTimeout(50);
    assert.equal((await speechState())?.playing, true, 'offscreen must actually play TTS audio');
    assert.ok(
      requests.some((request) => request.generationConfig?.responseModalities?.includes('AUDIO')),
      JSON.stringify(requests),
    );
    await page.evaluate(() => document.querySelector('video').pause());
    const pausedDeadline = Date.now() + 5000;
    while ((await speechState())?.playing && Date.now() < pausedDeadline)
      await page.waitForTimeout(25);
    assert.equal((await speechState())?.playing, false);
    await page.locator('#local-translator-root #file').setInputFiles({
      name: 'example.srt',
      mimeType: 'text/plain',
      buffer: Buffer.from('1\n00:00:00,000 --> 00:05:00,000\nThis is an imported subtitle.\n'),
    });
    await page.waitForFunction(
      () =>
        document.querySelector('#local-translator-root')?.shadowRoot.querySelector('#source')
          .textContent === 'This is an imported subtitle.',
    );
    await page.waitForFunction(() =>
      document
        .querySelector('#local-translator-root')
        ?.shadowRoot.querySelector('#target')
        .textContent.includes('imported subtitle'),
    );
    await command({ type: 'stop' });
    console.log('PASS: native subtitle translation, Gemini TTS offscreen, pause/stop');

    await page.goto('https://fixture.test/videojs');
    await page.waitForFunction(() => window.fixtureReady === true);
    const vjs = await command({ type: 'inspect' });
    await command({ type: 'start-video', videoId: vjs.videos[0].id });
    await page.waitForFunction(() =>
      document
        .querySelector('#local-translator-root')
        ?.shadowRoot.querySelector('#target')
        .textContent.includes("that's important"),
    );
    assert.ok(
      !(await page.locator('#local-translator-root #target').textContent()).includes(
        'WRONG PLAYER',
      ),
    );
    await command({ type: 'stop' });
    console.log('PASS: real Video.js captions through MAIN-world adapter');

    await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw');
    await page.locator('#local-translator-youtube-button').waitFor();
    assert.equal(await page.locator('#local-translator-dubbing-button').count(), 0);
    assert.ok(
      (await page.locator('#local-translator-youtube-button').getAttribute('title')).includes(
        'Gemini',
      ),
    );
    assert.equal(await page.locator('#local-translator-live-button').count(), 1);
    await popup.bringToFront();
    const beforeDisable = requests.length;
    await popup.locator('#text-enabled').uncheck();
    await popup.getByRole('button', { name: 'Lưu & Áp dụng' }).click();
    await popup.getByRole('status').filter({ hasText: 'Đã lưu cài đặt' }).waitFor();
    await popup.reload();
    await popup.waitForFunction(() => !document.querySelector('.save-btn').disabled);
    assert.equal(await popup.locator('#text-enabled').isChecked(), false);
    assert.equal(await popup.locator('#textModel').isDisabled(), true);
    assert.equal(
      await popup.getByRole('button', { name: 'Dịch trang', exact: true }).isDisabled(),
      true,
    );
    assert.equal(await popup.getByRole('button', { name: 'Kiểm tra kết nối' }).isDisabled(), false);
    await popup.getByRole('button', { name: 'Gemini Live', exact: true }).click();
    assert.equal(
      await popup.getByRole('button', { name: 'Bật/Tắt Live', exact: true }).isDisabled(),
      false,
    );
    await worker.evaluate(() => {
      globalThis.liveValidationSetups = [];
      globalThis.WebSocket = class {
        readyState = 0;
        constructor() { setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
        send(data) {
          globalThis.liveValidationSetups.push(JSON.parse(data));
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) }), 0);
        }
        close() { this.readyState = 3; }
      };
    });
    await popup.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
    await popup.getByRole('status').filter({ hasText: 'Kết nối Gemini Live thành công' }).waitFor();
    await popup.locator('#liveModel-preset').selectOption('gemini-3.1-flash-live-preview');
    assert.equal(await popup.getByRole('status').count(), 0, 'changing model clears the previous green validation');
    await popup.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
    await popup.getByRole('status').filter({ hasText: 'Kết nối Gemini Live thành công' }).waitFor();
    const liveSettings = await worker.evaluate(async () =>
      (await chrome.storage.local.get('geminiSettings')).geminiSettings,
    );
    assert.equal(liveSettings.liveModel, 'gemini-3.1-flash-live-preview', 'Live must use the model just validated without a separate save');
    const validated = await popup.evaluate(async () => {
      const settings = (await chrome.runtime.sendMessage({ type: 'settings-secret' })).data;
      return chrome.runtime.sendMessage({ type: 'gemini-validate', settings });
    });
    assert.equal(validated.ok, true);
    assert.equal(validated.data.provider, 'live');
    const setups = await worker.evaluate(() => globalThis.liveValidationSetups);
    assert.deepEqual(setups.map((message) => message.setup.model), [
      'models/gemini-3.8-live',
      'models/gemini-3.1-flash-live-preview',
      'models/gemini-3.1-flash-live-preview',
    ]);
    assert.equal(requests.length, beforeDisable, 'Live validation must never call REST');
    console.log('PASS: text toggle persists, blocks paid text requests and leaves Live available');
    await popup.getByRole('button', { name: 'Xóa key' }).click();
    await popup.getByRole('status').filter({ hasText: 'Đã xóa API key' }).waitFor();
    await popup.reload();
    await popup.waitForFunction(() => !document.querySelector('.save-btn').disabled);
    assert.equal(await popup.locator('#api-key').inputValue(), '');
    assert.deepEqual(localhost, []);
    assert.deepEqual(errors, []);
    console.log('PASS: Gemini-only YouTube controls, key removal and zero localhost traffic');
  } finally {
    releasePageRequest();
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  const result = spawnSync(process.execPath, ['tests/live-video.cjs'], {
    env: { ...process.env, LT_EXTENSION_OUTPUT: '.output/gemini/chrome-mv3' },
    stdio: 'inherit',
  });
  assert.equal(
    result.status,
    0,
    'Gemini production content handles Live pause/play/seek/navigation UI',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
