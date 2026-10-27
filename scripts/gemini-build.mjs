import { copyFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyArtifact } from './verify-gemini-artifact.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const command = process.argv[2];
if (!['build', 'zip'].includes(command)) throw new Error('Usage: gemini-build.mjs build|zip');
await mkdir(new URL('../.wxt/gemini-public/', import.meta.url), { recursive: true });
for (const asset of [
  'logo.svg',
  'icon16.png',
  'icon32.png',
  'icon48.png',
  'icon128.png',
  'live-capture-worklet.js',
]) {
  await copyFile(
    new URL(`../public/${asset}`, import.meta.url),
    new URL(`../.wxt/gemini-public/${asset}`, import.meta.url),
  );
}
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/wxt/bin/wxt.mjs', import.meta.url)),
    command,
    '--config',
    'wxt.gemini.config.ts',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await verifyArtifact(new URL('../.output/gemini/chrome-mv3/', import.meta.url));
