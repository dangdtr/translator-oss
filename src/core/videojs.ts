import type { CaptionCue } from '../types/subtitles';

export interface VideoJsSelection {
  index: number;
  elementId?: string;
}

export interface VideoJsTrackInfo {
  language?: string;
  kind?: string;
  mode?: string;
  cues: number | null;
}

export interface VideoJsResult {
  reason: string;
  tracks: VideoJsTrackInfo[];
  cues: CaptionCue[];
}

export async function readVideoJsCaptions(selection: VideoJsSelection): Promise<VideoJsResult> {
  const video = document.querySelectorAll('video')[selection.index];
  if (!video || (selection.elementId && video.id !== selection.elementId)) {
    return { reason: 'video-changed', tracks: [], cues: [] };
  }
  const container = video.closest('.video-js') as HTMLElement | null;
  if (!container) return { reason: 'not-videojs', tracks: [], cues: [] };

  const win = window as unknown as {
    videojs?: {
      getPlayer?: (id: string) => any;
      getPlayers?: () => Record<string, any>;
    };
  };

  let player = (container as any).player;
  if (!player && typeof win.videojs?.getPlayer === 'function' && container.id) {
    player = win.videojs.getPlayer(container.id);
  }
  if (!player && typeof win.videojs?.getPlayers === 'function') {
    player = Object.values(win.videojs.getPlayers() || {}).find(p => p?.el?.()?.contains(video));
  }
  if (!player || typeof player.textTracks !== 'function' || !player.el?.()?.contains(video)) {
    return { reason: 'player-api-unavailable', tracks: [], cues: [] };
  }

  let tracks: any[] = [];
  let track: any = null;
  for (let attempt = 0; attempt < 11; attempt++) {
    if (!video.isConnected || player.isDisposed?.()) {
      return { reason: 'player-disposed', tracks: [], cues: [] };
    }
    tracks = Array.from(player.textTracks() || []);
    const candidates = tracks.filter(t => ['captions', 'subtitles'].includes(t.kind));
    const english = candidates.filter(
      t => /^en(?:[-_]|$)/i.test(t.language || '') || (!t.language && /^english\b/i.test(t.label || '')),
    );
    track =
      english.find(t => t.mode === 'showing') ||
      english[0] ||
      candidates.find(t => !t.language && t.mode === 'showing');
    if (track?.cues?.length || attempt === 10) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const info: VideoJsTrackInfo[] = tracks.map(t => ({
    language: t.language,
    kind: t.kind,
    mode: t.mode,
    cues: t.cues?.length ?? null,
  }));

  if (!track) return { reason: 'no-english-track', tracks: info, cues: [] };

  let size = 0;
  const cues: CaptionCue[] = [];
  for (const cue of Array.from(track.cues || []) as any[]) {
    const text = String(cue.text || '').slice(0, 6000);
    size += text.length;
    if (cues.length >= 20000 || size > 4_000_000) {
      return { reason: 'track-too-large', tracks: info, cues: [] };
    }
    cues.push({ start: cue.startTime, end: cue.endTime, text });
  }
  return { reason: cues.length ? 'loaded' : 'track-not-loaded', tracks: info, cues };
}
