export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

export interface SentenceUnit {
  start: number;
  end: number;
  text: string;
  cues: number[];
}

export interface YouTubeJson3Segment {
  utf8?: string;
  tOffsetMs?: number;
  acbfOffsetMs?: number;
}

export interface YouTubeJson3Event {
  tStartMs?: number;
  dDurationMs?: number;
  wWinId?: number;
  segs?: YouTubeJson3Segment[];
}

export interface YouTubeJson3Data {
  events?: YouTubeJson3Event[];
  pens?: unknown[];
  wsWinStyles?: unknown[];
  wpWinPositions?: unknown[];
}
