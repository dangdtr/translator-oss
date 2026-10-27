import test from 'node:test';
import assert from 'node:assert/strict';
import { progressText, segmentTiming } from '../src/core/segmented-player';

test('waiting status identifies translation versus voice generation and elapsed time', () => {
  assert.equal(progressText({ stage: 'translate', elapsedSeconds: 15 }, 1),
    'Gemini đang dịch audio · đoạn 2 · đã chờ 15s');
  assert.equal(progressText({ stage: 'tts', elapsedSeconds: 26 }, 0),
    'Đang tạo voice tiếng Việt · đoạn 1 · đã chờ 26s');
});

test('long dubbed voice keeps audio speed bounded and slows video to fit', () => {
  const timing = segmentTiming({ start: 12, end: 24, voiceDuration: 24 }, 1);
  assert.equal(timing.stretch, 2);
  assert.ok(Math.abs(timing.audioRate - 1.35) < 1e-8);
  assert.equal(12 / timing.videoRate, 24 / timing.audioRate);
});

test('short voice leaves silence and follows user playback speed', () => {
  assert.deepEqual(segmentTiming({ start: 0, end: 12, voiceDuration: 5 }, 1.5),
    { stretch: 1, videoRate: 1.5, audioRate: 1.5 });
});
