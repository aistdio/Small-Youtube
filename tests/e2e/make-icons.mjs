// Draws the toolbar icon: a tiny feed with one small-channel card lit up, like the popup's preview.
import fs from 'node:fs';
import path from 'node:path';
import { EXTENSION_DIR, launch } from './harness.mjs';

const OUT = path.join(EXTENSION_DIR, 'icons');
fs.mkdirSync(OUT, { recursive: true });

const svg = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16">
  <rect x="1" y="2.5" width="6.5" height="5" rx="1" fill="#6b7280"/>
  <rect x="8.5" y="2.5" width="6.5" height="5" rx="1" fill="#6b7280"/>
  <rect x="1" y="8.5" width="6.5" height="5" rx="1" fill="#6b7280"/>
  <rect x="8.5" y="8.5" width="6.5" height="5" rx="1" fill="#e0a100"/>
</svg>`;

const { page, close } = await launch({ extension: false, viewport: { width: 256, height: 256 } });
for (const size of [16, 32, 48, 128]) {
  await page.setContent(`<!doctype html><html style="background:transparent"><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
  await page.locator('svg').screenshot({ path: path.join(OUT, `icon${size}.png`), omitBackground: true });
}
await close();
