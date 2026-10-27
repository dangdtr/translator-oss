let host: HTMLElement | null = null;
let ui: ShadowRoot | null = null;
let onLiveToggle: (() => void) | null = null;
let onImport: ((file: File) => void) | null = null;
let subtitlesHidden = false;
let subtitleLabel = 'Offline';
export function configure(label: string): void { subtitleLabel = label; }

const eyeIcon = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="display:block;fill:currentColor"><path d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>`;
const eyeOffIcon = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="display:block;fill:currentColor"><path d="m2.1 3.51 1.41-1.42 18.4 18.4-1.42 1.42-3.28-3.28A12.7 12.7 0 0 1 12 20C7 20 2.73 16.89 1 13a12.9 12.9 0 0 1 4.04-5.1L2.1 3.51zM8.2 9.62A5 5 0 0 0 14.38 15.8L8.2 9.62zM12 6c5 0 9.27 3.11 11 7a12.7 12.7 0 0 1-3.28 4.4l-2.9-2.9A5 5 0 0 0 9.5 7.18L7.8 5.48A13 13 0 0 1 12 6z"/></svg>`;

function updateSubtitleVisibility(): void {
  if (!host || !ui) return;
  const card = ui.querySelector('.card');
  const button = ui.querySelector('#subtitle-visibility') as HTMLButtonElement | null;
  card?.classList.toggle('subtitles-hidden', subtitlesHidden);
  if (!button) return;
  button.innerHTML = subtitlesHidden ? eyeIcon : eyeOffIcon;
  button.title = subtitlesHidden ? 'Hiện phụ đề' : 'Ẩn phụ đề';
  button.setAttribute('aria-label', subtitlesHidden ? 'Hiện phụ đề' : 'Ẩn phụ đề');
  button.setAttribute('aria-pressed', String(subtitlesHidden));
}

