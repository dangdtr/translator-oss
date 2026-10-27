export interface LocalConfig {
  url: string;
  token: string;
}

declare global {
  var LOCAL_CONFIG: LocalConfig | undefined;
}

let cachedConfig: LocalConfig | null = null;

export function setLocalConfig(config: LocalConfig): void {
  cachedConfig = config;
  globalThis.LOCAL_CONFIG = config;
}

export function getLocalConfig(): LocalConfig {
  if (cachedConfig?.token) {
    return cachedConfig;
  }
  if (typeof globalThis.LOCAL_CONFIG !== 'undefined' && globalThis.LOCAL_CONFIG?.url) {
    cachedConfig = globalThis.LOCAL_CONFIG;
    return globalThis.LOCAL_CONFIG;
  }
  return {
    url: 'http://127.0.0.1:8765',
    token: '',
  };
}

export async function ensureLocalConfig(): Promise<LocalConfig> {
  const current = getLocalConfig();
  if (current.token) return current;

  // 1. Try reading from chrome.storage.local
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = (await chrome.storage.local.get(['localConfig'])) as {
        localConfig?: LocalConfig;
      };
      if (stored?.localConfig?.token) {
        setLocalConfig(stored.localConfig);
        return stored.localConfig;
      }
    }
  } catch {}

  // 2. Try fetching local-config.json from extension root
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      const res = await fetch(chrome.runtime.getURL('local-config.json'));
      if (res.ok) {
        const data = await res.json();
        if (data?.token) {
          setLocalConfig(data);
          if (chrome.storage?.local) {
            await chrome.storage.local.set({ localConfig: data }).catch(() => {});
          }
          return data;
        }
      }
    }
  } catch {}

  return current;
}
