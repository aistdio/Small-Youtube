import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const read = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));

test('manifest asks for the minimum', () => {
  const m = read();
  assert.deepEqual(m.permissions, ['storage']);
  assert.deepEqual(m.host_permissions, ['https://www.youtube.com/*']);
  assert.equal(m.manifest_version, 3);
});

test('every file the manifest lists exists', () => {
  const m = read();
  const files = m.content_scripts.flatMap(c => c.js);
  assert.ok(files.includes('src/youtube.js'));
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, 'extension', f)), f);
});

test('no file is listed twice, because Chrome only injects it once', () => {
  const files = read().content_scripts.flatMap(c => c.js);
  assert.equal(new Set(files).size, files.length);
});

test('the page script runs in the page world', () => {
  const m = read();
  assert.ok(m.content_scripts.some(c => c.world === 'MAIN'));
});
