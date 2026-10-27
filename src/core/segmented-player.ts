export interface DubbingSegment {
  videoId: string;
  index: number;
  start: number;
  end: number;
  videoDuration: number;
  voiceDuration: number;
  original: string;
  translation: string;
  audio: string;
}

export function segmentTiming(segment: Pick<DubbingSegment, 'start' | 'end' | 'voiceDuration'>, baseRate: number) {
  const stretch = Math.max(1, segment.voiceDuration / (segment.end - segment.start));
  const videoRate = baseRate / Math.max(1, stretch / 1.35);
  return { stretch, videoRate, audioRate: videoRate * stretch };
}

interface Options {
  request: (videoId: string, index: number, progress: (state: DubbingProgress) => void,
            signal: AbortSignal) => Promise<DubbingSegment>;
  caption: (original: string, translation: string) => void;
  status: (text: string) => void;
  stopped: (error?: string) => void;
  currentVideoId: () => string;
}

export interface DubbingProgress { stage: string; elapsedSeconds: number }

export function progressText(state: DubbingProgress, index: number) {
  const stages: Record<string, string> = {
    queued: 'Đang chờ xử lý', source: 'Đang tìm nguồn audio', extract: 'Đang đọc đoạn audio',
    translate: 'Gemini đang dịch audio', tts: 'Đang tạo voice tiếng Việt', ready: 'Đang nạp voice',
    error: 'Không chuẩn bị được voice',
  };
  return `${stages[state.stage] || 'Đang chuẩn bị voice'} · đoạn ${index + 1} · đã chờ ${state.elapsedSeconds}s`;
}

/** Owns only playback. Extraction, translation, TTS and persistent cache are backend-owned. */
export class SegmentedPlayer {
  private context: AudioContext;
  private source: AudioBufferSourceNode | null = null;
  private segments = new Map<number, DubbingSegment & { buffer: AudioBuffer | null }>();
  private pending = new Map<number, { controller: AbortController; promise: Promise<void> }>();
  private progress = new Map<number, DubbingProgress>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private alive = true;
  private holding = false;
  private ignoredPauses = 0;
  private appliedRate: number | null = null;
  private wantPlay: boolean;
  private originalMuted: boolean;
  private baseRate: number;
  private playingIndex = -1;
  private captionIndex = -1;
  private lastStatus = '';
  private cleanups: Array<() => void> = [];
  private stalled = false;

  constructor(private video: HTMLVideoElement, private videoId: string, private options: Options) {
    this.context = new AudioContext();
    this.wantPlay = !video.paused;
    this.originalMuted = video.muted;
    this.baseRate = video.playbackRate;
  }

  async start() {
    await this.context.resume();
    if (!this.alive) return;
    this.listen('pause', () => {
      if (this.ignoredPauses) { this.ignoredPauses--; return; }
      this.wantPlay = false;
      this.cut();
    });
    this.listen('play', () => {
      this.wantPlay = true;
      this.stalled = false;
      this.tick();
    });
    this.listen('seeking', () => {
      this.wantPlay = !this.video.paused || (this.holding && this.wantPlay);
      this.cut();
      this.captionIndex = -1;
      this.options.caption('', '');
      this.hold();
      const wanted = Math.floor(this.video.currentTime / 12);
      for (const index of this.pending.keys()) if (index !== wanted) this.cancel(index);
    });
    this.listen('seeked', () => { this.stalled = false; this.tick(); });
    this.listen('waiting', () => {
      if (!this.holding && !this.video.seeking) { this.stalled = true; this.cut(); }
    });
    this.listen('playing', () => { this.stalled = false; this.tick(); });
    this.listen('ratechange', () => {
      if (this.appliedRate !== null && Math.abs(this.video.playbackRate - this.appliedRate) < 0.001) return;
      this.baseRate = this.video.playbackRate;
      this.appliedRate = null;
      this.cut();
      this.tick();
    });
    this.listen('ended', () => this.stop());
    this.hold();
    this.timer = setInterval(() => this.tick(), 80);
    this.tick();
  }

  private listen(name: string, handler: () => void) {
    this.video.addEventListener(name, handler);
    this.cleanups.push(() => this.video.removeEventListener(name, handler));
  }

  private say(text: string) {
    if (text !== this.lastStatus) { this.lastStatus = text; this.options.status(text); }
  }

