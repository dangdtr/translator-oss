export interface VideoCallbacks {
  onPause?: () => void;
  onPlay?: () => void;
  onSeeking?: () => void;
  onSeeked?: () => void;
  onVideoChanged?: (video: HTMLVideoElement | null) => void;
  onEnded?: () => void;
}

export interface ControlsConfig {
  segmentedDubbing?: boolean;
  subtitlesEnabled?: boolean;
  liveEnabled?: boolean;
  onSubtitleClick?: () => void;
  onLiveClick?: () => void;
  onDubbingClick?: () => void;
  getDubbingActive?: () => boolean;
  getSubtitleActive?: () => boolean;
  getLivePhase?: () => string;
  videoCallbacks?: VideoCallbacks;
}

let subtitleLabel = 'offline';
export function configure(label: string): void { subtitleLabel = label; }

const CONTROLS_SELECTOR =
  '#movie_player > div.ytp-chrome-bottom > div.ytp-chrome-controls > div.ytp-right-controls';
let watchedVideo: HTMLVideoElement | null = null;
let videoCallbacks: VideoCallbacks = {};
const fullscreenButtons = new WeakSet<HTMLButtonElement>();

export function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('local-translator-yt-style')) return;
  const style = document.createElement('style');
  style.id = 'local-translator-yt-style';
  style.textContent = `
    #local-translator-youtube-button.local-translator-active img {
      filter: drop-shadow(0 0 6px rgba(99, 102, 241, 0.9));
    }
    #local-translator-live-button {
      color: #fff;
      transition: color 0.2s, filter 0.2s;
    }
    #local-translator-live-button.local-translator-live-active {
      color: #ff3b30 !important;
      filter: drop-shadow(0 0 6px rgba(255, 59, 48, 0.85));
    }
    #local-translator-live-button.local-translator-live-connecting {
      color: #f59e0b !important;
    }
    #local-translator-live-button.local-translator-live-paused {
      color: #94a3b8 !important;
      opacity: 0.85;
    }
  `;
  document.head?.append(style);
}

export function updateSubtitleButton(active: boolean): void {
  if (typeof document === 'undefined') return;
  const button = document.querySelector('#local-translator-youtube-button');
  if (!button) return;
  button.classList.toggle('local-translator-active', Boolean(active));
  button.setAttribute('aria-pressed', String(Boolean(active)));
  button.setAttribute(
    'title',
    active ? 'Đang dịch phụ đề (Bấm để dừng)' : `Dịch phụ đề tiếng Việt (${subtitleLabel})`,
  );
}

export function updateLiveButton(phase: string): void {
  if (typeof document === 'undefined') return;
  const button = document.querySelector('#local-translator-live-button');
  if (!button) return;
  const isActive = ['active', 'transcript'].includes(phase);
  const isConnecting = ['connecting', 'reconnecting'].includes(phase);
  const isPaused = phase === 'paused';
  button.classList.toggle('local-translator-live-active', isActive);
  button.classList.toggle('local-translator-live-connecting', isConnecting);
  button.classList.toggle('local-translator-live-paused', isPaused);
  button.setAttribute('aria-pressed', String(isActive || isConnecting || isPaused));
  if (isPaused) button.setAttribute('title', 'Gemini Live đang tạm dừng (Bấm để tắt)');
  else if (isConnecting) button.setAttribute('title', 'Đang kết nối Gemini Live… (Bấm để hủy)');
  else if (isActive) button.setAttribute('title', 'Đang chạy Gemini Live (Bấm để tắt)');
  else button.setAttribute('title', 'Bật Gemini Live Audio Translate');
}

const handlePause = () => videoCallbacks.onPause?.();
const handlePlay = () => videoCallbacks.onPlay?.();
const handleSeeking = () => videoCallbacks.onSeeking?.();
const handleSeeked = () => videoCallbacks.onSeeked?.();
const handleEnded = () => videoCallbacks.onEnded?.();

export function watchVideo(callbacks?: VideoCallbacks): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null;
  if (callbacks) videoCallbacks = callbacks;
  const v =
    (document.querySelector('#movie_player video') as HTMLVideoElement | null) ||
    (document.querySelector('video') as HTMLVideoElement | null);
  if (v === watchedVideo) return watchedVideo;
  if (watchedVideo) {
    watchedVideo.removeEventListener('pause', handlePause);
    watchedVideo.removeEventListener('play', handlePlay);
    watchedVideo.removeEventListener('seeking', handleSeeking);
    watchedVideo.removeEventListener('seeked', handleSeeked);
    watchedVideo.removeEventListener('ended', handleEnded);
  }
  watchedVideo = v;
  if (watchedVideo) {
    watchedVideo.addEventListener('pause', handlePause);
    watchedVideo.addEventListener('play', handlePlay);
    watchedVideo.addEventListener('seeking', handleSeeking);
    watchedVideo.addEventListener('seeked', handleSeeked);
    watchedVideo.addEventListener('ended', handleEnded);
  }
  videoCallbacks.onVideoChanged?.(watchedVideo);
  return watchedVideo;
}

