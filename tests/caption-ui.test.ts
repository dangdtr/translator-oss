import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../src/ui/caption-ui';

test('caption-ui exports all required API methods', () => {
  assert.equal(typeof ui.ensure, 'function');
  assert.equal(typeof ui.setBadge, 'function');
  assert.equal(typeof ui.setText, 'function');
  assert.equal(typeof ui.setLoading, 'function');
  assert.equal(typeof ui.remove, 'function');
  assert.equal(typeof ui.isConnected, 'function');
  assert.equal(typeof ui.getHost, 'function');
  assert.equal(typeof ui.getUi, 'function');
  assert.equal(typeof ui.setOnLiveToggle, 'function');
});

test('caption-ui methods can be safely called in non-browser environment without throwing', () => {
  assert.equal(ui.isConnected(), false);
  assert.equal(ui.getHost(), null);
  assert.equal(ui.getUi(), null);
  assert.doesNotThrow(() => ui.setBadge('live', 'active'));
  assert.doesNotThrow(() => ui.setBadge('offline'));
  assert.doesNotThrow(() => ui.setLoading());
  assert.doesNotThrow(() => ui.remove());
});
