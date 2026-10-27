import { GeminiError } from './api';
import type { GeminiSettings } from './settings';
export class Scheduler {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private limit: number) {}
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = this.queue.indexOf(start);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new GeminiError('Aborted'));
      };
      const start = () => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) {
          reject(new GeminiError('Aborted'));
          this.next();
          return;
        }
        this.active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.next();
          });
      };
      if (signal?.aborted) {
        reject(new GeminiError('Aborted'));
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(start);
      this.next();
    });
  }
  private next() {
    while (this.active < this.limit && this.queue.length) this.queue.shift()!();
  }
}
export class BoundedCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  constructor(
    private limit: number,
    private byteLimit = Infinity,
  ) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, bytes = 0) {
    this.delete(key);
    if (bytes > this.byteLimit) return;
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.limit || this.bytes > this.byteLimit)
      this.delete(this.entries.keys().next().value!);
  }
  delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}
export const textScheduler = new Scheduler(2);
export const speechScheduler = new Scheduler(1);
let identity = '';
let revision = 0;
let context = new AbortController();
const clearers = new Set<() => void>();
export function registerCache(clear: () => void) {
  clearers.add(clear);
}
export function clearCaches() {
  context.abort();
  context = new AbortController();
  revision++;
  clearers.forEach((clear) => clear());
}
export function cacheContext(settings: GeminiSettings) {
  const next = JSON.stringify([
    settings.apiKey,
    settings.textModel,
    settings.textEnabled,
    settings.ttsModel,
    settings.ttsVoice,
  ]);
  if (next !== identity) {
    identity = next;
    clearCaches();
  }
  return { revision, signal: context.signal };
}
export function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  return AbortSignal.any(signals.filter((signal): signal is AbortSignal => Boolean(signal)));
}
export function assertCurrent(signal: AbortSignal) {
  if (signal.aborted) throw new GeminiError('Aborted');
}
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.geminiSettings) clearCaches();
  });
}