export function ensure(): { host: HTMLElement | null; ui: ShadowRoot | null } {
  if (typeof document === 'undefined') return { host: null, ui: null };
  if (host?.isConnected) return { host, ui };

  const existing = document.getElementById('local-translator-root');
  if (existing) existing.remove();

  host = document.createElement('div');
  host.id = 'local-translator-root';
  host.style.cssText =
    'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);z-index:2147483647;width:85vw;min-width:85vw;max-width:85vw;pointer-events:none;';
  ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `<style>
    :host {
      display: block !important;
      width: 85vw !important;
      min-width: 85vw !important;
      max-width: 85vw !important;
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    .card {
      position: relative;
      display: block;
      width: 85vw !important;
      min-width: 85vw !important;
      max-width: 85vw !important;
      box-sizing: border-box;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      color: #edf4ff;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 10px 84px 10px 18px;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.5);
      text-align: center;
      cursor: grab;
      pointer-events: auto;
      user-select: none;
      min-height: 48px;
    }
    .card:active { cursor: grabbing; }

    .controls {
      position: absolute;
      top: 6px;
      right: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      pointer-events: auto;
    }

    .card.subtitles-hidden {
      width: max-content !important;
      min-width: 0 !important;
      max-width: 100% !important;
      min-height: 0;
      margin-left: auto;
      padding: 6px;
    }
    .card.subtitles-hidden .controls {
      position: static;
      justify-content: flex-end;
    }
    .card.subtitles-hidden #source,
    .card.subtitles-hidden #target { display: none; }

    #live-indicator {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      font: 700 10px/1.2 system-ui, sans-serif;
      letter-spacing: 0.5px;
      color: #94a3b8;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s;
    }
    #live-indicator:hover {
      background: rgba(255, 255, 255, 0.18);
      color: #ffffff;
    }
    .live-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #64748b;
      transition: all 0.2s;
    }
    #live-indicator.active {
      background: rgba(239, 68, 68, 0.22);
      border-color: rgba(239, 68, 68, 0.45);
      color: #fca5a5;
    }
    #live-indicator.active .live-dot {
      background: #ef4444;
      box-shadow: 0 0 6px #ef4444;
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.85); }
    }
    #live-indicator.paused {
      background: rgba(245, 158, 11, 0.22);
      border-color: rgba(245, 158, 11, 0.45);
      color: #fde68a;
    }
    #live-indicator.paused .live-dot {
      background: #f59e0b;
      box-shadow: 0 0 6px #f59e0b;
      animation: none;
    }
    #live-indicator.connecting {
      background: rgba(56, 189, 248, 0.2);
      border-color: rgba(56, 189, 248, 0.45);
      color: #bae6fd;
    }
    #live-indicator.connecting .live-dot {
      background: #38bdf8;
      box-shadow: 0 0 6px #38bdf8;
      animation: pulse 0.8s ease-in-out infinite;
    }

    #reset {
      width: 22px;
      height: 22px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #94a3b8;
      font: 14px/1 system-ui, sans-serif;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    #subtitle-visibility {
      width: 22px;
      height: 22px;
      padding: 3px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #94a3b8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    #subtitle-visibility:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
    }
    #reset:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
    }

    #source {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      font-size: 18px;
      line-height: 1.4;
      color: #cbd5e1;
      font-family: system-ui, -apple-system, sans-serif;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75);
      word-break: break-word;
      overflow-wrap: break-word;
    }
    #source:empty { display: none; }

    #target {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      font-size: 18px;
      font-weight: 600;
      line-height: 1.4;
      color: #ffffff;
      font-family: system-ui, -apple-system, sans-serif;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75);
      margin-top: 3px;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    #target:empty { display: none; }
    /* Live turns may run for minutes. Keep a rolling window instead of
       letting the accumulated transcript cover the video. */
    .card.live-subtitles #source {
      max-height: min(2.8em, 8vh);
      overflow: hidden;
    }
    .card.live-subtitles #target {
      max-height: min(4.2em, 12vh);
      overflow: hidden;
    }
  </style>
  <div class="card">
    <div class="controls">
      <button id="live-indicator" type="button" title="Chế độ ${subtitleLabel} · Bấm để bật Gemini Live" aria-label="Bật/Tắt Gemini Live">
        <span class="live-dot"></span>
        <span class="live-text">LIVE</span>
      </button>
      <button id="subtitle-visibility" type="button" title="Ẩn phụ đề" aria-label="Ẩn phụ đề" aria-pressed="false">${eyeOffIcon}</button>
      <button id="reset" type="button" title="Đưa phụ đề về vị trí mặc định" aria-label="Đưa phụ đề về vị trí mặc định">↺</button>
      <label title="Mở SRT / VTT" style="cursor:pointer;font:11px system-ui">SRT/VTT<input id="file" type="file" accept=".srt,.vtt" style="display:none"></label>
    </div>
    <div id="source"></div>
    <div id="target"></div>
  </div>`;

  (document.fullscreenElement || document.body || document.documentElement).append(host);
  const card = ui.querySelector('.card') as HTMLElement;
  const resetBtn = ui.querySelector('#reset') as HTMLButtonElement;
  const liveBtn = ui.querySelector('#live-indicator') as HTMLButtonElement;
  const visibilityBtn = ui.querySelector('#subtitle-visibility') as HTMLButtonElement;
  const fileInput = ui.querySelector('#file') as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) onImport?.(file);
    fileInput.value = '';
  });

  updateSubtitleVisibility();

  const resetPosition = () => {
    if (!host) return;
    host.style.left = '50%';
    host.style.top = '';
    host.style.bottom = '64px';
    host.style.transform = 'translateX(-50%)';
  };

  resetBtn.addEventListener('click', event => {
    event.stopPropagation();
    resetPosition();
  });

  visibilityBtn.addEventListener('click', event => {
    event.stopPropagation();
    subtitlesHidden = !subtitlesHidden;
    updateSubtitleVisibility();
  });

  liveBtn.addEventListener('click', event => {
    event.stopPropagation();
    onLiveToggle?.();
  });

  card.addEventListener('pointerdown', (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest('#reset') ||
      (event.target as HTMLElement).closest('#subtitle-visibility') ||
      (event.target as HTMLElement).closest('#live-indicator') ||
      (event.target as HTMLElement).closest('.controls')
    ) {
      return;
    }
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    card.setPointerCapture(event.pointerId);

    const move = (current: PointerEvent) => {
      if (!host) return;
      const width = host.getBoundingClientRect().width;
      const height = host.getBoundingClientRect().height;
      const left = Math.max(0, Math.min(window.innerWidth - width, current.clientX - offsetX));
      const top = Math.max(0, Math.min(window.innerHeight - height, current.clientY - offsetY));
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
      host.style.bottom = 'auto';
      host.style.transform = 'none';
    };

    const end = () => {
      card.removeEventListener('pointermove', move as EventListener);
      card.removeEventListener('pointerup', end);
      card.removeEventListener('pointercancel', end);
    };

    card.addEventListener('pointermove', move as EventListener);
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  });

  return { host, ui };
}

