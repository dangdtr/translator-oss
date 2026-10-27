import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLiveState } from '../src/core/live-state';

test('toolbar click starts and stops Live mode', () => {
  assert.equal(nextLiveState('idle', 'click'), 'connecting');
  assert.equal(nextLiveState('active', 'click'), 'stopping');
  assert.equal(nextLiveState('connecting', 'click'), 'stopping');
});

test('offscreen events advance or reset Live mode', () => {
  assert.equal(nextLiveState('connecting', 'ready'), 'active');
  assert.equal(nextLiveState('connecting', 'error'), 'error');
  assert.equal(nextLiveState('active', 'error'), 'error');
  assert.equal(nextLiveState('stopping', 'stopped'), 'idle');
  assert.equal(nextLiveState('active', 'reset'), 'idle');
});

test('irrelevant events leave state unchanged', () => {
  assert.equal(nextLiveState('idle', 'ready'), 'idle');
  assert.equal(nextLiveState('active', 'ready'), 'active');
});

test('pause and resume events toggle paused state and click stops from paused', () => {
  assert.equal(nextLiveState('active', 'pause'), 'paused');
  assert.equal(nextLiveState('connecting', 'pause'), 'paused');
  assert.equal(nextLiveState('paused', 'resume'), 'active');
  assert.equal(nextLiveState('paused', 'click'), 'stopping');
  assert.equal(nextLiveState('paused', 'reset'), 'idle');
});
