import { createSpeechHandlers } from '../../../src/shared/speech-player';
import { identity, synthesize } from '../../core/speech-rpc';
import { liveHandlers } from './live-coordinator';

const speechHandlers = createSpeechHandlers({
  identity,
  synthesize: (text, _voice, signal) => synthesize(text, signal),
  maxCacheBytes: 32 * 1024 * 1024,
  prefetchLimit: 2,
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')))
    return false;
  const handlers =
    message.target === 'offscreen'
      ? speechHandlers
      : message.target === 'live-offscreen'
        ? liveHandlers
        : null;
  if (!handlers || !Object.hasOwn(handlers, message.type)) return false;
  Promise.resolve()
    .then(() => (handlers as any)[message.type](message))
    .then(reply, (error) =>
      reply({ ok: false, error: error.message || 'Không xử lý được audio.', code: error.code }),
    );
  return true;
});
