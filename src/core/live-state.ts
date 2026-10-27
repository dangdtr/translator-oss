import type { LiveState, LiveEvent } from '../types/live';

export function nextLiveState(state: LiveState, event: LiveEvent | string): LiveState {
  if (event === 'reset') return 'idle';
  if (event === 'error' && state !== 'idle') return 'error';
  if (event === 'click') {
    if (state === 'idle' || state === 'error') return 'connecting';
    if (state === 'connecting' || state === 'active' || state === 'paused') return 'stopping';
  }
  if (state === 'connecting' && event === 'ready') return 'active';
  if (state === 'stopping' && event === 'stopped') return 'idle';
  if (event === 'pause' && (state === 'active' || state === 'connecting')) return 'paused';
  if (event === 'resume' && state === 'paused') return 'active';
  return state;
}

export const LTLiveState = { nextLiveState };

declare global {
  var LTLiveState: { nextLiveState: typeof nextLiveState };
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).LTLiveState = LTLiveState;
}
