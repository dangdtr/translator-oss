import type {
  CaptionCue,
  SentenceUnit,
  YouTubeJson3Data,
} from '../types/subtitles';

export interface SentenceOptions {
  maxGap?: number;
  maxDuration?: number;
  maxChars?: number;
  maxCues?: number;
}

export function clean(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function timestamp(value: string): number {
  const parts = value.replace(',', '.').split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function normalize(
  cues: Array<{ start: number | string; end: number | string; text: unknown }>,
): CaptionCue[] {
  return cues
    .map(c => ({
      start: Number(c.start),
      end: Number(c.end),
      text: clean(c.text),
    }))
    .filter(
      c =>
        Number.isFinite(c.start) &&
        Number.isFinite(c.end) &&
        c.start >= 0 &&
        c.end > c.start &&
        c.text,
    )
    .sort((a, b) => a.start - b.start);
}

export function parse(text: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const lines = text.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(
      /^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)/,
    );
    if (!match) continue;
    const content: string[] = [];
    while (++i < lines.length && lines[i].trim()) {
      content.push(lines[i]);
    }
    cues.push({
      start: timestamp(match[1]),
      end: timestamp(match[2]),
      text: content.join(' '),
    });
  }
  return normalize(cues);
}

export function json3(data: YouTubeJson3Data): CaptionCue[] {
  return normalize(
    (data.events || [])
      .filter(e => e.segs)
      .map(e => ({
        start: (e.tStartMs || 0) / 1000,
        end: ((e.tStartMs || 0) + (e.dDurationMs || 2000)) / 1000,
        text: (e.segs || []).map(s => s.utf8 || '').join(''),
      })),
  );
}

export function indexAt(cues: CaptionCue[], time: number): number {
  let low = 0,
    high = cues.length - 1,
    found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].start <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found >= 0 && cues[found].end > time ? found : -1;
}

export function sentences(
  cues: CaptionCue[],
  {
    maxGap = 1.2,
    maxDuration = 12,
    maxChars = 320,
    maxCues = 6,
  }: SentenceOptions = {},
): SentenceUnit[] {
  const units: SentenceUnit[] = [];
  let unit: SentenceUnit | null = null;
  cues.forEach((cue, i) => {
    if (
      unit &&
      (cue.start - unit.end > maxGap ||
        cue.end - unit.start > maxDuration ||
        unit.text.length + cue.text.length + 1 > maxChars ||
        unit.cues.length >= maxCues)
    ) {
      units.push(unit);
      unit = null;
    }
    if (unit) {
      unit.end = Math.max(unit.end, cue.end);
      unit.text += ' ' + cue.text;
      unit.cues.push(i);
    } else {
      unit = { start: cue.start, end: cue.end, text: cue.text, cues: [i] };
    }
    if (/[.!?…]["'”’)\]]*$/.test(cue.text)) {
      units.push(unit);
      unit = null;
    }
  });
  if (unit) units.push(unit);
  return units;
}

export const LocalSubtitles = {
  clean,
  timestamp,
  normalize,
  parse,
  json3,
  indexAt,
  sentences,
};

declare global {
  var LocalSubtitles: {
    clean: typeof clean;
    timestamp: typeof timestamp;
    normalize: typeof normalize;
    parse: typeof parse;
    json3: typeof json3;
    indexAt: typeof indexAt;
    sentences: typeof sentences;
  };
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).LocalSubtitles = LocalSubtitles;
}
