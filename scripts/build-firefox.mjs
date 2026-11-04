// Firefox runs background scripts instead of a service worker, and Chrome reports the Firefox form
// as an error, so extension/ stays Chrome's and this copies it to dist/firefox with the difference.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const firefoxManifest = chromeManifest => {
  const { minimum_chrome_version: _chromeOnly, ...manifest } = chromeManifest;
  return { ...manifest, background: { scripts: [chromeManifest.background.service_worker] } };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(ROOT, 'dist', 'firefox');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'extension'), out, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(firefoxManifest(manifest), null, 2)}\n`);
  console.log(`built ${out}`);
}
