const PREFIX = '[LocalTranslator] ';

export function LTLog(
  event: string,
  fields: Record<string, unknown> = {},
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  const payload = JSON.stringify({
    event,
    time: new Date().toISOString(),
    ...fields,
  });
  if (level === 'error') {
    console.error(PREFIX + payload);
  } else if (level === 'warn') {
    console.warn(PREFIX + payload);
  } else {
    console.log(PREFIX + payload);
  }
}

declare global {
  var LTLog: (
    event: string,
    fields?: Record<string, unknown>,
    level?: 'info' | 'warn' | 'error',
  ) => void;
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).LTLog = LTLog;
}
