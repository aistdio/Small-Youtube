import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const sourceFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return sourceFiles(full);
  return /\.(js|html)$/.test(entry.name) ? [full] : [];
});

test('source never touches login cookies', () => {
  const files = sourceFiles(path.join(ROOT, 'extension'));
  assert.ok(files.length > 0);
  for (const file of files) assert.ok(!fs.readFileSync(file, 'utf8').includes('document.cookie'), file);
});
