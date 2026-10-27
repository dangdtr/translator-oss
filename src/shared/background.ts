import { LTLog } from '../core/logger';
import { nextLiveState } from '../core/live-state';
import { readVideoJsCaptions } from '../core/videojs';
import type { LiveState, LiveUiPayload } from '../types/live';
import type { FrameOwner } from '../types/messages';

export interface BackgroundProvider {
  api(
    path: string,
    body?: any,
    signal?: AbortSignal,
    owner?: FrameOwner & { scope?: string },
  ): Promise<any>;
  cancelOwner?(owner: FrameOwner & { scope?: string }): void;
  initialize(): Promise<unknown>;
  liveConfig(): Promise<Record<string, unknown>>;
  speechConfig(): Promise<Record<string, unknown>>;
  customMessages?: string[];
  customDispatch?(message: any, sender: chrome.runtime.MessageSender): Promise<any>;
}

export function installBackground(provider: BackgroundProvider) {
  const OFFSCREEN = 'offscreen.html';
  const SPEECH: Record<string, string> = {
    'speech-play': 'play',
    'speech-test': 'test',
    'speech-prefetch': 'prefetch',
    'speech-warm': 'warm',
    'speech-stop': 'stop',
    'speech-state': 'state',
  };

  let offscreenReady: Promise<any> = Promise.resolve();
  let creatingOffscreen: Promise<any> | null = null;
  let liveOperations: Promise<unknown> = Promise.resolve();
  const dubbingRequests = new Map<string, { tabId: number; controller: AbortController }>();

  function liveOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = liveOperations.then(operation);
    liveOperations = result.catch(() => {});
    return result;
  }

  const api = provider.api;
  async function ensureOffscreen(create: boolean): Promise<boolean> {
    const contexts = await (chrome.runtime as any).getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
    });
    if (contexts.length) return true;
    if (!create) return false;
    creatingOffscreen ??= chrome.offscreen
      .createDocument({
        url: OFFSCREEN,
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'Phát giọng đọc phụ đề và âm thanh dịch trực tiếp của video.',
      })
      .catch((error) => {
        if (!/single offscreen/i.test(error.message)) throw error;
      })
      .finally(() => {
        creatingOffscreen = null;
      });
    await creatingOffscreen;
    LTLog('offscreen.created');
    return true;
  }

  async function prepareLiveOffscreen(): Promise<void> {
    const ready = offscreenReady.then(async () => {
      const contexts = await (chrome.runtime as any).getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
      });
      if (contexts.length) await chrome.offscreen.closeDocument();
      creatingOffscreen = null;
      await chrome.offscreen.createDocument({
        url: OFFSCREEN,
        reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification:
          'Capture tab audio and play translated audio while Gemini Live mode is active.',
      });
    });
    offscreenReady = ready.catch(() => {});
    await ready;
  }

  async function closeLiveOffscreen(): Promise<void> {
    const contexts = await (chrome.runtime as any).getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
    });
    if (contexts.length) await chrome.offscreen.closeDocument();
  }

  function offscreen(message: any, create = true): Promise<any> {
    const ready = offscreenReady.then(() => ensureOffscreen(create));
    offscreenReady = ready.catch(() => {});
    return ready.then(async (exists) => {
      if (!exists) return null;
      const result = await chrome.runtime.sendMessage({
        ...message,
        target: 'offscreen',
      });
      if (result?.error) throw new Error(result.error);
      return result;
    });
  }
  (globalThis as any).offscreen = offscreen;

  const liveTabs = new Map<number, LiveState>();
  const liveOwners = new Map<number, { sessionId: string; epoch: number }>();

  function acceptLiveResult(tabId: number, result: any): boolean {
    const owner = liveOwners.get(tabId);
    if (!owner || result?.sessionId !== owner.sessionId || result.epoch < owner.epoch) return false;
    owner.epoch = result.epoch;
    return true;
  }
  const LIVE_BADGES: Record<string, [string, string]> = {
    idle: ['', '#000000'],
    connecting: ['…', '#5f6368'],
    active: ['LIVE', '#16833b'],
    paused: ['⏸', '#f59e0b'],
    stopping: ['…', '#5f6368'],
    error: ['ERR', '#b3261e'],
  };

  async function setLiveState(tabId: number, state: LiveState): Promise<void> {
    if (state === 'idle') liveTabs.delete(tabId);
    else liveTabs.set(tabId, state);
    const [text, color] = LIVE_BADGES[state] || ['', '#000000'];
    await Promise.all([
      chrome.action.setBadgeText({ tabId, text }).catch(() => {}),
      chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {}),
    ]);
  }

  function sendLiveUi(tabId: number, payload: LiveUiPayload): Promise<void> {
    if (!Number.isInteger(tabId)) return Promise.resolve();
    return chrome.tabs
      .sendMessage(tabId, { type: 'live-ui', ...payload }, { frameId: 0 })
      .catch(() => {});
  }

  function isYouTubeTab(tab?: chrome.tabs.Tab): boolean {
    try {
      const url = new URL(tab?.url || '');
      return (
        ['http:', 'https:'].includes(url.protocol) && /(^|\.)youtube\.com$/i.test(url.hostname)
      );
    } catch {
      return false;
    }
  }

  async function liveOffscreen(message: any, create = true): Promise<any> {
    const exists = await ensureOffscreen(create);
    if (!exists) return null;
    const result = await chrome.runtime.sendMessage({
      ...message,
      target: 'live-offscreen',
    });
    if (result?.error || result?.ok === false) {
      throw new Error(result.error || 'Live Translate không khởi động được.');
    }
    return result;
  }

  async function currentLiveSession(): Promise<any> {
    const session = await liveOffscreen({ type: 'state' }, false).catch(() => null);
    if (
      !Number.isInteger(session?.tabId) ||
      !['connecting', 'active', 'paused'].includes(session.state)
    ) {
      return null;
    }
    liveTabs.set(session.tabId, session.state);
    if (session.sessionId)
      liveOwners.set(session.tabId, {
        sessionId: session.sessionId,
        epoch: session.epoch,
      });
    return session;
  }

  async function failLive(tabId: number, error: any): Promise<void> {
    LTLog('live.failed', { tabId, error: error?.name || 'Error' }, 'error');
    await setLiveState(tabId, 'error');
    await sendLiveUi(tabId, {
      phase: 'error',
      code: error?.code || error?.message || error?.name || 'LiveAPIError',
    });
    const result = await liveOffscreen({ type: 'stop', tabId }, false).catch(() => null);
    if (result?.stopped === false && Number.isInteger(result.tabId) && result.tabId !== tabId) {
      return;
    }
    await closeLiveOffscreen().catch(() => {});
  }

  async function stopLive(tabId: number, preserveError = false): Promise<void> {
    if (!Number.isInteger(tabId)) return;
    if (!preserveError) await setLiveState(tabId, 'stopping');
    if (!preserveError) await sendLiveUi(tabId, { phase: 'stopping' });
    try {
      const result = await liveOffscreen({ type: 'stop', tabId }, false);
      if (result?.stopped === false && Number.isInteger(result.tabId) && result.tabId !== tabId) {
        if (!preserveError) {
          await setLiveState(tabId, 'idle');
          await sendLiveUi(tabId, { phase: 'stopped' });
        }
        return;
      }
    } catch (error: any) {
      LTLog('live.stop-failed', { tabId, error: error?.name || 'Error' }, 'error');
    }
    await closeLiveOffscreen().catch(() => {});
    if (!preserveError) {
      await setLiveState(tabId, 'idle');
      liveOwners.delete(tabId);
      await sendLiveUi(tabId, { phase: 'stopped' });
    }
  }

  async function startLive(tab: chrome.tabs.Tab): Promise<void> {
    const tabId = tab?.id;
    if (!Number.isInteger(tabId) || !isYouTubeTab(tab)) {
      if (Number.isInteger(tabId)) {
        await setLiveState(tabId!, 'error');
        await sendLiveUi(tabId!, { phase: 'error', code: 'UnsupportedTab' });
      }
      return;
    }
    for (const [otherTabId, state] of [...liveTabs]) {
      if (otherTabId !== tabId && ['connecting', 'active', 'paused', 'stopping'].includes(state)) {
        await stopLive(otherTabId);
      }
    }
    await setLiveState(tabId!, nextLiveState(liveTabs.get(tabId!) || 'idle', 'click'));
    const sessionId = crypto.randomUUID();
    const startedAt = performance.now();
    const timing = (stage: string) => LTLog('live.start.timing', {
      tabId, sessionId, stage, elapsedMs: Math.round(performance.now() - startedAt),
    });
    timing('requested');
    liveOwners.set(tabId!, { sessionId, epoch: 0 });
    try {
      await sendLiveUi(tabId!, { phase: 'connecting' });
      await chrome.tabs
        .sendMessage(tabId!, { type: 'live-hold' }, { frameId: 0 })
        .catch(() => null);
      await provider.initialize();
      const tabs = await chrome.tabs.query({});
      await Promise.all(
        tabs.map((item) =>
          Number.isInteger(item.id)
            ? chrome.tabs.sendMessage(item.id!, { type: 'stop-video' }).catch(() => {})
            : null,
        ),
      );
      await offscreen({ type: 'stop', owner: { tabId } }, false).catch(() => {});
      await prepareLiveOffscreen();
      timing('offscreen-ready');
      if (liveTabs.get(tabId!) !== 'connecting') {
        await closeLiveOffscreen().catch(() => {});
        return;
      }
      const streamId = await (chrome.tabCapture as any).getMediaStreamId({
        targetTabId: tabId,
      });
      timing('capture-id-ready');
      if (liveTabs.get(tabId!) !== 'connecting') return;
      await liveOffscreen({
        type: 'start',
        tabId,
        streamId,
        sessionId,
        ...(await provider.liveConfig()),
      });
    } catch (error) {
      await failLive(tabId!, error);
    }
  }

  async function toggleLive(tab?: chrome.tabs.Tab): Promise<void> {
    const session = await currentLiveSession();
    if (session && session.tabId !== tab?.id) await stopLive(session.tabId);
    const state = (tab?.id && liveTabs.get(tab.id)) || 'idle';
    if (state === 'idle' || state === 'error') {
      if (tab) return startLive(tab);
      return;
    }
    if (tab?.id) return stopLive(tab.id);
  }

  async function stopLiveIfOwned(tabId: number): Promise<void> {
    const session = await currentLiveSession();
    if (session?.tabId === tabId) await stopLive(tabId);
    else if (
      !session &&
      ['connecting', 'active', 'paused', 'stopping'].includes(liveTabs.get(tabId) || '')
    ) {
      await stopLive(tabId);
    }
  }

  async function stopCurrentLive(): Promise<void> {
    const session = await currentLiveSession();
    if (session) await stopLive(session.tabId);
  }

  async function youtubeCaptions(): Promise<any> {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return null;
    const player = document.querySelector('#movie_player') as any;
    const response = player?.getPlayerResponse?.() || (window as any).ytInitialPlayerResponse;
    const currentId = new URL(location.href).searchParams.get('v');
    if (currentId && response?.videoDetails?.videoId !== currentId) return null;
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const track =
      tracks.find((t: any) => t.languageCode === 'en' && t.kind !== 'asr') ||
      tracks.find((t: any) => t.languageCode?.startsWith('en'));
    if (!track) return null;
    const url = new URL(track.baseUrl);
    if (
      !/(^|\.)youtube\.com$/.test(url.hostname) ||
      url.pathname !== '/api/timedtext' ||
      url.protocol !== 'https:'
    ) {
      return null;
    }
    url.searchParams.set('fmt', 'json3');
    try {
      const resp = await fetch(url.href, {
        credentials: 'include',
        signal: AbortSignal.timeout(12000),
      });
      if (!resp.ok) return null;
      const text = await resp.text();
      if (text.length > 8_000_000) return null;
      return { caption: JSON.parse(text), autoGenerated: track.kind === 'asr' };
    } catch {
      return null;
    }
  }

  async function dispatch(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
    if (message.type === 'live-event') {
      if (sender.tab || sender.url !== chrome.runtime.getURL(OFFSCREEN)) {
        return null;
      }
      let tabId = Number.isInteger(message.tabId) ? message.tabId : null;
      if (tabId === null) {
        const candidates = [...liveTabs]
          .filter(([, state]) => ['connecting', 'active', 'paused', 'stopping'].includes(state))
          .map(([id]) => id);
        if (candidates.length === 1) tabId = candidates[0];
      }
      if (tabId === null) return null;
      if (!liveOwners.has(tabId)) await currentLiveSession();
      if (!acceptLiveResult(tabId, message)) return null;
      const state = liveTabs.get(tabId) || 'idle';
      if (message.event === 'paused' && ['connecting', 'active', 'paused'].includes(state)) {
        await setLiveState(tabId, 'paused');
        await sendLiveUi(tabId, { phase: 'paused' });
      } else if (message.event === 'ready' && ['connecting', 'paused', 'active'].includes(state)) {
        await setLiveState(tabId, 'active');
        await sendLiveUi(tabId, { phase: 'active' });
      } else if (message.event === 'ready' && state === 'idle') {
        await setLiveState(tabId, 'active');
        await sendLiveUi(tabId, { phase: 'active' });
      } else if (
        message.event === 'reconnecting' &&
        ['connecting', 'active', 'paused'].includes(state)
      ) {
        await setLiveState(tabId, 'connecting');
        await sendLiveUi(tabId, {
          phase: 'reconnecting',
          attempt: message.attempt,
        });
      } else if (message.event === 'transcript' && state === 'active') {
        await sendLiveUi(tabId, {
          phase: 'transcript',
          original: message.original,
          translation: message.translation,
          complete: message.complete === true,
        });
      } else if (message.event === 'error') {
        const error = new Error(message.code || message.error || 'LiveAPIError');
        error.name = message.code || 'LiveAPIError';
        await failLive(tabId, error);
      } else if (message.event === 'stopped' && state !== 'error') {
        await setLiveState(tabId, 'idle');
        await sendLiveUi(tabId, { phase: 'stopped' });
      }
      return null;
    }

    if (provider.customMessages?.includes(message.type)) {
      if (message.type === 'settings-save') {
        await stopCurrentLive();
        await closeLiveOffscreen().catch(() => {});
      }
      return provider.customDispatch?.(message, sender);
    }
    if (message.type === 'health') return api('/health');
    if (message.type === 'requests-cancel') {
      if (sender.tab?.id)
        provider.cancelOwner?.({
          tabId: sender.tab.id,
          frameId: sender.frameId,
          scope: ['page', 'video'].includes(message.scope) ? message.scope : undefined,
        });
      return null;
    }

    if (message.type === 'live-toggle') {
      if (sender.tab) await toggleLive(sender.tab);
      return null;
    }

    if (message.type === 'live-stop') {
      if (sender.tab?.id) await stopLiveIfOwned(sender.tab.id);
      return null;
    }

    if (message.type === 'live-pause') {
      if (sender.tab?.id) {
        const result = await liveOffscreen({ type: 'pause', tabId: sender.tab.id }, false).catch(
          () => {},
        );
        if (!acceptLiveResult(sender.tab.id, result)) return null;
        await setLiveState(sender.tab.id, 'paused');
        await sendLiveUi(sender.tab.id, { phase: 'paused' });
      }
      return null;
    }

    if (message.type === 'live-resume') {
      if (sender.tab?.id) {
        const result = await liveOffscreen({ type: 'resume', tabId: sender.tab.id }, false).catch(
          () => {},
        );
        if (!acceptLiveResult(sender.tab.id, result)) return null;
        await setLiveState(sender.tab.id, 'connecting');
        await sendLiveUi(sender.tab.id, { phase: 'reconnecting' });
      }
      return null;
    }

    if (message.type === 'live-seek') {
      if (sender.tab?.id) {
        const result = await liveOffscreen(
          {
            type: 'seek',
            tabId: sender.tab.id,
            complete: message.complete,
            paused: message.paused,
          },
          false,
        ).catch(() => {});
        if (!acceptLiveResult(sender.tab.id, result)) return null;
        await setLiveState(
          sender.tab.id,
          message.complete && !message.paused ? 'connecting' : 'paused',
        );
        await sendLiveUi(sender.tab.id, {
          phase: message.complete && !message.paused ? 'reconnecting' : 'paused',
        });
      }
      return null;
    }

    if (message.type === 'translate') {
      return api(
        '/translate',
        {
          texts: message.texts,
          source: 'en',
          target: 'vi',
        },
        undefined,
        sender.tab?.id
          ? {
              tabId: sender.tab.id,
              frameId: sender.frameId,
              scope: message.scope === 'page' ? 'page' : 'video',
            }
          : undefined,
      );
    }

    if (message.type === 'dubbing-segment') {
      if (!sender.tab?.id) throw new Error('Dịch theo đoạn cần một tab video.');
      const entry = { tabId: sender.tab.id, controller: new AbortController() };
      if (message.jobId) dubbingRequests.set(message.jobId, entry);
      try {
        return await api(
          '/dubbing/segment',
          { video_id: message.videoId, index: message.index, job_id: message.jobId },
          entry.controller.signal,
        );
      } catch (error) {
        if (entry.controller.signal.aborted) return null;
        throw error;
      } finally {
        if (dubbingRequests.get(message.jobId) === entry) dubbingRequests.delete(message.jobId);
      }
    }
    if (message.type === 'dubbing-cancel') {
      const entry = dubbingRequests.get(message.jobId);
      if (!sender.tab?.id || entry?.tabId !== sender.tab.id) return null;
      entry.controller.abort();
      return api('/dubbing/cancel', { job_id: message.jobId });
    }
    if (message.type === 'dubbing-status') {
      if (!sender.tab?.id) throw new Error('Dịch theo đoạn cần một tab video.');
      return api('/dubbing/status/' + encodeURIComponent(message.jobId));
    }

    if (message.type === 'caption-polish') {
      return api(
        '/captions/polish',
        {
          cues: message.cues,
          window_key: message.windowKey,
        },
        undefined,
        sender.tab?.id
          ? { tabId: sender.tab.id, frameId: sender.frameId, scope: 'video' }
          : undefined,
      );
    }

    if (SPEECH[message.type]) {
      if (!sender.tab?.id) return null;
      if (!['speech-stop', 'speech-state'].includes(message.type) && (await currentLiveSession())) {
        throw new Error(
          'Gemini Live Translate đang chạy; hãy tắt Live trước khi dùng giọng phụ đề.',
        );
      }
      const owner: FrameOwner = {
        tabId: sender.tab.id,
        frameId: sender.frameId,
      };
      const create = !['speech-stop', 'speech-state'].includes(message.type);
      return offscreen(
        {
          ...message,
          type: SPEECH[message.type],
          owner,
          ...(await provider.speechConfig()),
        },
        create,
      );
    }

    if (message.type === 'speech-event') {
      if (sender.tab || sender.url !== chrome.runtime.getURL(OFFSCREEN)) {
        return null;
      }
      const { owner, id, event, error } = message;
      await chrome.tabs
        .sendMessage(
          owner.tabId,
          { type: 'speech-event', id, event, error },
          { frameId: owner.frameId },
        )
        .catch(() => {});
      return null;
    }

    if (message.type === 'videojs') {
      if (!sender.tab?.id || !Number.isInteger(message.index) || message.index < 0) {
        return null;
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] },
        world: 'MAIN',
        func: readVideoJsCaptions,
        args: [{ index: message.index, elementId: message.elementId }],
      });
      return results[0]?.result;
    }

    if (message.type === 'youtube') {
      if (!sender.tab?.id) return null;
      const results = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] },
        world: 'MAIN',
        func: youtubeCaptions,
      });
      return results[0]?.result;
    }

    if (message.type === 'scan') {
      const frames = await chrome.webNavigation.getAllFrames({
        tabId: message.tabId,
      });
      const results = await Promise.all(
        (frames || []).map(async (frame) => {
          try {
            const data = await chrome.tabs.sendMessage(
              message.tabId,
              { type: 'inspect' },
              { frameId: frame.frameId },
            );
            return { ...data, frameId: frame.frameId };
          } catch (error: any) {
            LTLog('scan.frame-unavailable', {
              frameId: frame.frameId,
              error: error.message,
            });
            return null;
          }
        }),
      );
      LTLog('scan.complete', {
        frames: frames?.length || 0,
        reachable: results.filter(Boolean).length,
        videos: results.reduce((n, frame) => n + (frame?.videos?.length || 0), 0),
      });
      return results.filter(Boolean);
    }

    if (message.type === 'command') {
      LTLog('command.dispatch', {
        type: message.command?.type,
        frameId: message.frameId || 0,
        videoId: message.command?.videoId,
      });
      if (['start-video', 'stop'].includes(message.command?.type))
        await liveOperation(() => stopCurrentLive());
      return chrome.tabs.sendMessage(message.tabId, message.command, {
        frameId: message.frameId || 0,
      });
    }

    throw new Error('Unknown action');
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.target) return false;
    const trusted = sender.url?.startsWith(chrome.runtime.getURL(''));
    if (
      !trusted &&
      ['scan', 'command', 'settings-save', 'settings-secret', 'gemini-validate'].includes(
        message.type,
      )
    )
      return false;
    const result =
      message.type?.startsWith('live-') || message.type === 'settings-save'
        ? liveOperation(() => dispatch(message, sender))
        : dispatch(message, sender);
    result
      .then((data) => reply({ ok: true, data }))
      .catch((error) => {
        LTLog('dispatch.failed', {
          type: message.type,
          frameId: sender.frameId,
          error: error.message,
        });
        reply({ ok: false, error: error.message });
      });
    return true;
  });

  chrome.action.onClicked.addListener((tab) =>
    liveOperation(() => toggleLive(tab)).catch((error) => {
      if (Number.isInteger(tab?.id)) failLive(tab.id!, error).catch(() => {});
    }),
  );

  chrome.tabs.onRemoved.addListener((tabId) => {
    provider.cancelOwner?.({ tabId });
    offscreen({ type: 'stop', owner: { tabId } }, false).catch(() => {});
    liveOperation(() => stopLiveIfOwned(tabId)).catch(() => {});
  });

  chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
    provider.cancelOwner?.(frameId === 0 ? { tabId } : { tabId, frameId });
    offscreen({ type: 'stop', owner: frameId === 0 ? { tabId } : { tabId, frameId } }, false).catch(
      () => {},
    );
    if (frameId === 0) liveOperation(() => stopLiveIfOwned(tabId)).catch(() => {});
  });
}
