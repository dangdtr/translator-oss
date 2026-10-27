import * as localLive from './local-live-coordinator';
import * as geminiLive from './gemini-live-coordinator';

let activeCoordinator: 'local' | 'gemini' = 'local';

export async function start(message: any): Promise<any> {
  if (message?.websocketUrl || message?.mode === 'local') {
    activeCoordinator = 'local';
    return localLive.start(message);
  }
  activeCoordinator = 'gemini';
  return geminiLive.start(message);
}

export async function stop(message?: any): Promise<any> {
  if (activeCoordinator === 'gemini') {
    return geminiLive.stop(message);
  }
  return localLive.stop(message);
}

export async function pause(message?: any): Promise<any> {
  if (activeCoordinator === 'gemini') {
    return geminiLive.pause(message);
  }
  return localLive.pause(message);
}

export async function resume(message?: any): Promise<any> {
  if (activeCoordinator === 'gemini') {
    return geminiLive.resume(message);
  }
  return localLive.resume(message);
}

export function seek(message?: any): any {
  if (activeCoordinator === 'gemini') {
    return geminiLive.seek(message);
  }
  return localLive.seek(message);
}

export function state(): any {
  if (activeCoordinator === 'gemini') {
    return geminiLive.state();
  }
  return localLive.state();
}

export const liveHandlers = {
  start,
  stop,
  pause,
  resume,
  seek,
  state,
};
