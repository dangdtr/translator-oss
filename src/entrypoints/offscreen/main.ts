import { speechHandlers } from './speech-player';
import { liveHandlers } from './live-coordinator';
import { LTLog } from '../../core/logger';

chrome.runtime.onMessage.addListener(
  (
    message: any,
    sender: chrome.runtime.MessageSender,
    reply: (response?: any) => void,
  ) => {
  if (sender.tab) return false;

  if (message?.target === 'offscreen') {
    const handler = (speechHandlers as any)[message.type];
    if (!handler) return false;
    Promise.resolve()
      .then(() => handler(message))
      .then(reply, error => {
        LTLog('offscreen.failed', { type: message.type, error: error.message }, 'error');
        reply({ ok: false, error: error.message });
      });
    return true;
  }

  if (message?.target === 'live-offscreen') {
    const handler = (liveHandlers as any)[message.type];
    if (!handler) return false;
    Promise.resolve()
      .then(() => handler(message))
      .then(reply, error => {
        reply({ ok: false, state: 'idle', error: error?.name || error?.code || 'LiveError' });
      });
    return true;
  }

  return false;
});
