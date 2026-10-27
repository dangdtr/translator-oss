const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

function wav(seconds) {
  const length = seconds * 8000 * 2;
  const buffer = Buffer.alloc(44 + length);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + length, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(length, 40);
  return buffer;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://www.youtube.com/**', route => {
      if (route.request().url().endsWith('/video.wav')) {
        const audio = wav(40);
        const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
          return route.fulfill({ status: 206, contentType: 'audio/wav',
            headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${audio.length}` },
            body: audio.subarray(start, end + 1) });
        }
        return route.fulfill({ contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: audio });
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><div id="movie_player">
          <video src="/video.wav" preload="auto"></video><div class="ytp-chrome-bottom">
          <div class="ytp-chrome-controls"><div class="ytp-right-controls"></div></div></div></div>` });
    });
    await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw');
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    await page.evaluate(() => {
      window.commands = []; window.pendingSegments = {}; window.starts = 0; window.stops = 0;
      const start = AudioBufferSourceNode.prototype.start;
      const stop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.start = function (...args) { window.starts++; return start.apply(this, args); };
      AudioBufferSourceNode.prototype.stop = function (...args) { window.stops++; return stop.apply(this, args); };
      Object.defineProperty(window, 'chrome', { configurable: true, value: {
        runtime: { id: 'test', getManifest: () => ({ version: 'test' }), getURL: p => 'https://www.youtube.com/' + p,
          onMessage: { addListener: () => {} }, sendMessage: async command => {
            window.commands.push(command);
            if (command.type === 'dubbing-segment') return new Promise(resolve => {
              window.pendingSegments[command.index] = segment => resolve({ ok: true, data: segment });
            });
            return { ok: true, data: {} };
          } }, storage: { local: { get: async () => ({}) } },
      } });
    });
    await page.addScriptTag({ path: path.resolve('.output/chrome-mv3/content-scripts/content.js') });
    const resolve = async (index, voiceDuration = 4) => {
      await page.waitForFunction(index => Boolean(window.pendingSegments[index]), index);
      await page.evaluate(({ index, audio, voiceDuration }) => window.pendingSegments[index]({
        videoId: 'jNQXAC9IVRw', index, start: index * 12, end: Math.min(40, index * 12 + 12),
        videoDuration: 40, voiceDuration, audio, original: 'Hello ' + index, translation: 'Xin chào ' + index,
      }), { index, voiceDuration, audio: wav(voiceDuration).toString('base64') });
    };
    await page.evaluate(() => document.querySelector('video').play());
    await page.locator('#local-translator-dubbing-button').click();
    await page.waitForFunction(() => Boolean(window.pendingSegments[0]));
    assert.equal(await page.evaluate(() => Boolean(window.pendingSegments[1]) || Boolean(window.pendingSegments[2])), false);
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true);
    await resolve(0);
    await page.waitForFunction(() => !document.querySelector('video').paused && window.starts === 1);
    assert.equal(await page.evaluate(() => document.querySelector('video').muted), true);
    assert.equal(await page.locator('#local-translator-root #target').textContent(), 'Xin chào 0');
    await page.locator('#local-translator-root #subtitle-visibility').click();
    assert.equal(await page.locator('#local-translator-root #target').isVisible(), false);
    await page.evaluate(() => document.querySelector('video').pause());
    await page.waitForFunction(() => window.stops >= 1);
    await page.evaluate(() => document.querySelector('video').play());
    await page.waitForFunction(() => window.starts === 2);
    // Seeking cuts immediately and holds for the pending next segment.
    await page.evaluate(() => { document.querySelector('video').currentTime = 13; });
    await page.waitForFunction(() => document.querySelector('video').paused && window.stops >= 2);
    await resolve(1, 18);
    await page.waitForFunction(() => !document.querySelector('video').paused && window.starts >= 3);
    assert.ok(await page.evaluate(() => document.querySelector('video').playbackRate < 1));
    // Paused seek stays paused after the new segment becomes ready.
    await page.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 25; });
    await resolve(2);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true);
    const starts = await page.evaluate(() => window.starts);
    await page.evaluate(() => document.querySelector('video').play());
    await page.waitForFunction(starts => !document.querySelector('video').paused && window.starts > starts, starts);
    // Navigation restores mute and selected speed; late speculative responses cannot resume.
    await page.evaluate(() => history.pushState({}, '', '/'));
    await page.waitForFunction(() => !document.querySelector('video').muted);
    assert.equal(await page.evaluate(() => document.querySelector('video').playbackRate), 1);
    assert.equal(await page.locator('#local-translator-root').count(), 0);
    assert.equal(await page.evaluate(() => window.commands.some(c => c.type === 'live-toggle')), false);

    // A seek must request the target without waiting for the old unresolved request.
    await page.evaluate(() => {
      history.pushState({}, '', '/watch?v=jNQXAC9IVRw');
      window.pendingSegments = {}; window.commands = [];
      const old = document.querySelector('video');
      old.replaceWith(old.cloneNode(true));
    });
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    await page.evaluate(() => document.querySelector('video').play());
    await page.locator('#local-translator-dubbing-button').click();
    await page.waitForFunction(() => Boolean(window.pendingSegments[0]));
    await page.evaluate(() => { document.querySelector('video').currentTime = 25; });
    await page.waitForFunction(() => Boolean(window.pendingSegments[2]), null, { timeout: 5000 });
    assert.ok(await page.evaluate(() => window.commands.some(c => c.type === 'dubbing-cancel')));
    await resolve(2);
    await page.waitForFunction(() => !document.querySelector('video').paused);
    await resolve(0); // old response cannot replace the target or restart stale voice
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#local-translator-root #target').textContent(), 'Xin chào 2');
    await page.locator('#local-translator-dubbing-button').click();
    assert.deepEqual(errors, []);
    console.log('Segmented dubbing Chromium playback: passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
