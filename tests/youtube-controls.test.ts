import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yt from '../src/ui/youtube-controls';

test('youtube-controls exports all required API methods', () => {
  assert.equal(typeof yt.installButtons, 'function');
  assert.equal(typeof yt.observe, 'function');
  assert.equal(typeof yt.updateSubtitleButton, 'function');
  assert.equal(typeof yt.updateLiveButton, 'function');
  assert.equal(typeof yt.watchVideo, 'function');
  assert.equal(typeof yt.getVideo, 'function');
});

test('youtube-controls methods handle non-browser or non-YouTube environment gracefully', () => {
  assert.doesNotThrow(() => yt.updateSubtitleButton(true));
  assert.doesNotThrow(() => yt.updateSubtitleButton(false));
  assert.doesNotThrow(() => yt.updateLiveButton('connecting'));
  assert.doesNotThrow(() => yt.updateLiveButton('active'));
  assert.doesNotThrow(() => yt.updateLiveButton('paused'));
  assert.doesNotThrow(() => yt.updateLiveButton('idle'));
});
