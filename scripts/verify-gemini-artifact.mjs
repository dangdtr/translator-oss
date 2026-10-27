import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyArtifact(directory) {
  const root = directory instanceof URL ? fileURLToPath(directory) : resolve(directory);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3 || !manifest.name.startsWith('Gemini Translator')) {
    throw new Error('Invalid Gemini manifest');
  }
  for (const file of [
    'background.js',
    'popup.html',
    'offscreen.html',
    'content-scripts/content.js',
  ]) {
    await readFile(join(root, file));
  }
  const forbidden = /local-config|127\.0\.0\.1|localhost|\.\/start\.sh|ctranslate2|\.argosmodel/i;
  if (forbidden.test(JSON.stringify(manifest))) throw new Error('Local runtime in manifest');
  let bytes = 0;
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      if (entry.isSymbolicLink() || /local-config|\.(bin|onnx|argosmodel|py)$/i.test(entry.name)) {
        throw new Error(`Forbidden artifact: ${entry.name}`);
      }
      const content = await readFile(file);
      bytes += content.byteLength;
      if (/\.(js|html|json)$/.test(entry.name) && forbidden.test(content.toString())) {
        throw new Error(`Local runtime in ${entry.name}`);
      }
    }
  }
  await visit(root);
  return { bytes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyArtifact(process.argv[2] ?? '.output/gemini/chrome-mv3');
  console.log(`Gemini artifact verified (${result.bytes} bytes; no local runtime).`);
}
