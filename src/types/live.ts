export type LiveState = 'idle' | 'connecting' | 'active' | 'paused' | 'stopping' | 'error';

export type LiveEvent =
  | 'click'
  | 'ready'
  | 'pause'
  | 'resume'
  | 'reset'
  | 'fail'
  | 'stop'
  | 'reconnecting'
  | 'transcript'
  | 'stopped'
  | 'error';

export type LiveUiPhase =
  | 'idle'
  | 'connecting'
  | 'active'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'reconnecting'
  | 'transcript'
  | 'error';

export interface LiveTranscriptState {
  original: string;
  translation: string;
  hasSentence: boolean;
}

export interface LiveUiPayload {
  phase: LiveUiPhase;
  original?: string;
  translation?: string;
  complete?: boolean;
  attempt?: number;
  code?: string;
}

export type LiveVoice = 'Aoede' | 'Kore' | 'Charon' | 'Puck' | 'Fenrir';
