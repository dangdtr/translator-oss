import { defineConfig } from 'wxt';
import { verifyArtifact } from './scripts/verify-gemini-artifact.mjs';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src-gemini',
  publicDir: '.wxt/gemini-public',
  outDir: '.output/gemini',
  zip: { zipSources: false, artifactTemplate: 'gemini-translator-{{version}}-{{browser}}.zip' },
  hooks: {
    'zip:extension:start': async wxt => { await verifyArtifact(wxt.config.outDir); },
  },
  manifest: {
    name: 'Gemini Translator • Việt',
    version: '0.1.0',
    minimum_chrome_version: '116',
    description: 'Dịch trang, phụ đề và âm thanh sang tiếng Việt bằng Gemini API.',
    permissions: ['activeTab', 'scripting', 'storage', 'webNavigation', 'offscreen', 'tabCapture'],
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: { 16: 'icon16.png', 32: 'icon32.png', 48: 'icon48.png', 128: 'icon128.png' },
    action: { default_popup: 'popup.html', default_title: 'Gemini Translator • Cài đặt' },
    web_accessible_resources: [
      {
        resources: ['logo.svg', 'live-capture-worklet.js'],
        matches: ['https://*.youtube.com/*', 'http://*.youtube.com/*'],
      },
    ],
  },
});
