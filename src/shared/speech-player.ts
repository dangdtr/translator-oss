import { LTLog } from '../core/logger';
import type { FrameOwner } from '../types/messages';

export interface SpeechPlayerProvider {
  synthesize(
    text: string,
    voice: string,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; engine: string }>;
  identity?(): Promise<string>;
  maxCacheBytes?: number;
  prefetchLimit?: number;
  selectClip?(
    text: string,
    voice: string,
    wait: number | undefined,
    speech: (text: string, voice: string) => Promise<{ blob: Blob; engine: string }>,
  ): Promise<{ blob: Blob; engine: string; fallback: boolean }>;
}

export function createSpeechHandlers(provider: SpeechPlayerProvider) {
  const pending = new Map<AbortController, string>();
  const sizes = new Map<string, number>();
  let cacheBytes = 0;
  const SAMPLE = 'Xin chào. Đây là giọng đọc tiếng Việt.';
  const cache = new Map<string, Promise<{ blob: Blob; engine: string }>>();
  let active: { run: number; owner: FrameOwner; id?: number } | null = null;
  let current: {
    audio: HTMLAudioElement;
    url: string;
    finish: () => void;
    notify: boolean;
    owner: FrameOwner;
    id?: number;
  } | null = null;
  let generation = 0;
  let queue: Array<{ text: string; voice: string }> = [];
  let prefetching = false;
  let prefetchOwner: FrameOwner | null = null;
  let beep: Blob | null = null;

  const sameOwner = (a: FrameOwner, b: FrameOwner) =>
    a.tabId === b.tabId && (b.frameId === undefined || a.frameId === b.frameId);
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

  async function speech(text: string, voice: string = ''): Promise<{ blob: Blob; engine: string }> {
    const run = generation;
    const key = ((await provider.identity?.()) || '') + '\n' + voice + '\n' + text;
    if (run !== generation) throw new Error('Đã hủy yêu cầu giọng.');
    let promise = cache.get(key);
    if (promise) {
      cache.delete(key);
    } else {
      const controller = new AbortController();
      pending.set(controller, key);
      promise = provider
        .synthesize(text, voice, controller.signal)
        .finally(() => pending.delete(controller));
      promise
        .then((clip) => {
          if (cache.get(key) !== promise) return;
          sizes.set(key, clip.blob.size);
          cacheBytes += clip.blob.size;
          while (cacheBytes > (provider.maxCacheBytes ?? 32 * 1024 * 1024)) {
            const first = sizes.keys().next().value;
            if (!first) break;
            cacheBytes -= sizes.get(first) || 0;
            sizes.delete(first);
            cache.delete(first);
          }
        })
        .catch(() => {});
      promise.catch(() => {
        if (cache.get(key) === promise) cache.delete(key);
      });
    }
    cache.set(key, promise);
    while (cache.size > 60) {
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
        cacheBytes -= sizes.get(firstKey) || 0;
        sizes.delete(firstKey);
      }
    }
    return promise;
  }

  function tone(): Blob {
    if (beep) return beep;
    const rate = 22050,
      n = Math.round(rate * 0.35),
      buffer = new ArrayBuffer(44 + n * 2),
      view = new DataView(buffer);
    const write = (offset: number, text: string) =>
      [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    write(0, 'RIFF');
    view.setUint32(4, 36 + n * 2, true);
    write(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const fade = Math.min(1, i / 400, (n - i) / 400);
      view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 440 * i) / rate) * 9000 * fade, true);
    }
    beep = new Blob([buffer], { type: 'audio/wav' });
    return beep;
  }

  function emit(owner: FrameOwner, id: number | undefined, event: string, error?: string): void {
    chrome.runtime.sendMessage({ type: 'speech-event', owner, id, event, error }).catch(() => {});
  }

  function release(): void {
    if (!current) return;
    const { audio, url, finish } = current;
    current = null;
    audio.onended = audio.onerror = null;
    audio.pause();
    URL.revokeObjectURL(url);
    finish();
  }

  function claim(owner: FrameOwner, id?: number, text?: string, voice?: string): number {
    const previousOwner = active?.owner || prefetchOwner;
    const keepMatching = previousOwner && sameOwner(previousOwner, owner);
    if (current?.notify && !sameOwner(current.owner, owner)) {
      emit(current.owner, current.id, 'interrupted');
    }
    release();
    active = { run: ++generation, owner, id };
    for (const [controller, key] of pending) {
      if (keepMatching && key.endsWith('\n' + voice + '\n' + text)) continue;
      controller.abort();
      cache.delete(key);
    }
    queue = [];
    return active.run;
  }

  function stop(owner: FrameOwner, id?: number): { at: number | null } | null {
    if (
      active
        ? !sameOwner(active.owner, owner) || (id !== undefined && active.id !== id)
        : !prefetchOwner || !sameOwner(prefetchOwner, owner) || id !== undefined
    ) {
      return null;
    }
    const audio = current?.audio;
    const at =
      audio && !audio.ended && Number.isFinite(audio.currentTime) ? audio.currentTime : null;
    generation++;
    for (const [controller, key] of pending) {
      controller.abort();
      cache.delete(key);
    }
    queue = [];
    prefetchOwner = null;
    active = null;
    release();
    return { at };
  }

  async function startPlayback(
    blob: Blob,
    rate: (duration: number) => number,
    run: number,
    notify: boolean,
    startAt = 0,
  ): Promise<{ duration: number; rate: number; finished: Promise<void> } | null> {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preservesPitch = true;
    const loaded = await new Promise<boolean>((resolve) => {
      audio.onloadedmetadata = () => resolve(true);
      audio.onerror = () => resolve(false);
    });
    if (!loaded || run !== generation) {
      URL.revokeObjectURL(url);
      if (!loaded) throw new Error('Không giải mã được audio giọng đọc.');
      return null;
    }
    const playbackRate = rate(audio.duration);
    audio.defaultPlaybackRate = audio.playbackRate = playbackRate;
    const from = clamp(startAt, 0, audio.duration);
    if (from > 0) audio.currentTime = from;

    if (!active) return null;
    const { owner, id } = active;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const entry = (current = { audio, url, finish, notify, owner, id });
    audio.onended = () => {
      if (current !== entry) return;
      release();
      if (notify) emit(owner, id, 'ended');
    };
    audio.onerror = () => {
      if (current !== entry) return;
      release();
      if (notify) emit(owner, id, 'error', 'Lỗi phát audio giọng đọc.');
    };
    try {
      await audio.play();
    } catch (error: any) {
      if (current !== entry) return null;
      release();
      throw new Error(
        error.name === 'NotAllowedError'
          ? 'Chrome chặn phát âm thanh của extension (NotAllowedError).'
          : error.message,
      );
    }
    if (current !== entry) return null;
    LTLog('offscreen.playing', { duration: audio.duration, rate: playbackRate, notify, from });
    return { duration: audio.duration - from, rate: playbackRate, finished };
  }

  async function play({
    owner,
    id,
    text,
    voice = 'auto',
    wait,
    startAt = 0,
  }: {
    owner: FrameOwner;
    id?: number;
    text: string;
    voice?: string;
    wait?: number;
    startAt?: number;
  }): Promise<any> {
    const run = claim(owner, id, String(text).slice(0, 1500), voice);
    text = String(text).slice(0, 1500);
    startAt = Math.max(0, Number(startAt) || 0);

    const clip = provider.selectClip
      ? await provider.selectClip(text, voice, wait, speech)
      : { ...(await speech(text, voice)), fallback: false };
    const fallback = clip.fallback;
    if (run !== generation) return { ok: false, reason: 'superseded' };
    if (!clip) return { ok: false, reason: 'failed' };

    const result = await startPlayback(clip.blob, () => 1, run, true, startAt);
    return result
      ? {
          ok: true,
          duration: result.duration,
          rate: result.rate,
          engine: clip.engine,
          fallback,
        }
      : { ok: false, reason: 'superseded' };
  }

  async function test({
    owner,
    id,
    voice = 'auto',
  }: {
    owner: FrameOwner;
    id?: number;
    voice?: string;
  }): Promise<any> {
    const run = claim(owner, id);
    const sample = speech(SAMPLE, voice);
    const signal = await startPlayback(tone(), () => 1, run, false);
    if (!signal) return { ok: false, reason: 'superseded' };
    await signal.finished;
    const clip = await sample;
    if (run !== generation) return { ok: false, reason: 'superseded' };
    const result = await startPlayback(clip.blob, () => 1, run, true);
    return result
      ? {
          ok: true,
          duration: result.duration,
          rate: result.rate,
          engine: clip.engine,
          fallback: false,
        }
      : { ok: false, reason: 'superseded' };
  }

  async function drain(): Promise<void> {
    const run = generation;
    prefetching = true;
    try {
      while (queue.length) {
        const item = queue.shift();
        if (item) await speech(item.text, item.voice).catch(() => {});
        if (run !== generation) break;
      }
    } finally {
      prefetching = false;
      if (queue.length) void drain();
    }
  }

  function prefetch({
    texts,
    owner,
    voice = 'auto',
  }: {
    texts: string[];
    owner?: FrameOwner;
    voice?: string;
  }): { ok: boolean; queued: number } {
    if (owner) prefetchOwner = owner;
    for (const item of Array.isArray(texts) ? texts : []) {
      const text = typeof item === 'string' ? item.slice(0, 1500) : '';
      if (
        text &&
        !cache.has(voice + '\n' + text) &&
        !queue.some((q) => q.text === text && q.voice === voice)
      ) {
        queue.push({ text, voice });
      }
    }
    queue = queue.slice(-(provider.prefetchLimit ?? 12));
    if (!prefetching) drain();
    return { ok: true, queued: queue.length };
  }

  async function warm({
    texts,
    owner,
    voice = 'auto',
  }: {
    texts: string[];
    owner?: FrameOwner;
    voice?: string;
  }): Promise<{ ok: boolean; warmed: number; queued: number }> {
    const run = generation;
    if (owner) prefetchOwner = owner;
    const unique = [
      ...new Set(
        (Array.isArray(texts) ? texts : [])
          .filter((text) => typeof text === 'string' && text.trim())
          .map((text) => text.slice(0, 1500)),
      ),
    ].slice(0, 3);
    const [first, ...later] = unique;
    if (first) await speech(first, voice);
    if (run !== generation) throw new Error('Đã hủy yêu cầu giọng.');
    const queued = later.length ? prefetch({ texts: later, voice, owner }).queued : 0;
    return { ok: true, warmed: first ? 1 : 0, queued };
  }

  function state({ owner }: { owner?: FrameOwner }): Record<string, unknown> {
    const audio = current?.audio;
    return {
      ok: true,
      exists: true,
      mine: Boolean(owner && active && sameOwner(active.owner, owner)),
      playing: Boolean(audio && !audio.paused),
      currentTime: audio?.currentTime ?? null,
      duration: audio?.duration ?? null,
      rate: audio?.playbackRate ?? null,
      volume: audio?.volume ?? null,
      muted: audio?.muted ?? null,
      cached: cache.size,
      queued: queue.length,
      activated: (navigator as any).userActivation?.hasBeenActive ?? true,
    };
  }

  return {
    play,
    test,
    prefetch,
    warm,
    state,
    stop: ({ owner, id }: { owner: FrameOwner; id?: number }) => {
      const result = stop(owner, id);
      return { ok: true, stopped: Boolean(result), at: result?.at ?? null };
    },
  };
}
