import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  hooks: {
    'vite:devServer:extendConfig'(config) {
      config.server ??= {};
      config.server.watch ??= {};
      const ignored = config.server.watch.ignored;
      config.server.watch.ignored = [
        ...(Array.isArray(ignored) ? ignored : ignored ? [ignored] : []),
        '**/.cache/**',
        '**/.venv/**',
        '**/.venv-*/**',
        '**/venv/**',
        '**/models/**',
      ];
    },
  },
  manifest: {
    name: 'Translator • Song ngữ & Thuyết minh',
    version: '0.4.0',
    description: 'Dịch trang song ngữ, phụ đề và đọc thuyết minh tiếng Việt bằng Local AI hoặc Gemini API.',
    permissions: ['activeTab', 'scripting', 'storage', 'webNavigation', 'offscreen', 'tabCapture'],
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: {
      16: 'icon16.png',
      32: 'icon32.png',
      48: 'icon48.png',
      128: 'icon128.png',
    },
    action: {
      default_title: 'Translator • Cài đặt',
      default_popup: 'popup.html',
      default_icon: {
        16: 'icon16.png',
        32: 'icon32.png',
        48: 'icon48.png',
        128: 'icon128.png',
      },
    },
    web_accessible_resources: [
      {
        resources: ['logo.svg', 'live-capture-worklet.js', 'local-config.json', 'local-config.js'],
        matches: ['https://*.youtube.com/*', 'http://*.youtube.com/*'],
      },
    ],
  },
});