  private cut() {
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch {}
      this.source.disconnect();
      this.source = null;
    }
    this.playingIndex = -1;
  }

  private hold() {
    this.holding = true;
    if (!this.video.paused) { this.ignoredPauses++; this.video.pause(); }
    this.cut();
  }

  private load(index: number) {
    if (this.segments.has(index) || this.pending.has(index) || this.pending.size >= 1) return;
    const controller = new AbortController();
    const job = this.options.request(this.videoId, index, state => {
      if (this.alive && !controller.signal.aborted && typeof state?.stage === 'string' && Number.isFinite(state.elapsedSeconds)) {
        this.progress.set(index, state);
      }
    }, controller.signal).then(async segment => {
      if (!this.alive || controller.signal.aborted) return;
      if (segment.videoId !== this.videoId || segment.index !== index || segment.start !== index * 12 ||
          !Number.isFinite(segment.end) || segment.end <= segment.start || segment.end > segment.start + 12 ||
          !Number.isFinite(segment.voiceDuration) || segment.voiceDuration < 0 || segment.voiceDuration > 60) {
        throw new Error('Backend trả đoạn voice không hợp lệ.');
      }
      const bytes = Uint8Array.from(atob(segment.audio), c => c.charCodeAt(0));
      const buffer = bytes.length ? await this.context.decodeAudioData(bytes.buffer) : null;
      if (!this.alive || controller.signal.aborted) return;
      if (buffer && Math.abs(buffer.duration - segment.voiceDuration) > 0.1) {
        throw new Error('Thời lượng voice không khớp.');
      }
      this.segments.set(index, { ...segment, buffer });
      // Keep nearby decoded voices only; backend keeps the persistent cache.
      const current = Math.floor(this.video.currentTime / 12);
      for (const key of this.segments.keys()) if (Math.abs(key - current) > 3) this.segments.delete(key);
    }).catch(error => {
      // A failed speculative request should only fail playback when that segment is needed.
      if (this.alive && !controller.signal.aborted && Math.floor(this.video.currentTime / 12) === index) this.stop(error.message);
    }).finally(() => {
      if (this.pending.get(index)?.controller === controller) {
        this.pending.delete(index); this.progress.delete(index);
      }
      if (this.alive) this.tick();
    });
    this.pending.set(index, { controller, promise: job });
  }

  private tick() {
    if (!this.alive) return;
    if (!this.video.isConnected || this.options.currentVideoId() !== this.videoId ||
        document.querySelector('#movie_player.ad-showing')) { this.stop(); return; }
    if (this.video.seeking || this.video.ended) return;
    const index = Math.floor(this.video.currentTime / 12);
    const segment = this.segments.get(index);
    if (!segment) {
      for (const key of this.pending.keys()) if (key !== index) this.cancel(key);
      if (!this.holding) { this.wantPlay = !this.video.paused; this.hold(); }
      this.say(progressText(this.progress.get(index) || { stage: 'queued', elapsedSeconds: 0 }, index));
      this.load(index);
      return;
    }
    this.prefetch(index, segment.videoDuration);
    if (this.captionIndex !== index) {
      this.captionIndex = index;
      this.options.caption(segment.original, segment.translation);
    }
    if (!this.wantPlay || this.stalled) { this.say('Dịch theo đoạn: tạm dừng'); return; }
    const timing = segmentTiming(segment, this.baseRate);
    if (Math.abs(this.video.playbackRate - timing.videoRate) > 0.001) {
      this.appliedRate = timing.videoRate;
      this.video.playbackRate = timing.videoRate;
    }
    if (this.playingIndex !== index) {
      this.cut();
      this.playingIndex = index;
      const offset = Math.max(0, this.video.currentTime - segment.start) * timing.stretch;
      if (segment.buffer && offset < segment.buffer.duration) {
        this.source = this.context.createBufferSource();
        this.source.buffer = segment.buffer;
        this.source.playbackRate.value = timing.audioRate;
        this.source.connect(this.context.destination);
        this.source.start(0, offset);
      }
    }
    this.video.muted = true;
    this.say(timing.videoRate < this.baseRate ? 'Dịch theo đoạn: giảm tốc video để khớp voice' : 'Dịch theo đoạn: đang phát');
    if (this.holding) {
      this.holding = false;
      this.video.play().catch(error => this.stop(error.message));
    }
  }

  stop(error?: string) {
    if (!this.alive) return;
    this.alive = false;
    for (const index of this.pending.keys()) this.cancel(index);
    if (this.timer) clearInterval(this.timer);
    for (const cleanup of this.cleanups) cleanup();
    this.cut();
    this.video.muted = this.originalMuted;
    this.video.playbackRate = this.baseRate;
    this.segments.clear();
    void this.context.close();
    this.options.stopped(error);
  }

  private prefetch(index: number, duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    for (let ahead = 1; ahead <= 2; ahead++) {
      if ((index + ahead) * 12 < duration) this.load(index + ahead);
    }
  }

  private cancel(index: number) {
    const job = this.pending.get(index);
    this.pending.delete(index);
    this.progress.delete(index);
    job?.controller.abort();
  }
}
