import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('artifact verifier rejects missing entrypoints, local config and localhost transport', async () => {
  const { verifyArtifact } = await import('../scripts/verify-gemini-artifact.mjs');
  const root = await mkdtemp(join(tmpdir(), 'gemini-artifact-'));
  try {
    await assert.rejects(verifyArtifact(root));
    await writeFile(
      join(root, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: 'Gemini Translator • Việt' }),
    );
    await assert.rejects(verifyArtifact(root));
    await mkdir(join(root, 'content-scripts'));
    for (const name of [
      'background.js',
      'popup.html',
      'offscreen.html',
      'content-scripts/content.js',
    ])
      await writeFile(join(root, name), 'safe');
    assert.ok((await verifyArtifact(root)).bytes > 0);
    await writeFile(join(root, 'local-config.json'), '{}');
    await assert.rejects(verifyArtifact(root), /Forbidden artifact/);
    await rm(join(root, 'local-config.json'));
    await writeFile(join(root, 'background.js'), 'fetch("http://127.0.0.1:8765/translate")');
    await assert.rejects(verifyArtifact(root), /Local runtime/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
