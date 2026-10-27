const {chromium} = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

// 20 s of silence: a seekable media file allowed by `media-src 'self'`.
function silence(seconds = 20, rate = 8000) {
  const n = seconds * rate, wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
  return wav;
}
const lesson = cues => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Cues</title>
<video id="video" src="/silence.wav" muted preload="auto"></video><script>
const track = document.querySelector('video').addTextTrack('subtitles', 'English', 'en'); track.mode = 'hidden';
for (const [start, end, text] of ${JSON.stringify(cues)}) track.addCue(new VTTCue(start, end, text));
</script></html>`;
// The first caption is shorter than its Vietnamese narration.
const split = lesson([[0, 1, 'Hello. Welcome to this video.'], [1, 20, 'Today we are learning English.']]);
// One sentence broken across two caption lines.
const merge = lesson([[0, 2, 'Amazon EC2 provides secure, resizable compute capacity'], [2, 5.5, 'so you can launch virtual servers in minutes.']]);

(async () => {
  let port;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (['/parent', '/split-parent', '/merge-parent'].includes(req.url)) {
      const child = {'/parent': 'lesson', '/split-parent': 'split', '/merge-parent': 'merge'}[req.url];
      res.end(`<iframe src="http://localhost:${port}/${child}" allow="autoplay 'none'" width="1000" height="800"></iframe>`);
      return;
    }
    // Reproduce a lesson which disallows blob media and does not delegate autoplay.
    res.setHeader('Content-Security-Policy', "media-src 'self'");
    if (req.url === '/silence.wav') { res.setHeader('Content-Type', 'audio/wav'); res.end(silence()); }
    else if (req.url === '/split') res.end(split);
    else if (req.url === '/merge') res.end(merge);
    else res.end(fs.readFileSync(path.join(__dirname, 'fixture.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  const extension = path.resolve(__dirname, '../extension');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'translator-audio-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--autoplay-policy=document-user-activation-required',
        '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies']
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const offscreen = () => worker.evaluate(async () => {
      const [doc] = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
      return doc ? chrome.runtime.sendMessage({target: 'offscreen', type: 'state'}) : {exists: false, playing: false};
    });
    const until = async (check, message, timeout = 10000) => {
      for (const end = Date.now() + timeout; Date.now() < end; await new Promise(r => setTimeout(r, 100))) if (await check()) return;
      throw new Error('Timed out: ' + message);
    };
    // warn/error show up in chrome://extensions → Errors; normal runs must not produce any.
    const errors = [], noisy = [];
    const open = async (route, lessonPath) => {
      const page = await context.newPage(), logs = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (!message.text().startsWith('[LocalTranslator] ')) return;
        logs.push(JSON.parse(message.text().slice('[LocalTranslator] '.length)));
        if (['warning', 'error'].includes(message.type())) noisy.push(message.text());
      });
      const url = `http://127.0.0.1:${port}/${route}`;
      await page.goto(url);
      const frame = page.frames().find(f => f.url().endsWith(lessonPath));
      await frame.waitForFunction(() => document.querySelector('video').readyState >= 2);
      const tab = (await worker.evaluate(() => chrome.tabs.query({}))).find(t => t.url === url);
      const frames = await worker.evaluate(tabId => chrome.webNavigation.getAllFrames({tabId}), tab.id);
      const frameId = frames.find(f => f.url.endsWith(lessonPath)).frameId;
      const command = message => worker.evaluate(({tabId, frameId, message}) => chrome.tabs.sendMessage(tabId, message, {frameId}), {tabId: tab.id, frameId, message});
      return {page, frame, logs, command, owner: {tabId: tab.id, frameId}};
    };

    const {page, frame, logs, command} = await open('parent', '/lesson');
    const info = await command({type: 'inspect'});
    await command({type: 'start-video', videoId: info.videos[0].id});
    await frame.locator('#local-translator-root #target').filter({hasText: /chào/i}).waitFor({timeout: 60000});
    await until(() => logs.some(l => l.event === 'speech.playing' && l.sample === false), 'narration starts', 30000);
    await frame.waitForFunction(() => document.querySelector('video').volume < 1);
    // Playwright evaluations count as gestures in the page, so check the document that actually plays.
    const playing = await offscreen();
    assert(playing.playing && playing.activated === false, JSON.stringify(playing));
    console.log('PASS: narration plays with no user gesture in a cross-origin iframe with autoplay \'none\' and media-src \'self\'');

    await frame.evaluate(() => document.querySelector('video').pause());
    assert.equal(await frame.evaluate(() => document.querySelector('video').volume), 1);
    await until(async () => !(await offscreen()).playing, 'offscreen stops on pause');
    console.log('PASS: pause stops offscreen narration and restores volume');

    await frame.locator('#local-translator-root #test-voice').click();
    await frame.locator('#local-translator-root #voice-status').filter({hasText: 'đang phát câu thử'}).waitFor();
    const sample = logs.find(l => l.event === 'speech.playing' && l.sample);
    assert(sample && sample.duration > 1 && sample.rate === 1);
    await frame.locator('#local-translator-root #voice-status').filter({hasText: 'đã phát tiếng bíp và câu thử'}).waitFor();
    assert.equal(await frame.evaluate(() => document.querySelector('video').volume), 1);
    console.log('PASS: voice test plays tone then sample while paused, without ducking');

    await frame.evaluate(() => document.querySelector('video').play());
    await frame.waitForFunction(() => document.querySelector('video').volume < 1);
    await frame.evaluate(() => document.querySelector('video').pause());
    assert.equal(await frame.evaluate(() => document.querySelector('video').volume), 1);
    console.log('PASS: narration resumes on play and stops on pause');

    await frame.locator('#local-translator-root #dub').uncheck();
    await frame.evaluate(() => document.querySelector('video').play());
    await frame.waitForTimeout(600);
    assert.equal(await frame.evaluate(() => document.querySelector('video').volume), 1);
    assert.equal((await offscreen()).playing, false);
    await frame.locator('#local-translator-root #dub').check();
    await frame.waitForFunction(() => document.querySelector('video').volume < 1);
    await command({type: 'stop'});
    assert.equal(await frame.evaluate(() => document.querySelector('video').volume), 1);
    await until(async () => !(await offscreen()).playing, 'offscreen stops on stop command');
    console.log('PASS: voice toggle and stop cancel narration cleanly');

    await frame.evaluate(() => document.querySelector('video').play());
    await command({type: 'start-video', videoId: info.videos[0].id});
    await until(async () => (await offscreen()).playing, 'narration restarts', 30000);
    await page.close();
    await until(async () => !(await offscreen()).playing, 'offscreen stops when tab closes', 3000);
    console.log('PASS: closing the tab stops its narration');

    const splitTab = await open('split-parent', '/split');
    const splitInfo = await splitTab.command({type: 'inspect'});
    await splitTab.command({type: 'start-video', videoId: splitInfo.videos[0].id});
    await splitTab.frame.locator('#local-translator-root #status').filter({hasText: '2 câu đã dịch'}).waitFor({timeout: 60000});
    await splitTab.frame.evaluate(() => document.querySelector('video').play());
    await until(() => splitTab.logs.some(l => l.event === 'speech.playing' && l.cue === 1), 'second cue narrated', 15000);
    const events = splitTab.logs.filter(l => /^speech\.(playing|ended|skipped|failed)$/.test(l.event));
    const first = events.findIndex(l => l.event === 'speech.playing' && l.cue === 0);
    const ended = events.findIndex(l => l.event === 'speech.ended' && l.cue === 0);
    const second = events.findIndex(l => l.event === 'speech.playing' && l.cue === 1);
    assert(first >= 0 && first < ended && ended < second, JSON.stringify(events));
    assert(events[ended].currentTime > 1, 'first narration ran past its 1 s caption');
    assert(events[first].rate > 1 && events[first].rate <= 1.75);
    console.log(`PASS: narration is not cut at cue boundary (cue 0 ended at ${events[ended].currentTime.toFixed(2)} s, rate ${events[first].rate.toFixed(2)}), next cue follows`);

    // Pause mid-sentence and resume: narration must carry on from where it stopped
    // rather than replaying the interrupted sentence from its first word.
    const played = () => splitTab.logs.filter(l => l.event === 'speech.playing' && l.cue === 1);
    await splitTab.frame.waitForTimeout(700);
    await splitTab.frame.evaluate(() => document.querySelector('video').pause());
    await until(async () => !(await offscreen()).playing, 'offscreen stops on pause');
    const before = played().length;
    await splitTab.frame.evaluate(() => document.querySelector('video').play());
    await until(() => played().length > before, 'narration continues after resume', 20000);
    const resumed = played().at(-1);
    assert(resumed.resumeFrom > .1, `resumed mid-sentence: ${JSON.stringify(resumed)}`);
    assert.equal(played()[0].resumeFrom, 0, 'the sentence starts at its beginning the first time');
    console.log(`PASS: pause then play continues the sentence at ${resumed.resumeFrom.toFixed(2)} s instead of replaying it`);
    await splitTab.command({type: 'stop'});

    const mergeTab = await open('merge-parent', '/merge');
    const mergeInfo = await mergeTab.command({type: 'inspect'});
    await mergeTab.command({type: 'start-video', videoId: mergeInfo.videos[0].id});
    await mergeTab.frame.locator('#local-translator-root #status').filter({hasText: '1 câu (2 dòng) · 1 câu đã dịch'}).waitFor({timeout: 60000});
    assert.equal(await mergeTab.frame.locator('#local-translator-root #source').textContent(),
      'Amazon EC2 provides secure, resizable compute capacity so you can launch virtual servers in minutes.');
    await mergeTab.frame.locator('#local-translator-root #target').filter({hasText: /\S/}).waitFor();
    const merged = await mergeTab.frame.locator('#local-translator-root #target').textContent();
    assert(merged.includes('Amazon EC2') && merged.includes('máy chủ ảo'), merged);
    await mergeTab.frame.evaluate(() => document.querySelector('video').play());
    await until(() => mergeTab.logs.some(l => l.event === 'speech.ended' && l.cue === 0), 'merged sentence narrated', 20000);
    await mergeTab.frame.waitForFunction(() => document.querySelector('video').currentTime > 2.5);
    assert(!mergeTab.logs.some(l => l.event === 'speech.playing' && l.cue !== 0));
    console.log(`PASS: two caption lines are translated and narrated as one sentence: "${merged}"`);
    await mergeTab.command({type: 'stop'});

    // Voice choice and the natural-voice deadline, driven through the worker's offscreen() helper.
    const health = await worker.evaluate(async () => (await fetch(LOCAL_CONFIG.url + '/health')).json());
    const direct = message => worker.evaluate(m => offscreen(m), message);
    const probe = `Đây là câu kiểm tra giọng dự phòng số ${Date.now() % 100000}.`;
    const late = await direct({type: 'play', owner: mergeTab.owner, id: 9001, text: probe, available: 3, minRate: 1, maxRate: 1.75, voice: 'auto', wait: 0});
    assert(late.ok && late.engine === 'piper' && late.fallback === health.voices.vieneu, JSON.stringify(late));
    await direct({type: 'stop', owner: mergeTab.owner});
    if (health.voices.vieneu) {
      const natural = await direct({type: 'play', owner: mergeTab.owner, id: 9002, text: probe, available: 3, minRate: 1, maxRate: 1.75, voice: 'auto', wait: 60000});
      assert(natural.ok && natural.engine === 'vieneu' && !natural.fallback, JSON.stringify(natural));
      await direct({type: 'stop', owner: mergeTab.owner});
    }
    console.log(`PASS: ${health.voices.vieneu ? 'VieNeu speaks when ready; ' : ''}Piper speaks when the natural voice misses its deadline`);

    // The seek itself: a startAt must land the clip part-way in, and the duration
    // reported back must be what is left, so the caller's watchdog stays honest.
    const long = `${probe} ${probe} ${probe}`;
    const whole = await direct({type: 'play', owner: mergeTab.owner, id: 9101, text: long, available: 30, minRate: 1, maxRate: 1.75, voice: 'piper', wait: 0});
    const wholeAt = (await direct({type: 'state', owner: mergeTab.owner})).currentTime;
    await direct({type: 'stop', owner: mergeTab.owner});
    const part = await direct({type: 'play', owner: mergeTab.owner, id: 9102, text: long, available: 30, minRate: 1, maxRate: 1.75, voice: 'piper', wait: 0, startAt: 1});
    const partState = await direct({type: 'state', owner: mergeTab.owner});
    await direct({type: 'stop', owner: mergeTab.owner});
    assert(whole.duration > 2, `probe clip is long enough to seek into: ${JSON.stringify(whole)}`);
    assert(wholeAt < .5, `a clip without startAt starts at zero: ${wholeAt}`);
    assert(partState.currentTime > .9, `startAt seeks into the clip: ${JSON.stringify(partState)}`);
    assert(Math.abs(whole.duration - part.duration - 1) < .05, `duration is the remaining tail: ${whole.duration} vs ${part.duration}`);
    console.log(`PASS: startAt resumes ${partState.currentTime.toFixed(2)} s into the clip and reports the remaining ${part.duration.toFixed(2)} s of ${whole.duration.toFixed(2)} s`);
    await worker.evaluate(() => chrome.storage.local.set({voice: 'piper'}));
    await mergeTab.frame.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 0; });
    await mergeTab.command({type: 'start-video', videoId: mergeInfo.videos[0].id});
    await mergeTab.frame.evaluate(() => document.querySelector('video').play());
    await until(() => mergeTab.logs.some(l => l.event === 'speech.playing' && l.engine === 'piper' && !l.fallback), 'Piper chosen in popup', 20000);
    await mergeTab.command({type: 'stop'});
    await worker.evaluate(() => chrome.storage.local.set({voice: 'auto'}));
    console.log('PASS: choosing Piper in the popup makes narration use Piper');

    // Reloading the extension orphans content scripts already in the page.
    await mergeTab.frame.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 0; });
    await mergeTab.command({type: 'start-video', videoId: mergeInfo.videos[0].id});
    await mergeTab.frame.evaluate(() => document.querySelector('video').play());
    await mergeTab.frame.waitForFunction(() => document.querySelector('video').volume < 1, null, {timeout: 20000});
    await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
    await mergeTab.frame.locator('#local-translator-root #status').filter({hasText: 'Tải lại trang (F5)'}).waitFor({timeout: 5000});
    assert.equal(await mergeTab.frame.evaluate(() => document.querySelector('video').volume), 1);
    await mergeTab.frame.waitForTimeout(1500);
    const orphanedAt = mergeTab.logs.findIndex(l => l.event === 'extension.orphaned');
    assert(orphanedAt >= 0 && !mergeTab.logs.slice(orphanedAt + 1).some(l => l.event === 'request.start'));
    console.log('PASS: extension reload stops the orphaned page script once, restores volume and asks for a page reload');

    assert.deepEqual(errors, []);
    assert.deepEqual(noisy, []);
    console.log('PASS: no warning/error logs in chrome://extensions → Errors during normal use or extension reload');
    fs.mkdirSync(path.resolve(__dirname, '../test-results'), {recursive: true});
    fs.writeFileSync(path.resolve(__dirname, '../test-results/audio-console.json'), JSON.stringify([...logs, ...splitTab.logs, ...mergeTab.logs], null, 2));
  } finally {
    await context?.close(); server.close(); fs.rmSync(profile, {recursive: true, force: true});
  }
})().catch(error => {console.error(error);process.exitCode = 1;});
