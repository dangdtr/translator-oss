// Real Chrome tabCapture, offscreen document, AudioWorklet and PCM playback.
// Only Gemini's WebSocket responses are simulated; no real key is required.
const { chromium } = require('playwright');
const { createHash } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const extension = path.resolve('.output/gemini/chrome-mv3');
  const id = createHash('sha256').update(extension).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  const profile = mkdtempSync(path.join(tmpdir(), 'gemini-capture-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      ignoreDefaultArgs: ['--mute-audio'],
      args: [
        `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        // Grant tabCapture in automation instead of clicking Chrome's toolbar icon.
        `--allowlisted-extension-id=${id}`, '--autoplay-policy=no-user-gesture-required',
      ],
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    assert.equal(new URL(worker.url()).host, id);
    await context.route('https://www.youtube.com/**', (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Capture tone fixture</title><video controls muted></video><canvas width="320" height="180"></canvas>',
    }));
    const source = await context.newPage();
    await source.goto('https://www.youtube.com/watch?v=capture-test');
    await source.evaluate(async () => {
      const canvas = document.querySelector('canvas');
      const drawing = canvas.getContext('2d');
      const draw = () => drawing.fillRect(0, 0, canvas.width, canvas.height);
      draw();
      setInterval(draw, 100);
      const video = document.querySelector('video');
      video.srcObject = canvas.captureStream(10);
      await video.play();
      const audio = new AudioContext();
      await audio.resume();
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      gain.gain.value = 0.1;
      tone.frequency.value = 440;
      tone.connect(gain).connect(audio.destination);
      tone.start();
      window.toneAudio = audio;
    });
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ geminiSettings: { apiKey: 'capture-fixture-key', mode: 'live', textEnabled: false } });
      await chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
        justification: 'Verify actual tab audio capture and playback',
      });
    });
    const cdp = await context.browser().newBrowserCDPSession();
    const targets = await cdp.send('Target.getTargets');
    const target = targets.targetInfos.find((item) => item.url === `chrome-extension://${id}/offscreen.html`);
    assert.ok(target, 'real offscreen document exists');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    let nextId = 0;
    const pending = new Map();
    cdp.on('Target.receivedMessageFromTarget', (event) => {
      if (event.sessionId !== sessionId) return;
      const result = JSON.parse(event.message);
      const resolve = pending.get(result.id);
      if (resolve) { pending.delete(result.id); resolve(result); }
    });
    async function evaluate(expression) {
      const commandId = ++nextId;
      const response = new Promise((resolve) => pending.set(commandId, resolve));
      await cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id: commandId, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }),
      });
      const result = await response;
      assert.ok(!result.error && !result.result.exceptionDetails, JSON.stringify(result));
      return result.result.result.value;
    }
    await evaluate(`(() => {
      globalThis.captureTest = { packets: 0, nonSilent: false, outputs: 0, streams: [] };
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await getUserMedia(constraints);
        captureTest.streams.push(stream);
        return stream;
      };
      globalThis.WebSocket = class {
        static OPEN = 1;
        readyState = 0;
        bufferedAmount = 0;
        constructor() { setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
        send(data) {
          const message = JSON.parse(data);
          if (message.setup) {
            setTimeout(() => this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) }), 0);
            return;
          }
          const pcm = message.realtimeInput?.audio;
          if (!pcm) return;
          captureTest.packets++;
          const binary = atob(pcm.data);
          if (![...binary].some((value) => value.charCodeAt(0) !== 0)) return;
          captureTest.nonSilent = true;
          if (captureTest.outputs++) return;
          const samples = new Int16Array(2400);
          for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin(i / 8) * 3000);
          const output = btoa(String.fromCharCode(...new Uint8Array(samples.buffer)));
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({ serverContent: {
            modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: output } }] },
          } }) }), 0);
        }
        close() { this.readyState = 3; }
      };
    })()`);
    const tabs = await worker.evaluate(() => chrome.tabs.query({}));
    const tabId = tabs.find((tab) => tab.url?.includes('capture-test')).id;
    // Repeat with fresh one-use stream IDs to verify cleanup and restarting.
    for (let attempt = 0; attempt < 2; attempt++) {
      await evaluate('captureTest.packets = 0; captureTest.nonSilent = false; captureTest.outputs = 0;');
      const result = await worker.evaluate(async (tabId) => {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
        return chrome.runtime.sendMessage({ target: 'live-offscreen', type: 'start', tabId, streamId, sessionId: 'capture-test' });
      }, tabId);
      assert.equal(result.ok, true, `actual capture startup: ${JSON.stringify(result)}`);
      let state;
      const deadline = Date.now() + 8000;
      do {
        state = await worker.evaluate(() => chrome.runtime.sendMessage({ target: 'live-offscreen', type: 'state' }));
        if (state.timings?.['playback-scheduled'] !== undefined) break;
        await source.waitForTimeout(50);
      } while (Date.now() < deadline);
      assert.ok(state.timings?.['playback-scheduled'] !== undefined, JSON.stringify(state));
      assert.equal(await evaluate('captureTest.nonSilent'), true, 'actual tab tone reaches Gemini PCM input');
      console.log('PASS: real Chrome capture → AudioWorklet → PCM send → simulated Gemini audio → playback', state.timings);
      await worker.evaluate((tabId) => chrome.runtime.sendMessage({ target: 'live-offscreen', type: 'stop', tabId }), tabId);
      assert.equal(await evaluate('captureTest.streams.every(stream => stream.getTracks().every(track => track.readyState === "ended"))'), true);
    }
  } finally {
    await context?.close();
    rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
