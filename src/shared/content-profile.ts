import type { SegmentedPlayer } from '../core/segmented-player';

export interface PublicSettingsPayload {
  mode: 'subtitles' | 'live';
  speechEnabled: boolean;
  provider?: string;
  featureFlags?: {
    enablePageTranslation?: boolean;
    enableSubtitles?: boolean;
    enableSpeech?: boolean;
    enableLive?: boolean;
    enableSegmentedDubbing?: boolean;
    enableTextModel?: boolean;
  };
  [key: string]: any;
}

export interface ContentProfile {
  label: string;
  subtitleLabel: string;
  voiceName(engine?: string): string;
  loadPublicSettings?(): Promise<PublicSettingsPayload>;
  segmentedPlayer?: typeof SegmentedPlayer;
  connectionError: string;
  liveError?(code?: string): string;
}