export function installButtons(config: ControlsConfig = {}): void {
  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  const controls = document.querySelector(CONTROLS_SELECTOR);
  if (!controls) return;
  ensureStyles();

  // 1. Local Subtitle Button
  let subBtn = controls.querySelector('#local-translator-youtube-button') as HTMLButtonElement | null;
  if (!subBtn) {
    subBtn = document.createElement('button');
    subBtn.id = 'local-translator-youtube-button';
    subBtn.className = 'ytp-button';
    subBtn.type = 'button';
    subBtn.title = `Dịch phụ đề tiếng Việt (${subtitleLabel})`;
    subBtn.setAttribute('aria-label', 'Dịch phụ đề tiếng Việt');
    subBtn.setAttribute('aria-pressed', 'false');
    subBtn.innerHTML = `<img src="${chrome.runtime.getURL('logo.svg')}" alt="" style="display:block;width:26px;height:26px;margin:auto">`;
    subBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      config.onSubtitleClick?.();
    });
    controls.append(subBtn);
  }
  if (subBtn) {
    subBtn.style.display = config.subtitlesEnabled === false ? 'none' : '';
  }

  // 2. Gemini Live Button
  let liveBtn = controls.querySelector('#local-translator-live-button') as HTMLButtonElement | null;
  if (!liveBtn) {
    liveBtn = document.createElement('button');
    liveBtn.id = 'local-translator-live-button';
    liveBtn.className = 'ytp-button';
    liveBtn.type = 'button';
    liveBtn.title = 'Bật Gemini Live Audio Translate';
    liveBtn.setAttribute('aria-label', 'Bật Gemini Live Translate');
    liveBtn.setAttribute('aria-pressed', 'false');
    liveBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" style="display:block;margin:auto;fill:currentColor">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
      </svg>
    `;
    liveBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      config.onLiveClick?.();
    });
    controls.append(liveBtn);
  }
  if (liveBtn) {
    liveBtn.style.display = config.liveEnabled === false ? 'none' : '';
  }

  if (typeof config.getSubtitleActive === 'function') {
    updateSubtitleButton(config.getSubtitleActive());
  }
  let dubBtn = controls.querySelector('#local-translator-dubbing-button') as HTMLButtonElement | null;
  if (config.segmentedDubbing !== false) {
    if (!dubBtn) {
      dubBtn = document.createElement('button');
      dubBtn.id = 'local-translator-dubbing-button';
      dubBtn.className = 'ytp-button';
      dubBtn.type = 'button';
      dubBtn.textContent = 'VI';
      dubBtn.style.fontWeight = 'bold';
      dubBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        config.onDubbingClick?.();
      });
      controls.append(dubBtn);
    }
    dubBtn.style.display = '';
    const dubbingActive = Boolean(config.getDubbingActive?.());
    dubBtn.title = dubbingActive ? 'Tắt dịch voice theo đoạn' : 'Dịch voice theo đoạn (thử nghiệm)';
    dubBtn.setAttribute('aria-label', dubBtn.title);
    dubBtn.setAttribute('aria-pressed', String(dubbingActive));
    dubBtn.style.color = dubbingActive ? '#34d399' : '';
  } else if (dubBtn) {
    dubBtn.style.display = 'none';
  }
  if (typeof config.getLivePhase === 'function') {
    updateLiveButton(config.getLivePhase());
  }

  watchVideo(config.videoCallbacks);

  const fullscreenBtn = document.querySelector(
    '#movie_player .ytp-fullscreen-button',
  ) as HTMLButtonElement | null;
  if (fullscreenBtn && !fullscreenButtons.has(fullscreenBtn)) {
    fullscreenButtons.add(fullscreenBtn);
    fullscreenBtn.addEventListener(
      'click',
      event => {
        const player = document.querySelector('#movie_player') as HTMLElement | null;
        if (!player || !document.fullscreenEnabled) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          player.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
        }
      },
      true,
    );
  }
}

export function observe(config: ControlsConfig = {}): void {
  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  const refresh = () => {
    installButtons(config);
    watchVideo(config.videoCallbacks);
  };
  refresh();
  new MutationObserver(refresh).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener('yt-navigate-finish', refresh);
}

export function getVideo(): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null;
  return (
    watchedVideo ||
    (document.querySelector('#movie_player video') as HTMLVideoElement | null) ||
    (document.querySelector('video') as HTMLVideoElement | null)
  );
}

export const LTYoutubeControls = {
  configure,
  installButtons,
  observe,
  updateSubtitleButton,
  updateLiveButton,
  watchVideo,
  getVideo,
};

declare global {
  var LTYoutubeControls: {
    installButtons: typeof installButtons;
    observe: typeof observe;
    updateSubtitleButton: typeof updateSubtitleButton;
    updateLiveButton: typeof updateLiveButton;
    watchVideo: typeof watchVideo;
    getVideo: typeof getVideo;
  };
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).LTYoutubeControls = LTYoutubeControls;
}
