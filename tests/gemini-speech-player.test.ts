import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechHandlers } from '../src/shared/speech-player';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const clip = () => ({ blob: new Blob(['audio'], { type: 'audio/wav' }), engine: 'gemini' });
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function mockAudio() {
  const saved = ['Audio', 'chrome'].map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  const audios: any[] = [];
  class Audio {
    onloadedmetadata: any;
    onerror: any;
    onended: any;
    duration = 4;
    currentTime = 0;
    paused = true;
    ended = false;
    plays = 0;
    playbackRate = 1;
    defaultPlaybackRate = 1;
    constructor(public url: string) {
      audios.push(this);
      queueMicrotask(() => this.onloadedmetadata?.());
    }
    async play() {
      this.plays++;
      this.paused = false;
    }
    pause() {
      this.paused = true;
    }
  }
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: Audio });
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { sendMessage: async () => {} } },
  });
  return {
    audios,
    restore() {
      saved.forEach(([name, descriptor]) =>
        descriptor
          ? Object.defineProperty(globalThis, name, descriptor)
          : Reflect.deleteProperty(globalThis, name),
      );
    },
  };
}
const owner = { tabId: 42, frameId: 0 };

test('owner stop aborts pending synthesis and a late successful fetch cannot play', async () => {
  const mock = mockAudio(),
    result = deferred<ReturnType<typeof clip>>();
  let signal: AbortSignal | undefined;
  const handlers = createSpeechHandlers({
    synthesize: async (_text, _voice, abort) => {
      signal = abort;
      return result.promise;
    },
  });
  try {
    const pending = handlers.play({ owner, id: 1, text: 'hello' });
    await tick();
    assert.equal(handlers.stop({ owner: { tabId: 99 }, id: 1 }).stopped, false);
    assert.equal(signal?.aborted, false);
    assert.equal(handlers.stop({ owner, id: 1 }).stopped, true);
    assert.equal(signal?.aborted, true);
    result.resolve(clip());
    assert.deepEqual(await pending, { ok: false, reason: 'superseded' });
    assert.equal(mock.audios.length, 0);
  } finally {
    result.resolve(clip());
    handlers.stop({ owner });
    mock.restore();
  }
});

test('superseded synthesis cannot displace a newer clip after loaded metadata', async () => {
  const mock = mockAudio(),
    old = deferred<ReturnType<typeof clip>>();
  const handlers = createSpeechHandlers({
    synthesize: async (text) => (text === 'old' ? old.promise : clip()),
  });
  try {
    const pending = handlers.play({ owner, text: 'old', id: 1 });
    await tick();
    const result = await handlers.play({ owner, text: 'new', id: 2, startAt: 1 });
    assert.equal(result.ok, true);
    assert.equal(result.duration, 3);
    assert.equal(mock.audios[0].plays, 1);
    old.resolve(clip());
    assert.equal((await pending).reason, 'superseded');
    assert.equal(mock.audios.length, 1);
    assert.equal(handlers.stop({ owner, id: 1 }).stopped, false);
    assert.equal(mock.audios[0].paused, false);
  } finally {
    old.resolve(clip());
    handlers.stop({ owner });
    mock.restore();
  }
});

test('speech cache keys include selected voice and provider identity', async () => {
  const mock = mockAudio();
  let identity = 'key-a:model-a',
    calls = 0;
  const handlers = createSpeechHandlers({
    identity: async () => identity,
    synthesize: async () => {
      calls++;
      return clip();
    },
  });
  try {
    await handlers.play({ owner, text: 'same', voice: 'Kore' });
    await handlers.play({ owner, text: 'same', voice: 'Kore' });
    assert.equal(calls, 1);
    await handlers.play({ owner, text: 'same', voice: 'Aoede' });
    assert.equal(calls, 2);
    identity = 'key-b:model-b';
    await handlers.play({ owner, text: 'same', voice: 'Kore' });
    assert.equal(calls, 3);
    assert.equal(mock.audios.length, 4);
    assert.ok(mock.audios.slice(0, 3).every((audio) => audio.paused));
  } finally {
    handlers.stop({ owner });
    mock.restore();
  }
});
test('stop while resolving provider identity cannot submit a paid synthesis afterwards', async () => {
  const pendingIdentity = deferred<string>();
  let calls = 0;
  const handlers = createSpeechHandlers({
    identity: () => pendingIdentity.promise,
    synthesize: async () => {
      calls++;
      return clip();
    },
  });
  const work = handlers.play({ owner, id: 5, text: 'cancel before lookup completes' });
  await tick();
  assert.equal(handlers.stop({ owner, id: 5 }).stopped, true);
  pendingIdentity.resolve('model-identity');
  await assert.rejects(work, /Đã hủy/);
  assert.equal(calls, 0);
});
test('playing a subtitle reuses its in-flight prefetch instead of paying for another generation', async () => {
  const mock = mockAudio();
  const pending = deferred<ReturnType<typeof clip>>();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const handlers = createSpeechHandlers({
    synthesize: async (_text, _voice, abort) => {
      calls++;
      signal = abort;
      return pending.promise;
    },
  });
  try {
    handlers.prefetch({ owner, texts: ['same cue'], voice: 'Kore' });
    await tick();
    const playback = handlers.play({ owner, id: 6, text: 'same cue', voice: 'Kore' });
    await tick();
    assert.equal(calls, 1);
    assert.equal(signal?.aborted, false);
    pending.resolve(clip());
    assert.equal((await playback).ok, true);
  } finally {
    pending.resolve(clip());
    handlers.stop({ owner });
    mock.restore();
  }
});
