const {chromium} = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'));
  const server = http.createServer((req, res) => {
    if (req.url === '/vendor/video.min.js' || req.url === '/vendor/video-js.css') {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(fs.readFileSync(require.resolve('video.js/dist/' + path.basename(req.url))));
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/videojs-parent') {res.end('<iframe src="/videojs" width="900" height="700"></iframe>');return;}
    if (req.url === '/videojs') {res.end(fs.readFileSync(path.join(__dirname, 'videojs-fixture.html')));return;}
    res.end(fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const extension = path.resolve(__dirname, '../extension');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'translator-test-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const errors = [], noisy = [];
    const logs = [];
    const page = await context.newPage();
    page.on('console', message => {
      if (message.text().startsWith('[LocalTranslator] ')) logs.push(JSON.parse(message.text().slice('[LocalTranslator] '.length)));
      if (message.text().startsWith('[LocalTranslator] ') && ['warning', 'error'].includes(message.type())) noisy.push(message.text());
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    const tabs = await worker.evaluate(() => chrome.tabs.query({}));
    const tab = tabs.find(t => t.url === url);
    assert(tab, 'test tab registered');
    const command = message => worker.evaluate(async ({tabId, message}) => chrome.tabs.sendMessage(tabId, message, {frameId: 0}), {tabId: tab.id, message});
    const inspect = await command({type: 'inspect'});
    assert.equal(inspect.videos.length, 1);
    await command({type: 'start-page'});
    await page.waitForFunction(() => document.querySelectorAll('[data-local-translation]').length >= 2, null, {timeout: 60000});
    const translated = await page.locator('[data-local-translation]').allTextContents();
    assert(translated.every(t => !t.includes('▁') && t.length));
    console.log('PASS: page translation with real local model', translated);
    await page.locator('#local-translator-root #diagnose').click();
    await page.waitForTimeout(100);
    assert(logs.some(l => l.event === 'mode.page.start'));
    assert(logs.some(l => l.event === 'diagnostics' && l.reason === 'manual' && l.mode === 'page'));
    assert(logs.some(l => l.event === 'page.batch'));
    assert(logs.some(l => l.event === 'request.done' && l.type === 'translate'));
    await page.locator('#local-translator-root #retry').click();
    await page.locator('#local-translator-root #status').filter({hasText: 'Chưa chọn video'}).waitFor();
    console.log('PASS: page diagnostics and retry without selected video');
    await command({type: 'stop'});
    assert.equal(await page.locator('[data-local-translation]').count(), 0);
    console.log('PASS: page restoration');
    await command({type: 'start-video', videoId: inspect.videos[0].id});
    await page.waitForFunction(() => document.querySelector('#local-translator-root')?.shadowRoot.querySelector('#target').textContent.length > 0, null, {timeout: 60000});
    await page.waitForFunction(() => document.querySelector('video').volume < 1, null, {timeout: 60000});
    console.log('PASS: native captions translated and real local speech played');
    await page.evaluate(() => document.querySelector('video').pause());
    await page.waitForFunction(() => document.querySelector('video').volume === 1);
    console.log('PASS: pause restores original audio volume');
    await page.locator('#local-translator-root #file').setInputFiles({name: 'example.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:00,000 --> 00:05:00,000\nThis is an imported subtitle.\n')});
    await page.waitForFunction(() => document.querySelector('#local-translator-root')?.shadowRoot.querySelector('#source').textContent === 'This is an imported subtitle.');
    await page.waitForFunction(() => document.querySelector('#local-translator-root')?.shadowRoot.querySelector('#target').textContent.length > 0);
    console.log('PASS: SRT import replaces native captions');
    fs.mkdirSync(path.resolve(__dirname, '../test-results'), {recursive: true});
    await page.screenshot({path: path.resolve(__dirname, '../test-results/video.png')});
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForFunction(() => document.querySelector('#health').textContent.includes('Sẵn sàng'));
    await popup.screenshot({path: path.resolve(__dirname, '../test-results/popup.png')});
    console.log('PASS: popup connects to local service');
    assert.deepEqual(errors, []);
    await command({type: 'stop'});
    assert.equal(await page.locator('#local-translator-root').count(), 0);
    await page.evaluate(url => { const frame = document.createElement('iframe'); frame.src = url + 'embedded'; document.body.append(frame); }, url);
    await page.frameLocator('iframe').locator('video').waitFor();
    const frames = await worker.evaluate(tabId => chrome.webNavigation.getAllFrames({tabId}), tab.id);
    const child = frames.find(f => f.parentFrameId === 0);
    assert(child, 'iframe discovered');
    const childInfo = await worker.evaluate(({tabId, frameId}) => chrome.tabs.sendMessage(tabId, {type: 'inspect'}, {frameId}), {tabId: tab.id, frameId: child.frameId});
    assert.equal(childInfo.videos.length, 1);
    await worker.evaluate(({tabId, frameId, videoId}) => chrome.tabs.sendMessage(tabId, {type: 'start-video', videoId}, {frameId}), {tabId: tab.id, frameId: child.frameId, videoId: childInfo.videos[0].id});
    await page.frameLocator('iframe').locator('#local-translator-root #target').filter({hasText: /chào/i}).waitFor({timeout: 60000});
    console.log('PASS: iframe video detection and subtitle translation');
    const vjsPage = await context.newPage();
    const vjsLogs = [];
    vjsPage.on('pageerror', error => errors.push(error.message));
    vjsPage.on('console', message => {
      if (message.text().startsWith('[LocalTranslator] ')) vjsLogs.push(JSON.parse(message.text().slice('[LocalTranslator] '.length)));
      if (message.text().startsWith('[LocalTranslator] ') && ['warning', 'error'].includes(message.type())) noisy.push(message.text());
    });
    await vjsPage.goto(url + 'videojs-parent');
    const frame = vjsPage.frames().find(f => f.url() === url + 'videojs');
    await frame.waitForFunction(() => window.fixtureReady);
    assert.equal(await frame.evaluate(() => document.querySelector('#vjs_video_3 video').textTracks.length), 0);
    await frame.locator('#vjs_video_3 .vjs-text-track-cue').waitFor();
    const vjsTabs = await worker.evaluate(() => chrome.tabs.query({}));
    const vjsTab = vjsTabs.find(t => t.url === url + 'videojs-parent');
    const vjsFrames = await worker.evaluate(tabId => chrome.webNavigation.getAllFrames({tabId}), vjsTab.id);
    const vjsFrameId = vjsFrames.find(f => f.parentFrameId === 0).frameId;
    const vjsCommand = message => worker.evaluate(({tabId, frameId, message}) => chrome.tabs.sendMessage(tabId, message, {frameId}), {tabId: vjsTab.id, frameId: vjsFrameId, message});
    const vjsInfo = await vjsCommand({type: 'inspect'});
    await vjsCommand({type: 'start-video', videoId: vjsInfo.videos[0].id});
    await frame.locator('#local-translator-root #target').filter({hasText: /quan trọng/i}).waitFor({timeout: 60000});
    assert(vjsLogs.some(l => l.event === 'subtitles.videojs' && l.reason === 'loaded' && l.count === 1));
    assert.equal(await frame.evaluate(() => window.fixturePlayer.textTracks()[0].mode), 'showing');
    console.log('PASS: real Video.js 8 emulated captions in iframe, native tracks empty, paused translation');
    // Simulate a site bundling Video.js privately so MAIN-world player APIs are unavailable.
    await frame.evaluate(() => {document.querySelector('#vjs_video_3').player = null;window.videojs = undefined;});
    await vjsCommand({type: 'start-video', videoId: vjsInfo.videos[0].id});
    await frame.locator('#local-translator-root #target').filter({hasText: /quan trọng/i}).waitFor({timeout: 60000});
    assert(vjsLogs.some(l => l.event === 'subtitles.visible-translated' && l.source === 'videojs-visible-cc' && l.paused));
    assert.equal(await frame.locator('#local-translator-root #source').textContent(), "that's important to keep in mind.");
    console.log('PASS: Video.js visible CC fallback while paused; ignores captions from other player');
    await frame.locator('#local-translator-root #test-voice').click();
    await frame.locator('#local-translator-root #voice-status').filter({hasText: 'đã phát tiếng bíp và câu thử'}).waitFor();
    await frame.evaluate(() => document.querySelector('#vjs_video_3 video').play());
    await frame.waitForFunction(() => document.querySelector('#vjs_video_3 video').volume < 1);
    // Let the caption's narration get under way, so resuming has somewhere to resume from.
    await frame.waitForTimeout(600);
    await frame.evaluate(() => window.fixturePlayer.pause());
    await frame.waitForFunction(() => document.querySelector('#vjs_video_3 video').volume === 1);
    console.log('PASS: Video.js fallback speaks on resume and stops on pause');
    // Visible-CC narration resumes mid-caption too, like the native-track path.
    const live = () => vjsLogs.filter(l => l.event === 'speech.playing' && l.cue === 'live');
    const spokenBefore = live().length;
    await frame.evaluate(() => document.querySelector('#vjs_video_3 video').play());
    for (const end = Date.now() + 20000; live().length <= spokenBefore && Date.now() < end;) {
      await new Promise(r => setTimeout(r, 100));
    }
    const liveResumed = live().at(-1);
    assert(live().length > spokenBefore && liveResumed.resumeFrom > .1,
      `visible-CC narration resumes mid-caption: ${JSON.stringify(live().slice(spokenBefore))}`);
    console.log(`PASS: visible-CC narration resumes at ${liveResumed.resumeFrom.toFixed(2)} s instead of restarting the caption`);
    await frame.evaluate(() => {document.querySelector('#vjs_video_3 .vjs-text-track-cue').style.display = 'none';});
    await frame.waitForFunction(() => document.querySelector('#local-translator-root')?.shadowRoot.querySelector('#source').textContent === '');
    assert.equal(await frame.locator('#local-translator-root #target').textContent(), '');
    console.log('PASS: hiding CC clears stale translation');
    await vjsCommand({type: 'stop'});
    assert.deepEqual(errors, []);
    assert(logs.some(l => l.event === 'subtitles.ready' && l.count > 0));
    assert(logs.some(l => l.event === 'diagnostics' && l.scope === 'iframe' && l.mode === 'video'));
    const logText = JSON.stringify(logs);
    assert(!logText.includes(fs.readFileSync(path.resolve(__dirname, '../.cache/token'), 'utf8').trim()));
    assert(!logText.includes('Hello. Welcome to this video. Today we are learning English.'));
    fs.writeFileSync(path.resolve(__dirname, '../test-results/console.json'), JSON.stringify(logs, null, 2));
    console.log('PASS: console traces include frame/mode/request metadata without token or source transcript');
    assert.deepEqual(noisy, []);
    console.log('PASS: clean shutdown; no page errors and no warning/error logs for chrome://extensions → Errors');
  } finally {
    await context?.close(); server.close(); fs.rmSync(profile, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
