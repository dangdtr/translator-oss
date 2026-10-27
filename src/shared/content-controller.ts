import * as S from '../core/subtitles';
import { LTLog } from '../core/logger';
import { LTCaptionUI } from '../ui/caption-ui';
import { LTYoutubeControls } from '../ui/youtube-controls';
import type { SegmentedPlayer } from '../core/segmented-player';
import type { ContentProfile } from './content-profile';
import type { CaptionCue, SentenceUnit } from '../types/subtitles';
import type { LiveUiPayload } from '../types/live';

export function installContent(profile: ContentProfile): void {
  LTCaptionUI.configure(profile.subtitleLabel);
  LTYoutubeControls.configure(profile.subtitleLabel);
  if ((globalThis as any).__localTranslator) return;
  (globalThis as any).__localTranslator = true;

  let video: HTMLVideoElement | null = null;
  let segmentedPlayer: SegmentedPlayer | null = null;
  let dubbingStarting = false;

  function stopSegmented() {
    segmentedPlayer?.stop();
    segmentedPlayer = null;
  }

  async function toggleSegmented() {
    if (!profile.segmentedPlayer) return;
    if (segmentedPlayer) {
      stopSegmented();
      return;
    }
    if (dubbingStarting) return;
    const picked = LTYoutubeControls.getVideo();
    const key = youtubeVideoKey();
    const id = key?.replace(/^(watch|shorts):/, '') || '';
    if (!picked || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
      status('Dịch theo đoạn cần một video YouTube.');
      return;
    }
    if (document.querySelector('#movie_player.ad-showing')) {
      status('Chờ quảng cáo kết thúc rồi bật dịch theo đoạn.');
      return;
    }
    dubbingStarting = true;
    try {
      await send({ type: 'live-stop' });
      stopVideo();
      LTCaptionUI.ensure();
      LTCaptionUI.setText('', '');
      if (!profile.segmentedPlayer) throw new Error('Chế độ này chưa có trong bản Gemini.');
      const player = new profile.segmentedPlayer(picked, id, {
        request: async (videoId, index, progress, signal) => {
          const jobId = crypto.randomUUID();
          let polling = false;
          const timer = setInterval(async () => {
            if (signal.aborted || polling) return;
            polling = true;
            try {
              const state = await send({ type: 'dubbing-status', jobId });
              if (!signal.aborted) progress(state);
            } catch {
            } finally {
              polling = false;
            }
          }, 2000);
          const cancel = () => {
            clearInterval(timer);
            void send({ type: 'dubbing-cancel', jobId }).catch(() => {});
          };
          signal.addEventListener('abort', cancel, { once: true });
          try {
            return await send({ type: 'dubbing-segment', videoId, index, jobId });
          } finally {
            clearInterval(timer);
            signal.removeEventListener('abort', cancel);
          }
        },
        currentVideoId: () => (youtubeVideoKey() || '').replace(/^(watch|shorts):/, ''),
        caption: (original, translation) => LTCaptionUI.setText(original, translation),
        status: (text) => {
          status(text);
          LTCaptionUI.setStatus(text);
        },
        stopped: (error) => {
          segmentedPlayer = null;
          if (error) {
            LTCaptionUI.setText('', error);
            status(error);
          } else LTCaptionUI.remove();
        },
      });
      segmentedPlayer = player;
      await player.start();
    } catch (error: any) {
      stopSegmented();
      LTCaptionUI.setText('', error.message);
      status(error.message);
    } finally {
      dubbingStarting = false;
    }
  }
  let timer: any = null;
  let lines: CaptionCue[] = [];
  let units: SentenceUnit[] = [];
  const translations = new Map<number, string>();
  let session = 0;
  let busy = false;
  let lastSpoken: any = -1;
  let activeUnit: any = -1;

  const SPEECH_LATE = 1.5;
  const SPEECH_MIN_WINDOW = 1.2;
  let speaking: { id: number; key: any; test?: boolean } | null = null;
  let pendingSpeech: {
    key: any;
    text: string;
    end: number;
    startAt?: number;
  } | null = null;
  let speechId = 0;
  let speechRetryAfter = 0;
  let speechWatchdog: any = null;
  const prefetched = new Set<string>();
  let resumeAt: { key: any; offset: number } | null = null;
  let voiceMessage = 'Giọng đọc: sẵn sàng';
  let dubbing = true;
  let publicSettingsData: any = null;
  const refreshSettings = async () => {
    if (profile.loadPublicSettings) {
      const settings = await profile.loadPublicSettings();
      publicSettingsData = settings;
      dubbing = settings.speechEnabled !== false;
      const flags = settings.featureFlags || {};
      LTYoutubeControls.installButtons({
        subtitlesEnabled: flags.enableSubtitles !== false,
        liveEnabled: flags.enableLive !== false,
        segmentedDubbing:
          Boolean(profile.segmentedPlayer) &&
          flags.enableSegmentedDubbing !== false &&
          settings.provider !== 'gemini',
      });
    }
  };
  void refreshSettings().catch(() => {});
  let originalVolume: number | null = null;
  let originalMuted: boolean | null = null;
  let cleanups: Array<() => void> = [];
  let trackModes: Array<[TextTrack, TextTrackMode]> = [];
  let retryAfter = 0;
  let liveText = '';
  let liveChanged = 0;
  let liveDone = '';
  let liveBusy = false;
  let liveRevision = 0;
  let liveResult = '';
  let liveSpokenRevision = -1;
  let buffering = false;
  let bufferId = 0;
  const BUFFER_UNITS = 3;
  let autoGeneratedCaptions = false;
  let geminiAvailable = true;
  const polishedUnits: any[] = [];
  const polishRequests = new Map<string, Promise<any>>();
  const GEMINI_CUES = 48;
  const GEMINI_CONTEXT = 4;
  let pageObserver: IntersectionObserver | null = null;
  let pageMutation: MutationObserver | null = null;
  let pageRunning = false;
  let pageQueue: Element[] = [];
  let pageBusy = false;
  let pageEpoch = 0;
  let pageCount = 0;
  let seen = new WeakSet<Element>();
  let additions: HTMLElement[] = [];
  const ids = new WeakMap<HTMLVideoElement, number>();
  let nextId = 1;
  let requestId = 0;
  let lastStatus = '';
  let orphaned = false;
  let liveOverlayPhase = 'idle';
  let liveHeldVideo: HTMLVideoElement | null = null;
  let liveVideoKey: string | null = null;
  let liveSeeking = false;
  const RELOAD_PAGE = 'Extension vừa được tải lại hoặc cập nhật. Tải lại trang (F5) để tiếp tục.';

  const videoId = (v: HTMLVideoElement) => {
    if (!ids.has(v)) ids.set(v, nextId++);
    return ids.get(v)!;
  };

  function originOf(url: string): string {
    try {
      return new URL(url, location.href).origin;
    } catch {
      return 'unknown';
    }
  }

  function trackInfo(track: TextTrack) {
    return {
      language: track.language,
      kind: track.kind,
      mode: track.mode,
      cues: track.cues?.length ?? null,
    };
  }

  function snapshot(reason: string) {
    const videos = Array.from(document.querySelectorAll('video')).map((v) => ({
      id: videoId(v),
      selected: v === video,
      paused: v.paused,
      currentTime: v.currentTime,
      readyState: v.readyState,
      networkState: v.networkState,
      width: Math.round(v.getBoundingClientRect().width),
      sourceOrigin: originOf(v.currentSrc),
      player: v.closest('.video-js') ? 'videojs' : 'html5',
      tracks: Array.from(v.textTracks || []).map(trackInfo),
      trackElements: Array.from(v.querySelectorAll('track')).map((t) => ({
        language: t.srclang,
        kind: t.kind,
        readyState: t.readyState,
        sourceOrigin: originOf(t.src),
      })),
    }));
    LTLog('diagnostics', {
      reason,
      mode: video ? (pageRunning ? 'page+video' : 'video') : pageRunning ? 'page' : 'idle',
      videos,
      iframeOrigins: Array.from(document.querySelectorAll('iframe')).map((f) => originOf(f.src)),
      pageBlocks: document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,figcaption')
        .length,
      pageQueue: pageQueue.length,
      pageBusy,
      pageTranslated: pageCount,
      subtitleLines: lines.length,
      subtitleUnits: units.length,
      subtitleTranslated: translations.size,
      subtitleBusy: busy,
      speech: {
        enabled: dubbing,
        speaking: speaking?.key ?? null,
        pending: pendingSpeech?.key ?? null,
        retryInMs: Math.max(0, speechRetryAfter - Date.now()),
        originalMuted: originalMuted !== null,
      },
      openShadowRoots: Array.from(document.querySelectorAll('*')).filter(
        (n) => (n as any).shadowRoot && n !== LTCaptionUI.getHost(),
      ).length,
    });
  }

  function extensionAlive(): boolean {
    if (orphaned) return false;
    let alive = false;
    try {
      alive = Boolean(chrome.runtime?.id);
    } catch {}
    if (alive) return true;
    orphaned = true;
    LTLog('extension.orphaned', { hint: RELOAD_PAGE });
    stopVideo();
    stopPage();
    status(RELOAD_PAGE);
    voiceStatus('Giọng đọc: đã dừng.');
    return false;
  }

  async function send(message: any): Promise<any> {
    if (!extensionAlive()) throw new Error(RELOAD_PAGE);
    const id = ++requestId;
    const start = performance.now();
    LTLog('request.start', {
      id,
      type: message.type,
      texts: message.texts?.length,
      characters:
        message.texts?.reduce((n: number, text: string) => n + text.length, 0) ??
        message.text?.length,
    });
    try {
      const result = await chrome.runtime.sendMessage(message);
      if (!result?.ok) {
        throw new Error(result?.error || 'Extension đã tải lại; hãy tải lại trang.');
      }
      LTLog('request.done', {
        id,
        type: message.type,
        ms: Math.round(performance.now() - start),
        translations: result.data?.translations?.length,
      });
      return result.data;
    } catch (error: any) {
      const dead = !extensionAlive();
      LTLog(
        'request.failed',
        {
          id,
          type: message.type,
          ms: Math.round(performance.now() - start),
          error: error.message,
        },
        dead ? 'info' : 'error',
      );
      if (dead) throw new Error(RELOAD_PAGE);
      throw error;
    }
  }

  function status(text: string): void {
    if (text !== lastStatus) {
      LTLog('status', { message: text });
      lastStatus = text;
    }
  }

  function voiceStatus(text: string): void {
    voiceMessage = text;
  }

  function releaseLiveVideoHold(resume: boolean): void {
    const held = liveHeldVideo;
    liveHeldVideo = null;
    if (
      resume &&
      held?.isConnected &&
      held.paused &&
      !held.seeking &&
      liveVideoKey === youtubeVideoKey()
    ) {
      held.play().catch(() => status('Không thể tự tiếp tục video sau khi bật Live.'));
    }
  }

  function youtubeVideoKey(): string | null {
    if (location.pathname === '/watch') return new URL(location.href).searchParams.get('v');
    const shorts = location.pathname.match(/^\/shorts\/([^/]+)/);
    return shorts?.[1] || null;
  }

  function stopLiveForNavigation(): void {
    if (!liveVideoKey) return;
    liveVideoKey = null;
    liveSeeking = false;
    releaseLiveVideoHold(false);
    liveOverlayPhase = 'stopping';
    LTCaptionUI.remove();
    send({ type: 'live-stop' }).catch(() => {});
  }

  window.addEventListener('yt-navigate-finish', () => {
    if (liveVideoKey && liveVideoKey !== youtubeVideoKey()) stopLiveForNavigation();
  });
  window.addEventListener('popstate', () => {
    if (liveVideoKey && liveVideoKey !== youtubeVideoKey()) stopLiveForNavigation();
  });

  function showLiveUi(message: LiveUiPayload): void {
    liveOverlayPhase = message.phase;
    LTYoutubeControls.updateLiveButton(liveOverlayPhase);
    LTCaptionUI.ensure();
    LTCaptionUI.setBadge('live', message.phase);
    if (message.phase === 'connecting') {
      liveVideoKey = youtubeVideoKey();
      LTCaptionUI.setText('', '');
      LTCaptionUI.setLoading();
    } else if (message.phase === 'active') {
      if (liveHeldVideo) {
        releaseLiveVideoHold(true);
      } else if (LTYoutubeControls.getVideo()?.paused) {
        send({ type: 'live-pause' }).catch(() => {});
        liveOverlayPhase = 'paused';
        LTYoutubeControls.updateLiveButton('paused');
        LTCaptionUI.setBadge('live', 'paused');
      }
      LTCaptionUI.setLoading();
    } else if (message.phase === 'paused') {
      LTCaptionUI.setText('', '');
      LTCaptionUI.setLoading();
    } else if (message.phase === 'reconnecting') {
      const picked = LTYoutubeControls.getVideo();
      if (picked && !picked.paused) {
        liveHeldVideo = picked;
        picked.pause();
      }
      LTCaptionUI.setText('', '');
      LTCaptionUI.setLoading();
    } else if (message.phase === 'transcript') {
      LTCaptionUI.setText(message.original || '', message.translation || '');
      LTCaptionUI.setLoading();
    } else if (message.phase === 'stopping') {
      LTCaptionUI.setLoading();
    } else if (message.phase === 'stopped') {
      releaseLiveVideoHold(true);
      liveVideoKey = null;
      LTCaptionUI.setText('', '');
      LTCaptionUI.setLoading();
      if (!video) LTCaptionUI.remove();
    } else if (message.phase === 'error') {
      releaseLiveVideoHold(true);
      liveVideoKey = null;
      LTCaptionUI.setText('', profile.liveError?.(message.code) || profile.connectionError);
      LTCaptionUI.setLoading();
    }
  }

  function duck(): void {
    if (!video || originalMuted !== null) return;
    originalVolume = video.volume;
    originalMuted = video.muted;
    video.muted = true;
  }

  function restoreVolume(): void {
    if (video && originalMuted !== null) {
      video.volume = originalVolume!;
      video.muted = originalMuted;
    }
    originalVolume = null;
    originalMuted = null;
  }

  function stopSpeech(): void {
    pendingSpeech = null;
    clearTimeout(speechWatchdog);
    if (speaking) {
      const { id, key } = speaking;
      const run = session;
      send({ type: 'speech-stop', id })
        .then((result) => {
          if (run === session && result?.at > 0.05) {
            resumeAt = { key, offset: result.at };
          }
        })
        .catch(() => {});
    } else if (profile.loadPublicSettings) {
      void send({ type: 'speech-stop' }).catch(() => {});
    }
    speaking = null;
  }

  function stopVideo(): void {
    if (profile.loadPublicSettings)
      void send({ type: 'requests-cancel', scope: 'video' }).catch(() => {});
    session++;
    buffering = false;
    bufferId++;
    clearInterval(timer);
    stopSpeech();
    restoreVolume();
    for (const fn of cleanups) fn();
    cleanups = [];
    for (const [track, mode] of trackModes) track.mode = mode;
    trackModes = [];
    video = null;
    busy = false;
    liveBusy = false;
    retryAfter = 0;
    speechRetryAfter = 0;
    liveRevision++;
    liveResult = '';
    liveSpokenRevision = -1;
    resumeAt = null;
    lines = [];
    units = [];
    translations.clear();
    prefetched.clear();
    autoGeneratedCaptions = false;
    geminiAvailable = true;
    polishedUnits.length = 0;
    polishRequests.clear();
    LTYoutubeControls.updateSubtitleButton(false);
    LTCaptionUI.setBadge(undefined);
  }

  async function nativeCues(v: HTMLVideoElement, run: number): Promise<CaptionCue[]> {
    const tracks = Array.from(v.textTracks || []);
    LTLog('subtitles.tracks', { videoId: videoId(v), tracks: tracks.map(trackInfo) });
    const track =
      tracks.find(
        (t) => /^(en)(-|$)/i.test(t.language) && ['subtitles', 'captions'].includes(t.kind),
      ) || tracks.find((t) => !t.language && ['subtitles', 'captions'].includes(t.kind));
    if (!track) {
      LTLog('subtitles.no-native-english-track', { videoId: videoId(v) });
      return [];
    }
    trackModes.push([track, track.mode]);
    if (track.mode === 'disabled') track.mode = 'hidden';
    for (let i = 0; i < 12 && !track.cues?.length && run === session; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (run !== session) return [];
    LTLog('subtitles.track-loaded', { videoId: videoId(v), ...trackInfo(track) });
    return S.normalize(
      Array.from(track.cues || []).map((c: any) => ({
        start: c.startTime,
        end: c.endTime,
        text: c.text,
      })),
    );
  }

  async function startVideo(id: number, imported?: CaptionCue[]): Promise<void> {
    await refreshSettings();
    LTLog('mode.video.start', { videoId: id, importedCues: imported?.length || 0 });
    liveOverlayPhase = 'idle';
    const picked = Array.from(document.querySelectorAll('video')).find((v) => videoId(v) === id);
    if (!picked) throw new Error('Không tìm thấy video. Hãy bật video rồi quét lại.');
    const resumeAfterBuffer = !picked.paused;
    if (resumeAfterBuffer) picked.pause();
    stopVideo();
    LTCaptionUI.ensure();
    video = picked;
    duck();
    LTYoutubeControls.updateSubtitleButton(true);
    LTCaptionUI.setBadge('offline');
    snapshot('video-start');
    const run = session;
    lastSpoken = -1;
    activeUnit = -1;
    resumeAt = null;
    liveText = liveDone = '';
    LTCaptionUI.setText('', '');
    status('Đang tìm phụ đề tiếng Anh…');
    let resumeAfterSeek = false;
    for (const event of ['pause', 'seeking', 'ended']) {
      const handler = () => {
        LTLog('video.' + event, {
          currentTime: picked.currentTime,
          playbackRate: picked.playbackRate,
        });
        stopSpeech();
        liveSpokenRevision = -1;
        if (event !== 'pause') {
          lastSpoken = -1;
          activeUnit = -1;
          resumeAt = null;
        }
        if (event === 'seeking') {
          resumeAfterSeek = !picked.paused;
          if (resumeAfterSeek) picked.pause();
          LTCaptionUI.setLoading();
          liveRevision++;
          liveText = liveDone = liveResult = '';
          LTCaptionUI.setText('', '');
        }
      };
      video.addEventListener(event, handler);
      cleanups.push(() => picked.removeEventListener(event, handler));
    }
    const seeked = () => {
      if (units.length) bufferAtCurrentTime(resumeAfterSeek);
      else LTCaptionUI.setLoading();
      resumeAfterSeek = false;
    };
    picked.addEventListener('seeked', seeked);
    cleanups.push(() => picked.removeEventListener('seeked', seeked));

    const rate = () =>
      LTLog('video.ratechange', {
        currentTime: picked.currentTime,
        playbackRate: picked.playbackRate,
      });
    picked.addEventListener('ratechange', rate);
    cleanups.push(() => picked.removeEventListener('ratechange', rate));

    const changed = () => {
      stopVideo();
      status('Video đã thay đổi. Bấm nút dịch trong thanh điều khiển để dịch lại.');
    };
    picked.addEventListener('emptied', changed);
    cleanups.push(() => picked.removeEventListener('emptied', changed));

    const youtubeRequest =
      !imported && /(^|\.)youtube\.com$/.test(location.hostname)
        ? send({ type: 'youtube' }).catch((error: any) => {
            LTLog('subtitles.youtube-failed', { error: error.message });
            return null;
          })
        : null;

    let loaded = imported || (await nativeCues(picked, run));
    if (run !== session) return;

    if (!loaded.length && picked.closest('.video-js')) {
      try {
        const data = await send({
          type: 'videojs',
          index: Array.from(document.querySelectorAll('video')).indexOf(picked),
          elementId: picked.id,
        });
        if (run !== session) return;
        LTLog('subtitles.videojs', {
          reason: data?.reason,
          tracks: data?.tracks || [],
          count: data?.cues?.length || 0,
        });
        if (data?.cues?.length) loaded = S.normalize(data.cues);
      } catch (error: any) {
        if (run === session) {
          LTLog('subtitles.videojs-failed', { error: error.message });
        }
      }
    }
    if (run !== session) return;

    if (!loaded.length && youtubeRequest) {
      const data = await youtubeRequest;
      if (data?.caption) {
        loaded = S.json3(data.caption);
        autoGeneratedCaptions = Boolean(data.autoGenerated);
      }
    }
    if (run !== session) return;

    lines = loaded;
    units = S.sentences(lines);
    const fallback = picked.closest('.video-js')
      ? 'videojs-visible-cc'
      : /(^|\.)youtube\.com$/.test(location.hostname)
        ? 'youtube-visible-cc'
        : 'import-srt-vtt';
    LTLog('subtitles.ready', {
      count: lines.length,
      sentences: units.length,
      autoGenerated: autoGeneratedCaptions,
      fallback: units.length ? null : fallback,
    });
    status(
      units.length
        ? `Đã lấy ${lines.length} dòng phụ đề, gộp thành ${units.length} câu. Đang chuẩn bị bản dịch…`
        : fallback === 'videojs-visible-cc'
          ? 'Đang đọc CC của Video.js. Bật phụ đề English trong video.'
          : 'Chưa có file phụ đề. Trên YouTube hãy bật CC tiếng Anh, hoặc mở SRT/VTT.',
    );
    timer = setInterval(tick, 250);
    if (units.length) await bufferAtCurrentTime(resumeAfterBuffer);
    else {
      LTCaptionUI.setLoading();
      LTCaptionUI.setText('', 'Bật CC tiếng Anh trong video YouTube để dịch.');
      tick();
    }
  }

  function upcoming(): number {
    let low = 0,
      high = units.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (units[mid].end <= video!.currentTime) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  async function prepare(start: number, limit = 8): Promise<boolean> {
    if (busy || Date.now() < retryAfter) return false;
    const indices: number[] = [];
    for (let i = start; i < Math.min(start + limit, units.length); i++) {
      if (!translations.has(i)) indices.push(i);
    }
    if (!indices.length) return true;
    busy = true;
    const run = session;
    try {
      const data = await send({
        type: 'translate',
        texts: indices.map((i) => units[i].text.slice(0, 6000)),
      });
      if (run !== session) return false;
      indices.forEach((i, j) => translations.set(i, data.translations[j]));
      status(
        `Phụ đề ${profile.label} · ${units.length} câu (${lines.length} dòng) · ${translations.size} câu đã dịch`,
      );
      return true;
    } catch (error: any) {
      if (run === session) {
        retryAfter = Date.now() + 5000;
        status(error.message);
      }
      return false;
    } finally {
      if (run === session) busy = false;
    }
  }

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  function polishedAt(time: number): { index: number; unit: any } | null {
    const index = S.indexAt(polishedUnits, time);
    return index >= 0 ? { index, unit: polishedUnits[index] } : null;
  }

  async function polishWindow(cueIndex: number): Promise<any[]> {
    if (!autoGeneratedCaptions || !geminiAvailable || !lines.length) return [];
    const low = Math.max(0, cueIndex - GEMINI_CONTEXT);
    const high = Math.min(lines.length, low + GEMINI_CUES);
    const key = `${low}:${high}`;
    if (polishRequests.has(key)) return polishRequests.get(key)!;
    const run = session;
    const request = send({
      type: 'caption-polish',
      cues: lines.slice(low, high).map((cue) => cue.text),
      windowKey: key,
    })
      .then((data) => {
        if (run !== session || !data?.available || !Array.isArray(data.sentences)) {
          if (data && !data.available) geminiAvailable = false;
          return [];
        }
        const received = data.sentences
          .map((item: any) => ({
            start: lines[low + item.start]?.start,
            end: lines[low + item.end - 1]?.end,
            text: item.original,
            translation: item.translation,
            cueEnd: low + item.end,
          }))
          .filter(
            (item: any) =>
              Number.isFinite(item.start) &&
              Number.isFinite(item.end) &&
              item.end > item.start &&
              typeof item.text === 'string' &&
              typeof item.translation === 'string',
          );
        polishedUnits.push(...received);
        polishedUnits.sort((a, b) => a.start - b.start || a.end - b.end);
        LTLog('subtitles.gemini-window', {
          startCue: low,
          endCue: high,
          sentences: received.length,
        });
        return received;
      })
      .catch((error) => {
        LTLog('subtitles.gemini-failed', { startCue: low, error: error.message });
        return [];
      });
    polishRequests.set(key, request);
    return request;
  }

  function prefetchGeminiWindow(): void {
    if (!autoGeneratedCaptions || !geminiAvailable || !video) return;
    const current = polishedAt(video.currentTime);
    if (current && S.indexAt(lines, video.currentTime) >= current.unit.cueEnd - 8) {
      polishWindow(current.unit.cueEnd - GEMINI_CONTEXT).catch(() => {});
    }
  }

  async function bufferAtCurrentTime(resume: boolean): Promise<void> {
    if (!video || !units.length) return;
    const id = ++bufferId;
    const run = session;
    buffering = true;
    LTCaptionUI.setLoading();
    const at = S.indexAt(units, video.currentTime);
    const start = at >= 0 ? at : upcoming();
    const cueAt = S.indexAt(lines, video.currentTime);
    if (autoGeneratedCaptions && cueAt >= 0) {
      await Promise.race([polishWindow(cueAt), pause(8000)]);
    }
    while (busy && run === session && id === bufferId) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const polished = polishedAt(video.currentTime);
    const translated = polished ? true : await prepare(start, BUFFER_UNITS);
    if (run !== session || id !== bufferId) return;
    const texts: string[] = [];
    if (polished) {
      texts.push(polished.unit.translation.slice(0, 1500));
    } else {
      for (let i = start; i < Math.min(start + BUFFER_UNITS, units.length); i++) {
        const text = translations.get(i);
        if (text) texts.push(text.slice(0, 1500));
      }
    }
    if (translated && texts.length && dubbing) {
      try {
        await send({ type: 'speech-warm', texts });
      } catch (error: any) {
        LTLog('speech.warm-failed', { error: error.message });
      }
    }
    if (run !== session || id !== bufferId) return;
    buffering = false;
    LTCaptionUI.setLoading();
    prefetchSpeech(start);
    prefetchGeminiWindow();
    LTLog('subtitles.buffered', { start, count: texts.length, resume });
    if (resume && video.paused && !video.seeking) {
      video.play().catch((error) => LTLog('video.resume-failed', { error: error.message }));
    }
    tick();
  }

  const voiceName = profile.voiceName;

  function reportVoiceError(error: Error): void {
    LTLog('speech.failed', { error: error.message }, 'error');
    voiceStatus('Giọng đọc: ' + error.message);
    restoreVolume();
  }

  function watchSpeech(id: number, seconds: number): void {
    clearTimeout(speechWatchdog);
    speechWatchdog = setTimeout(() => finishSpeech(id, 'timeout'), (seconds + 3) * 1000);
  }

  function finishSpeech(id: number, event: string, error?: string): void {
    if (!speaking || speaking.id !== id) return;
    clearTimeout(speechWatchdog);
    const { key, test } = speaking;
    speaking = null;
    LTLog('speech.' + event, {
      cue: key,
      currentTime: video?.currentTime,
      ...(error ? { error } : {}),
    });
    if (event === 'error') {
      reportVoiceError(new Error(error || 'Lỗi phát audio giọng đọc.'));
    } else if (event === 'interrupted') {
      voiceStatus('Giọng đọc: tab hoặc khung khác vừa phát giọng.');
    } else if (test) {
      voiceStatus('Giọng đọc: đã phát tiếng bíp và câu thử.');
    } else {
      voiceStatus('Giọng đọc: sẵn sàng');
    }
    pumpSpeech();
  }

  function prefetchSpeech(start: number): void {
    const texts: string[] = [];
    for (let i = start; i < Math.min(start + 4, units.length) && translations.has(i); i++) {
      const text = translations.get(i)!.slice(0, 1500);
      if (!prefetched.has(text)) {
        prefetched.add(text);
        texts.push(text);
      }
    }
    if (texts.length) {
      send({ type: 'speech-prefetch', texts }).catch((error: any) =>
        LTLog('speech.prefetch-failed', { error: error.message }),
      );
    }
  }

  function queueSpeech(key: any, text: string, end: number, startAt = 0): void {
    if (pendingSpeech) {
      LTLog('speech.skipped', { reason: 'superseded', cue: pendingSpeech.key });
    }
    pendingSpeech = { key, text, end, startAt };
    pumpSpeech();
  }

  async function pumpSpeech(): Promise<void> {
    if (speaking || !pendingSpeech || !dubbing || Date.now() < speechRetryAfter) {
      return;
    }
    if (!video || video.paused || video.seeking) return;
    const unit = pendingSpeech;
    pendingSpeech = null;
    const late = video.currentTime - unit.end;
    if (late > SPEECH_LATE) {
      LTLog('speech.skipped', {
        reason: 'cue-expired',
        cue: unit.key,
        late: Math.round(late * 10) / 10,
      });
      voiceStatus('Giọng đọc: bỏ qua câu đã trễ; chờ câu tiếp theo.');
      return;
    }
    const id = ++speechId;
    const run = session;
    const pace = Math.max(0.25, video.playbackRate || 1);
    speaking = { id, key: unit.key };
    try {
      const available = Math.max(SPEECH_MIN_WINDOW, (unit.end - video.currentTime) / pace);
      const wait = Math.round(Math.min(1500, Math.max(400, available * 300)));
      const result = await send({
        type: 'speech-play',
        id,
        text: unit.text.slice(0, 1500),
        available,
        wait,
        startAt: unit.startAt,
      });
      if (run !== session || speaking?.id !== id) {
        if (result?.ok) send({ type: 'speech-stop', id }).catch(() => {});
        return;
      }
      if (!result?.ok) {
        speaking = null;
        return;
      }
      duck();
      watchSpeech(id, result.duration / result.rate);
      voiceStatus(
        result.fallback
          ? 'Giọng đọc: đang đọc bằng giọng dự phòng'
          : 'Giọng đọc: đang đọc · ' + voiceName(result.engine),
      );
      LTLog('speech.playing', {
        cue: unit.key,
        sample: false,
        duration: result.duration,
        rate: result.rate,
        engine: result.engine,
        fallback: result.fallback,
        resumeFrom: unit.startAt,
        currentTime: video.currentTime,
      });
    } catch (error: any) {
      if (run !== session || speaking?.id !== id) return;
      speaking = null;
      speechRetryAfter = Date.now() + 3000;
      reportVoiceError(error);
    }
  }

  function visibleCaption(): { text: string; source: string } {
    const vjs = video?.closest('.video-js');
    const container = vjs || video?.closest('.html5-video-player');
    if (!container) return { text: '', source: 'none' };
    const nodes = Array.from(
      container.querySelectorAll(
        vjs ? '.vjs-text-track-display .vjs-text-track-cue' : '.ytp-caption-segment',
      ),
    );
    const visible = nodes.filter((node) => {
      const language = node.getAttribute('lang') || '';
      if (language && !/^en(?:[-_]|$)/i.test(language)) return false;
      const style = getComputedStyle(node);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        node.getClientRects().length > 0
      );
    });
    return {
      text: S.clean(visible.map((n) => n.textContent).join(' ')),
      source: vjs ? 'videojs-visible-cc' : 'youtube-visible-cc',
    };
  }

  async function liveTick(): Promise<void> {
    const { text, source } = visibleCaption();
    if (text !== liveText) {
      if (pendingSpeech?.key === 'live') pendingSpeech = null;
      if (resumeAt?.key === 'live') resumeAt = null;
      liveRevision++;
      liveText = text;
      liveChanged = Date.now();
      liveDone = liveResult = '';
      liveSpokenRevision = -1;
      LTCaptionUI.setText(text, '');
      LTLog('subtitles.visible-change', { source, characters: text.length });
    }
    if (!text || video!.seeking) return;
    if (text === liveDone) {
      if (liveResult && dubbing && !video!.paused && liveSpokenRevision !== liveRevision) {
        liveSpokenRevision = liveRevision;
        const startAt = resumeAt?.key === 'live' ? resumeAt.offset : 0;
        resumeAt = null;
        queueSpeech('live', liveResult, video!.currentTime + 8, startAt);
      }
      return;
    }
    if (liveBusy || Date.now() < retryAfter || Date.now() - liveChanged < 500) {
      return;
    }
    liveBusy = true;
    const run = session;
    const revision = liveRevision;
    try {
      const data = await send({
        type: 'translate',
        texts: [text.slice(0, 6000)],
      });
      if (run !== session || revision !== liveRevision || text !== visibleCaption().text) {
        return;
      }
      liveDone = text;
      liveResult = data.translations[0];
      LTCaptionUI.setText(text, liveResult);
      status(
        `Đang dịch CC ${source === 'videojs-visible-cc' ? 'Video.js' : 'YouTube'} hiển thị · có độ trễ`,
      );
      LTLog('subtitles.visible-translated', {
        source,
        characters: liveResult.length,
        paused: video!.paused,
      });
    } catch (error: any) {
      if (run === session) {
        retryAfter = Date.now() + 5000;
        status(error.message);
      }
    } finally {
      if (run === session) liveBusy = false;
    }
  }

  function tick(): void {
    if (!extensionAlive()) return;
    if (!video?.isConnected) {
      stopVideo();
      return;
    }
    if (buffering) return;
    pumpSpeech();
    if (!units.length) {
      liveTick();
      return;
    }
    const polished = polishedAt(video.currentTime);
    if (polished) {
      const { unit } = polished;
      const key = `gemini:${unit.start}:${unit.end}`;
      if (activeUnit !== key) {
        activeUnit = key;
        LTCaptionUI.setText(unit.text, unit.translation);
      }
      if (dubbing && !video.paused && !video.seeking && lastSpoken !== key) {
        resumeAt = null;
        lastSpoken = key;
        queueSpeech(key, unit.translation, unit.end);
      }
      if (dubbing) {
        const text = unit.translation.slice(0, 1500);
        if (!prefetched.has(text)) {
          prefetched.add(text);
          send({ type: 'speech-prefetch', texts: [text] }).catch((error: any) =>
            LTLog('speech.prefetch-failed', { error: error.message }),
          );
        }
      }
      prefetchGeminiWindow();
      return;
    }
    const next = upcoming();
    prepare(next);
    const index = S.indexAt(units, video.currentTime);
    if (index !== activeUnit) {
      activeUnit = index;
      LTCaptionUI.setText(index >= 0 ? units[index].text : '', '');
    }
    if (index >= 0 && translations.has(index)) {
      const text = translations.get(index)!;
      LTCaptionUI.setText(undefined, text);
      if (dubbing && !video.paused && !video.seeking) {
        if (lastSpoken !== index) {
          resumeAt = null;
          lastSpoken = index;
          queueSpeech(index, text, units[index].end);
        } else if (resumeAt?.key === index) {
          const { offset } = resumeAt;
          resumeAt = null;
          queueSpeech(index, text, units[index].end, offset);
        }
      }
    }
    if (dubbing) prefetchSpeech(index >= 0 ? index : next);
  }

  function stopPage(): void {
    if (profile.loadPublicSettings)
      void send({ type: 'requests-cancel', scope: 'page' }).catch(() => {});
    pageRunning = false;
    pageEpoch++;
    pageBusy = false;
    pageObserver?.disconnect();
    pageMutation?.disconnect();
    pageQueue = [];
    additions.forEach((node) => node.remove());
    additions = [];
    seen = new WeakSet();
    pageCount = 0;
  }

  const blocks = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,figcaption';

  function observePage(): void {
    const candidates = document.querySelectorAll(blocks);
    let observed = 0;
    for (const node of candidates) {
      if (
        seen.has(node) ||
        node.querySelector(blocks) ||
        node.closest(
          '[contenteditable],pre,code,nav,script,style,textarea,[data-local-translation]',
        )
      ) {
        continue;
      }
      const text = node.textContent?.trim() || '';
      if (text.length < 4 || text.length > 6000 || !/[a-zA-Z]/.test(text)) {
        continue;
      }
      seen.add(node);
      pageObserver?.observe(node);
      observed++;
    }
    if (observed || !candidates.length) {
      LTLog('page.scan', {
        candidates: candidates.length,
        newlyObserved: observed,
        queue: pageQueue.length,
      });
    }
  }

  async function pageWork(): Promise<void> {
    if (pageBusy || !pageRunning || !pageQueue.length) return;
    pageBusy = true;
    const run = pageEpoch;
    const batch = pageQueue.splice(0, 3).filter((n) => n.isConnected);
    const texts = batch.map((n) => n.textContent?.trim() || '');
    LTLog('page.batch', {
      blocks: batch.length,
      characters: texts.reduce((n, t) => n + t.length, 0),
      remaining: pageQueue.length,
    });
    try {
      if (!batch.length) return;
      const data = await send({ type: 'translate', texts, scope: 'page' });
      if (run !== pageEpoch) return;
      batch.forEach((node, i) => {
        if (!node.isConnected || node.textContent?.trim() !== texts[i]) return;
        const translated = document.createElement('span');
        translated.dataset.localTranslation = 'true';
        translated.lang = 'vi';
        translated.textContent = data.translations[i];
        translated.style.cssText =
          'display:block;color:#16816b;border-left:3px solid #48b59c;padding:4px 10px;margin:6px 0;font-size:0.95em;line-height:1.6;';
        node.append(translated);
        additions.push(translated);
        pageCount++;
      });
      status(`Đã dịch ${pageCount} đoạn · cuộn trang để dịch tiếp`);
    } catch (error: any) {
      if (run === pageEpoch) {
        status(error.message);
        pageRunning = false;
      }
    } finally {
      if (run === pageEpoch) {
        pageBusy = false;
        if (pageRunning) setTimeout(pageWork, 50);
      }
    }
  }

  function startPage(): void {
    stopPage();
    LTCaptionUI.ensure();
    pageRunning = true;
    LTLog('mode.page.start', {
      hint: 'Dịch trang; để dịch video hãy chọn Dịch & đọc video trong popup.',
    });
    snapshot('page-start');
    status('Đang dịch nội dung trong vùng nhìn thấy…');
    pageObserver = new IntersectionObserver(
      (entries) => {
        LTLog('page.visibility', {
          observed: entries.length,
          visible: entries.filter((e) => e.isIntersecting).length,
        });
        for (const entry of entries) {
          if (entry.isIntersecting) {
            pageObserver?.unobserve(entry.target);
            pageQueue.push(entry.target);
          }
        }
        pageWork();
      },
      { rootMargin: '200px' },
    );
    observePage();
    const run = pageEpoch;
    setTimeout(() => {
      if (run === pageEpoch && pageRunning && !pageCount) {
        snapshot('page-no-result-after-5s');
        LTLog('page.waiting', {
          queue: pageQueue.length,
          busy: pageBusy,
          hint: pageBusy
            ? 'Đang chờ phản hồi bộ dịch ' + profile.label + '.'
            : 'Chưa có đoạn văn bản hiển thị để dịch trong frame này. Video cần chế độ Dịch & đọc video.',
        });
      }
    }, 5000);
    let debounce: any;
    pageMutation = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (pageRunning) observePage();
      }, 500);
    });
    pageMutation.observe(document.body, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener(
    (message: any, _sender: chrome.runtime.MessageSender, reply: (response?: any) => void) => {
      if (message.type === 'speech-event') {
        finishSpeech(message.id, message.event, message.error);
        return;
      }
      if (message.type === 'live-ui') {
        if (message.phase === 'connecting') stopSegmented();
        showLiveUi(message);
        reply({ shown: true });
        return;
      }
      if (message.type === 'live-hold') {
        const picked = LTYoutubeControls.getVideo();
        if (picked && !picked.paused) {
          liveHeldVideo = picked;
          picked.pause();
          reply({ held: true });
        } else {
          reply({ held: false });
        }
        return;
      }
      LTLog('command.received', { type: message.type, videoId: message.videoId });
      if (message.type === 'inspect') {
        snapshot('scan');
        reply({
          title: document.title,
          url: location.href,
          videos: Array.from(document.querySelectorAll('video')).map((v) => ({
            id: videoId(v),
            playing: !v.paused,
            width: Math.round(v.getBoundingClientRect().width),
            duration: Number.isFinite(v.duration) ? Math.round(v.duration) : null,
            tracks: v.textTracks?.length || 0,
          })),
        });
        return;
      }
      if (message.type === 'start-video') {
        stopSegmented();
        startVideo(message.videoId)
          .then(() => reply({ started: true }))
          .catch((e) => reply({ error: e.message }));
        return true;
      }
      if (message.type === 'start-page') {
        startPage();
        reply({ started: true });
        return;
      }
      if (message.type === 'stop-page') {
        stopPage();
        if (!video) LTCaptionUI.remove();
        reply({ stopped: true });
        return;
      }
      if (message.type === 'stop-video') {
        stopVideo();
        if (!pageRunning) LTCaptionUI.remove();
        reply({ stopped: true });
        return;
      }
      if (message.type === 'stop') {
        stopSegmented();
        stopVideo();
        stopPage();
        LTCaptionUI.remove();
        reply({ stopped: true });
        return;
      }
      if (message.type === 'get-mode') {
        const currentMode = video
          ? 'offline'
          : segmentedPlayer
            ? 'dubbing'
            : ['connecting', 'active', 'transcript', 'paused'].includes(liveOverlayPhase)
              ? 'live'
              : 'idle';
        reply({ mode: currentMode, livePhase: liveOverlayPhase });
        return;
      }
      if (message.type === 'toggle-mode') {
        const target = message.mode;
        (async () => {
          if (target === 'offline') {
            stopSegmented();
            if (video) {
              stopVideo();
              LTCaptionUI.remove();
            } else {
              await send({ type: 'live-stop' }).catch(() => {});
              const picked = LTYoutubeControls.getVideo();
              if (!picked) throw new Error('Chưa tìm thấy video trên trang.');
              await startVideo(videoId(picked));
            }
          } else if (target === 'live') {
            stopSegmented();
            if (video) {
              stopVideo();
              LTCaptionUI.remove();
            }
            await send({ type: 'live-toggle' });
          }
        })()
          .then(() => reply({ ok: true }))
          .catch((err) => reply({ ok: false, error: err.message }));
        return true;
      }
      if (message.type === 'save-and-reload') {
        (async () => {
          await refreshSettings();
          if (profile.loadPublicSettings) {
            stopSpeech();
            if (video) stopVideo();
            return;
          }
          const picked = LTYoutubeControls.getVideo() || document.querySelector('video');
          if (picked && !picked.paused) {
            picked.pause();
          }
          stopSpeech();
          if (
            ['connecting', 'active', 'transcript', 'paused', 'reconnecting'].includes(
              liveOverlayPhase,
            )
          ) {
            await send({ type: 'live-stop' }).catch(() => {});
            setTimeout(async () => {
              await send({ type: 'live-toggle' }).catch((error: any) => status(error.message));
            }, 300);
          }
        })()
          .then(() => reply({ ok: true }))
          .catch((err) => reply({ ok: false, error: err.message }));
        return true;
      }
    },
  );

  LTYoutubeControls.observe({
    segmentedDubbing:
      Boolean(profile.segmentedPlayer) &&
      publicSettingsData?.featureFlags?.enableSegmentedDubbing !== false &&
      publicSettingsData?.provider !== 'gemini',
    subtitlesEnabled: publicSettingsData?.featureFlags?.enableSubtitles !== false,
    liveEnabled: publicSettingsData?.featureFlags?.enableLive !== false,
    getDubbingActive: () => segmentedPlayer !== null,
    onDubbingClick: () => {
      void toggleSegmented();
    },
    getSubtitleActive: () => video !== null,
    getLivePhase: () => liveOverlayPhase,
    onSubtitleClick: async () => {
      stopSegmented();
      const picked = LTYoutubeControls.getVideo();
      if (!picked) {
        status('Chưa tìm thấy video YouTube.');
        return;
      }
      await send({ type: 'live-stop' }).catch(() => {});
      if (video === picked) {
        stopVideo();
        LTCaptionUI.remove();
        return;
      }
      startVideo(videoId(picked)).catch((error) => status(error.message));
    },
    onLiveClick: async () => {
      stopSegmented();
      if (video) {
        stopVideo();
        LTCaptionUI.remove();
      }
      await send({ type: 'live-toggle' }).catch((error) => status(error.message));
    },
    videoCallbacks: {
      onPause: () => {
        if (liveHeldVideo === LTYoutubeControls.getVideo()) return;
        if (['connecting', 'active', 'transcript', 'reconnecting'].includes(liveOverlayPhase)) {
          send({ type: 'live-pause' }).catch(() => {});
          liveOverlayPhase = 'paused';
          LTYoutubeControls.updateLiveButton('paused');
          LTCaptionUI.setBadge('live', 'paused');
          LTCaptionUI.setLoading();
        }
      },
      onPlay: () => {
        if (liveHeldVideo === LTYoutubeControls.getVideo()) {
          liveHeldVideo = null;
        }
        if (liveVideoKey && ['connecting', 'reconnecting'].includes(liveOverlayPhase)) {
          const picked = LTYoutubeControls.getVideo();
          if (picked) {
            liveHeldVideo = picked;
            picked.pause();
          }
          return;
        }
        if (liveOverlayPhase === 'paused') {
          const picked = LTYoutubeControls.getVideo();
          if (picked) {
            liveHeldVideo = picked;
            picked.pause();
          }
          send({ type: 'live-resume' }).catch(() => {});
          liveOverlayPhase = 'reconnecting';
          LTYoutubeControls.updateLiveButton('reconnecting');
          LTCaptionUI.setBadge('live', 'reconnecting');
          LTCaptionUI.setLoading();
        }
      },
      onSeeking: () => {
        if (liveVideoKey && !['stopped', 'stopping', 'error'].includes(liveOverlayPhase)) {
          liveSeeking = true;
          const picked = LTYoutubeControls.getVideo();
          if (picked && !picked.paused) {
            liveHeldVideo = picked;
            picked.pause();
          }
          LTCaptionUI.setText('', '');
          send({ type: 'live-seek', complete: false }).catch(() => {});
        }
      },
      onSeeked: () => {
        if (!liveSeeking || !liveVideoKey) return;
        liveSeeking = false;
        send({
          type: 'live-seek',
          complete: true,
          paused: !liveHeldVideo && Boolean(LTYoutubeControls.getVideo()?.paused),
        }).catch(() => {});
      },
      onVideoChanged: (picked) => {
        if (liveVideoKey && (!picked || liveVideoKey !== youtubeVideoKey())) {
          stopLiveForNavigation();
        }
      },
      onEnded: () => {
        stopLiveForNavigation();
      },
    },
  });

  LTCaptionUI.setOnLiveToggle(async () => {
    stopSegmented();
    if (video) {
      stopVideo();
    }
    await send({ type: 'live-toggle' }).catch((error) => status(error.message));
  });
  LTCaptionUI.setOnImport((file) => {
    void (async () => {
      if (file.size > 5 * 1024 * 1024) throw new Error('File phụ đề tối đa 5 MB.');
      const cues = S.parse(await file.text());
      if (!cues.length) throw new Error('File không có phụ đề SRT/VTT hợp lệ.');
      const picked = video || LTYoutubeControls.getVideo();
      if (!picked) throw new Error('Chưa tìm thấy video để dùng phụ đề.');
      stopSegmented();
      await send({ type: 'live-stop' }).catch(() => {});
      await startVideo(videoId(picked), cues);
    })().catch((error) => {
      status(error.message);
      LTCaptionUI.setText('', error.message);
    });
  });

  LTLog('content.ready', {
    version: chrome.runtime?.getManifest?.()?.version,
    videos: document.querySelectorAll('video').length,
    iframes: document.querySelectorAll('iframe').length,
  });
}