export function setBadge(mode?: string, phase?: string): void {
  if (!ui) return;
  ui.querySelector('.card')?.classList.toggle('live-subtitles', mode === 'live');
  const live = ui.querySelector('#live-indicator') as HTMLElement | null;
  if (!live) return;
  const text = live.querySelector('.live-text');
  live.classList.remove('active', 'paused', 'connecting');
  if (mode === 'live') {
    if (phase === 'paused') {
      live.classList.add('paused');
      if (text) text.textContent = 'PAUSED';
      live.title = 'Gemini Live: Tạm dừng · Bấm để tắt';
    } else if (['connecting', 'reconnecting'].includes(phase || '')) {
      live.classList.add('connecting');
      if (text) text.textContent = 'CONNECTING';
      live.title = 'Đang kết nối Gemini Live… (Bấm để hủy)';
    } else {
      live.classList.add('active');
      if (text) text.textContent = 'LIVE';
      live.title = 'Gemini Live: Đang chạy · Bấm để tắt';
    }
  } else {
    if (text) text.textContent = 'LIVE';
    live.title = `Chế độ ${subtitleLabel} · Bấm để bật Gemini Live`;
  }
}

export function setText(sourceText?: string, targetText?: string): void {
  if (!ui || !host?.isConnected) ensure();
  if (!ui) return;
  const source = ui.querySelector('#source');
  const target = ui.querySelector('#target');
  if (source && typeof sourceText === 'string') source.textContent = sourceText;
  if (target && typeof targetText === 'string') target.textContent = targetText;
  if (ui.querySelector('.card.live-subtitles')) {
    for (const element of [source, target]) {
      if (element) element.scrollTop = element.scrollHeight;
    }
  }
}

export function setLoading(): void {}

export function setStatus(text: string): void {
  if (!ui || !host?.isConnected) ensure();
  if (!ui) return;
  let status = ui.querySelector('#playback-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'playback-status';
    (status as HTMLElement).style.cssText = 'font:11px system-ui;color:#94a3b8;margin-top:4px';
    ui.querySelector('.card')?.append(status);
  }
  status.textContent = text;
}

export function setOnLiveToggle(callback: () => void): void {
  onLiveToggle = callback;
}
export function setOnImport(callback: (file: File) => void): void { onImport = callback; }

export function remove(): void {
  if (host?.isConnected) host.remove();
  host = null;
  ui = null;
}

export function isConnected(): boolean {
  return Boolean(host?.isConnected);
}

export function setSubtitlesHidden(hidden: boolean): void {
  subtitlesHidden = Boolean(hidden);
  updateSubtitleVisibility();
}

export function areSubtitlesHidden(): boolean {
  return subtitlesHidden;
}

export function getHost(): HTMLElement | null {
  return host;
}

export function getUi(): ShadowRoot | null {
  return ui;
}

if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    if (host?.isConnected) {
      (document.fullscreenElement || document.body).append(host);
    }
  });
}

export const LTCaptionUI = {
  setOnImport,
  configure,
  ensure,
  setBadge,
  setText,
  setLoading,
  setStatus,
  remove,
  isConnected,
  setSubtitlesHidden,
  areSubtitlesHidden,
  getHost,
  getUi,
  setOnLiveToggle,
};

declare global {
  var LTCaptionUI: {
    ensure: typeof ensure;
    setBadge: typeof setBadge;
    setText: typeof setText;
    setLoading: typeof setLoading;
    setStatus: typeof setStatus;
    remove: typeof remove;
    isConnected: typeof isConnected;
    setSubtitlesHidden: typeof setSubtitlesHidden;
    areSubtitlesHidden: typeof areSubtitlesHidden;
    getHost: typeof getHost;
    getUi: typeof getUi;
    setOnLiveToggle: typeof setOnLiveToggle;
  };
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).LTCaptionUI = LTCaptionUI;
}
