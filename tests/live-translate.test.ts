import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  downsampleTo16k,
  floatToPcm16,
  ownsLiveSession,
  appendSamples,
} from '../src/core/live-audio';

test('downsamples 48 kHz mono to 16 kHz PCM', () => {
  const source = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 10));
  assert.equal(downsampleTo16k(source, 48000).length, 1600);
  assert.equal(floatToPcm16(new Float32Array([-1, 0, 1])).byteLength, 6);
});

test('PCM16 conversion clips samples and uses the full signed range', () => {
  const pcm = new Int16Array(floatToPcm16(new Float32Array([-2, -1, 0, 1, 2])));
  assert.deepEqual([...pcm], [-32768, -32768, 0, 32767, 32767]);
});

test('a stop request cannot take ownership of another tab session', () => {
  const session = { tabId: 11 };
  assert.equal(ownsLiveSession(session, 11), true);
  assert.equal(ownsLiveSession(session, 22), false);
  assert.equal(ownsLiveSession(null, 11), false);
});

test('appendSamples drops audio and clears input buffer when paused', () => {
  const session: any = {
    paused: true,
    input: new Float32Array([0.1, 0.2]),
    socket: {},
  };
  appendSamples(session, new Float32Array([0.3, 0.4]));
  assert.equal(session.input.length, 0);
});
