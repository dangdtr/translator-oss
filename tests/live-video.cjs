// Runs the production content script against a real HTMLVideoElement. Chrome
// messaging is mocked; Gemini/audio transport are covered by the session tests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

function silence() {
  const length = 20 * 8000 * 2;
  const wav = Buffer.alloc(44 + length);
  wav.write('RIFF'); wav.writeUInt32LE(36 + length, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(length, 40);
  return wav;
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://www.youtube.com/**', route => {
      if (route.request().url().endsWith('/silence.wav')) {
        return route.fulfill({ contentType: 'audio/wav', body: silence() });
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html>
        <div id="movie_player"><video src="/silence.wav" preload="auto"></video>
        <div class="ytp-chrome-bottom"><div class="ytp-chrome-controls">
        <div class="ytp-right-controls"></div></div></div></div>` });
    });
    await page.goto('https://www.youtube.com/watch?v=test');
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    await page.evaluate(() => {
      window.commands = [];
      const listeners = [];
      Object.defineProperty(window, 'chrome', { configurable: true, value: {
        runtime: { id: 'test', getManifest: () => ({ version: 'test' }),
          getURL: path => `https://www.youtube.com/${path}`,
          onMessage: { addListener: listener => listeners.push(listener) },
          sendMessage: async command => { window.commands.push(command); return { ok: true, data: {} }; } },
        storage: { local: { get: async () => ({}) } },
      } });
      window.command = message => {
        for (const listener of listeners) listener(message, {}, () => {});
      };
    });
    await page.addScriptTag({ path: path.resolve(process.env.LT_EXTENSION_OUTPUT || '.output/chrome-mv3', 'content-scripts/content.js') });
    const state = phase => page.evaluate(phase => window.command({ type: 'live-ui', phase }), phase);
    const paused = () => page.evaluate(() => document.querySelector('video').paused);
    const latest = type => page.evaluate(type => window.commands.filter(c => c.type === type).at(-1), type);
    const waitCommand = type => page.waitForFunction(type => window.commands.some(c => c.type === type), type);

    await page.evaluate(() => document.querySelector('video').play());
    await state('connecting');
    await page.evaluate(() => window.command({ type: 'live-hold' }));
    assert.equal(await paused(), true);
    await state('active');
    await page.waitForFunction(() => !document.querySelector('video').paused);
    await page.evaluate(() => window.command({ type: 'live-ui', phase: 'transcript',
      original: 'Hello', translation: 'Xin' }));
    assert.equal(await page.locator('#local-translator-root #target').textContent(), 'Xin');
    await page.evaluate(() => window.command({ type: 'live-ui', phase: 'transcript',
      original: 'Long continuous speech without a completed turn. '.repeat(100) + 'LATEST SOURCE',
      translation: 'Đoạn dịch liên tục dài chưa kết thúc lượt nói. '.repeat(100) + 'PHẦN MỚI NHẤT' }));
    for (const [selector, lines] of [['#source', 2], ['#target', 3]]) {
      const metrics = await page.locator(`#local-translator-root ${selector}`).evaluate(element => ({
        height: element.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(element).lineHeight),
        scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      }));
      assert.ok(metrics.height <= metrics.lineHeight * lines + 1, `${selector} must stay within ${lines} lines`);
      assert.ok(metrics.scrollTop > 0, `${selector} must follow the latest text`);
      assert.ok(metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= 1);
    }
    await page.locator('#local-translator-root #subtitle-visibility').click();
    assert.equal(await page.locator('#local-translator-root #target').isVisible(), false);
    assert.equal(await paused(), false);

    await page.evaluate(() => document.querySelector('video').pause());
    await waitCommand('live-pause');
    await page.evaluate(() => document.querySelector('video').play());
    await waitCommand('live-resume');
    assert.equal(await paused(), true); // wait for fresh Gemini readiness
    await state('active');
    await page.waitForFunction(() => !document.querySelector('video').paused);

    await page.evaluate(() => { document.querySelector('video').currentTime = 5; });
    await page.waitForFunction(() => window.commands.some(c => c.type === 'live-seek' && c.complete));
    assert.equal((await latest('live-seek')).paused, false);
    assert.equal(await paused(), true);
    await state('active');
    await page.waitForFunction(() => !document.querySelector('video').paused);

    await page.evaluate(() => { window.commands = []; document.querySelector('video').pause(); });
    await waitCommand('live-pause');
    await page.evaluate(() => { document.querySelector('video').currentTime = 10; });
    await page.waitForFunction(() => window.commands.some(c => c.type === 'live-seek' && c.complete));
    assert.equal((await latest('live-seek')).paused, true);
    await state('paused');
    assert.equal(await paused(), true);

    await page.evaluate(() => {
      history.pushState({}, '', '/watch?v=next');
      window.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await waitCommand('live-stop');
    assert.equal(await page.locator('#local-translator-root').count(), 0);
    await state('stopped');
    assert.equal(await paused(), true);

    await state('connecting');
    await state('paused');
    await page.evaluate(() => { window.commands = []; history.pushState({}, '', '/');
      window.dispatchEvent(new Event('yt-navigate-finish')); });
    await waitCommand('live-stop');
    await state('stopped');
    assert.equal(await page.locator('#local-translator-root').count(), 0);

    await page.evaluate(() => { history.pushState({}, '', '/watch?v=third'); window.commands = []; });
    await state('connecting');
    await state('paused');
    await page.evaluate(() => document.querySelector('video').remove());
    await waitCommand('live-stop');
    assert.equal(await page.locator('#local-translator-root').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Live video browser checks passed: startup, partial captions, hide, pause/resume, seek, navigation, player removal.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
