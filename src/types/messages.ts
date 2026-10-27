import type { CaptionCue, SentenceUnit } from './subtitles';
import type { LiveUiPayload, LiveVoice } from './live';
import type { OfflineVoice } from './settings';

export interface FrameOwner {
  tabId: number;
  frameId?: number;
}

export type ExtensionMessage =
  | { type: 'health' }
  | { type: 'dubbing-segment'; videoId: string; index: number; jobId?: string }
  | { type: 'dubbing-status'; jobId: string }
  | { type: 'dubbing-cancel'; jobId: string }
  | { type: 'translate'; texts: string[]; source?: string; target?: string }
  | { type: 'caption-polish'; cues: CaptionCue[]; windowKey?: string }
  | {
      type: 'speech-play';
      id: number;
      text: string;
      voice?: OfflineVoice;
      wait?: number;
      startAt?: number;
      available?: number;
    }
  | { type: 'speech-test'; id: number; voice?: OfflineVoice }
  | { type: 'speech-prefetch'; texts: string[]; voice?: OfflineVoice }
  | { type: 'speech-warm'; texts: string[]; voice?: OfflineVoice }
  | { type: 'speech-stop'; id?: number }
  | { type: 'speech-state' }
  | {
      type: 'speech-event';
      owner: FrameOwner;
      id: number;
      event: 'ended' | 'error' | 'interrupted';
      error?: string;
    }
  | { type: 'live-toggle' }
  | { type: 'live-stop' }
  | { type: 'live-hold' }
  | { type: 'live-pause' }
  | { type: 'live-resume' }
  | { type: 'live-seek'; complete?: boolean; paused?: boolean }
  | ({ type: 'live-ui' } & LiveUiPayload)
  | {
      type: 'live-event';
      tabId?: number;
      sessionId?: string;
      epoch?: number;
      event: string;
      original?: string;
      translation?: string;
      complete?: boolean;
      attempt?: number;
      code?: string;
      error?: string;
    }
  | { type: 'scan'; tabId: number }
  | {
      type: 'command';
      tabId: number;
      frameId?: number;
      command: { type: string; videoId?: number };
    }
  | { type: 'inspect' }
  | { type: 'start-video'; videoId?: number }
  | { type: 'stop-video' }
  | { type: 'start-page' }
  | { type: 'stop-page' }
  | { type: 'save-and-reload' }
  | { type: 'videojs'; index: number; elementId?: string }
  | { type: 'youtube' };

export interface MessageResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
