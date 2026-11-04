// Starts a throwaway browser profile, by default with the unpacked extension loaded.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXTENSION_DIR = path.join(ROOT, 'extension');
export const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export async function launch({
  channel = 'chromium',
  locale = 'en-US',
  viewport = { width: 1280, height: 900 },
  extension = true,
  userDataDir = null,
} = {}) {
  const dir = userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'small-yt-'));
  const args = ['--mute-audio'];
  if (extension) args.push(`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`);
  const ctx = await chromium.launchPersistentContext(dir, { channel, headless: true, locale, viewport, args });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const close = async () => {
    await ctx.close().catch(() => {});
    if (!userDataDir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  };
  return { ctx, page, close };
}
