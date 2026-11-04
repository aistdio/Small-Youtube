// Runs the real extension in logged-out test browsers. `E2E_ONLY=chromium-en npm run e2e` runs one setup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EDGE_PATH, launch } from './harness.mjs';

const CARD_TIMEOUT = Number(process.env.E2E_TIMEOUT ?? 90000);
const WATCH_URL = 'https://www.youtube.com/watch?v=IWbeDRbK-wk';
const SMALL = '[data-small-yt]';

// Logged out, YouTube dubs by browser language, so non-English setups may legitimately find few cards.
const setups = [
  { name: 'chromium-en', channel: 'chromium', locale: 'en-US', viewport: { width: 1280, height: 900 }, expectCards: true },
  { name: 'chromium-de-wide', channel: 'chromium', locale: 'de-DE', viewport: { width: 1920, height: 1080 }, expectCards: false },
  { name: 'chromium-ar-narrow', channel: 'chromium', locale: 'ar-EG', viewport: { width: 900, height: 800 }, expectCards: false },
];
if (fs.existsSync(EDGE_PATH)) setups.push({ name: 'edge-en', channel: 'msedge', locale: 'en-US', viewport: { width: 1280, height: 900 }, expectCards: true });
const chosen = process.env.E2E_ONLY ? setups.filter(s => s.name === process.env.E2E_ONLY) : setups;

const watchExtensionErrors = page => {
  const errors = [];
  page.on('pageerror', err => { if (/small-yt|SmallYT|chrome-extension:/.test(String(err.stack ?? err))) errors.push(String(err).slice(0, 200)); });
  page.on('console', m => { if (m.type() === 'error' && (m.location().url ?? '').startsWith('chrome-extension:')) errors.push(m.text().slice(0, 200)); });
  return errors;
};

const waitForCards = async (page, required) => {
  try {
    await page.waitForFunction(s => document.querySelectorAll(s).length >= 1, SMALL, { timeout: CARD_TIMEOUT });
    return true;
  } catch (err) {
    if (required) throw new Error(`no small cards within ${CARD_TIMEOUT} ms`);
    return false;
  }
};

const checkWatchColumn = async (page, setup) => {
  await page.goto(WATCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('ytd-watch-next-secondary-results-renderer yt-lockup-view-model', { timeout: 30000 });
  const before = await page.locator('ytd-watch-next-secondary-results-renderer yt-lockup-view-model:not([data-small-yt])').count();
  const found = await waitForCards(page, setup.expectCards);
  if (!found) return 'no cards (allowed here)';
  await page.waitForTimeout(1500);
  const report = await page.evaluate(s => {
    const card = document.querySelector(s);
    const neighbour = [...card.parentElement.children].find(el => el.tagName === card.tagName && !el.hasAttribute('data-small-yt'));
    return {
      cardWidth: Math.round(card.getBoundingClientRect().width),
      neighbourWidth: Math.round(neighbour.getBoundingClientRect().width),
      youTubeCards: document.querySelectorAll('ytd-watch-next-secondary-results-renderer yt-lockup-view-model:not([data-small-yt])').length,
      title: card.querySelector('h3')?.textContent?.trim(),
      opacity: getComputedStyle(card).opacity,
    };
  }, SMALL);
  assert.equal(report.cardWidth, report.neighbourWidth, 'same width as neighbour');
  assert.ok(report.youTubeCards >= before, 'YouTube cards stay');
  assert.ok(report.title, 'card has a title');
  assert.equal(report.opacity, '1', 'card faded in');

  await page.evaluate(() => { window.__smallYtMarker = 'same-page'; });
  const link = page.locator(`${SMALL} a[href*="/watch"]`).first();
  const href = await link.getAttribute('href');
  const expected = new URL(href, 'https://www.youtube.com').searchParams.get('v');
  await link.click({ timeout: 15000 });
  await page.waitForFunction(id => location.search.includes(id), expected, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__smallYtMarker), 'same-page', 'opens without a full reload');
  return 'ok';
};

const checkLateCardsDropped = async page => {
  await page.goto(WATCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('ytd-watch-next-secondary-results-renderer yt-lockup-view-model a[href*="/watch"]', { timeout: 30000 });
  await page.waitForTimeout(1500); // cards are now being looked up for this video
  await page.locator('ytd-watch-next-secondary-results-renderer yt-lockup-view-model a[href*="/watch"]').first().click({ timeout: 15000 });
  await page.waitForTimeout(12000);
  const stale = await page.evaluate(() => {
    const current = document.documentElement.getAttribute('data-small-yt-page');
    return [...document.querySelectorAll('[data-small-yt]')].filter(el => el.getAttribute('data-small-yt') !== current).length;
  });
  assert.equal(stale, 0, 'no card from the previous page');
};

const checkEmptyHome = async page => {
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const { items, small } = await page.evaluate(s => ({
    items: document.querySelectorAll('ytd-rich-item-renderer').length,
    small: document.querySelectorAll(s).length,
  }), SMALL);
  if (items === 0) assert.equal(small, 0, 'nothing added to an empty home feed');
};

const extensionId = async ctx => {
  const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
  return new URL(worker.url()).host;
};

const checkPopup = async (ctx, setup) => {
  const id = await extensionId(ctx);
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 800 });
  await popup.goto(`chrome-extension://${id}/popup/popup.html`);
  await popup.waitForFunction(() => document.getElementById('share-value').value !== '');
  const value = sel => popup.locator(sel).inputValue();
  const stored = () => popup.evaluate(async () => (await chrome.storage.local.get('settings')).settings ?? {});

  assert.equal(await value('#share-value'), '25%');
  assert.equal(await value('#subs-min'), '10');
  assert.equal(await value('#subs-max'), '10k');
  assert.equal(await value('#views-min'), '0');
  assert.equal(await popup.locator('.tile.small').count(), 3, 'the preview shows 25%');
  assert.equal(await popup.locator('.tile').count(), 12);

  await popup.locator('#subs-max').fill('5000');
  await popup.locator('#subs-max').blur();
  assert.equal((await stored()).subsMax, 5000);
  const pos = Number(await value('#subs-max-slider'));
  assert.ok(pos > 0.6 && pos < 0.8, 'the handle sits between stops');
  assert.equal(await value('#subs-max'), '5k');

  await popup.locator('#subs-max').fill('abc');
  await popup.locator('#subs-max').blur();
  assert.equal(await value('#subs-max'), '5k', 'garbage restores the previous value');
  assert.equal((await stored()).subsMax, 5000);

  await popup.locator('#subs-min').fill('9000');
  await popup.locator('#subs-min').blur();
  assert.equal((await stored()).subsMin ?? 10, 10, 'minimum can not pass maximum');

  await popup.locator('#share-value').fill('40');
  await popup.locator('#share-value').blur();
  assert.equal((await stored()).share, 40);
  assert.equal(await value('#share-value'), '40%');

  await popup.locator('#share-slider').focus();
  await popup.keyboard.press('ArrowRight');
  assert.equal((await stored()).share, 50, 'arrow keys move to the next stop');

  await popup.locator('#add-language').selectOption('fi');
  assert.ok((await stored()).languages.includes('fi'));
  assert.equal((await stored()).languagesEdited, true);
  while ((await popup.locator('#languages li').count()) > 1) await popup.locator('#languages li button').first().click();
  assert.equal(await popup.locator('#languages li button').first().isDisabled(), true, 'the last language stays');

  await popup.locator('#power').click();
  assert.equal((await stored()).enabled, false);
  assert.equal(await popup.locator('#power').getAttribute('aria-pressed'), 'false');
  await popup.locator('#power').click();
  assert.equal((await stored()).enabled, true);

  // A real popup starts with a tiny viewport and grows to fit the page, so the page must not depend on it.
  await popup.setViewportSize({ width: 200, height: 600 });
  assert.equal(await popup.evaluate(() => getComputedStyle(document.body).width), '360px', 'width does not follow the viewport');
  await popup.setViewportSize({ width: 360, height: 600 });
  assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no sideways scroll');
  const height = await popup.evaluate(() => document.documentElement.scrollHeight);
  assert.ok(height <= 600, `fits Chrome's 600 px popup limit, was ${height}`);
  assert.equal(await popup.locator('main > :last-child').getAttribute('id'), 'power', 'the on/off button is at the very bottom');
  if (process.env.E2E_SHOTS) {
    await popup.locator('#hidden-list').evaluate(d => { d.open = true; });
    await popup.setViewportSize({ width: 360, height: 760 });
    await popup.screenshot({ path: path.join(process.env.E2E_SHOTS, `${setup.name}-popup-light.png`) });
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.screenshot({ path: path.join(process.env.E2E_SHOTS, `${setup.name}-popup-dark.png`) });
  }
  await popup.evaluate(() => chrome.storage.local.remove('settings'));
  await popup.close();
};

const checkWelcome = async (ctx, setup) => {
  const id = await extensionId(ctx);
  const isWelcome = page => page.url().startsWith(`chrome-extension://${id}/welcome/`);
  const deadline = Date.now() + 5000;
  while (!ctx.pages().some(isWelcome) && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
  const welcome = ctx.pages().filter(isWelcome);
  assert.equal(welcome.length, 1, 'exactly one welcome tab on install');
  assert.ok((await welcome[0].locator('h1').first().textContent()).length > 0);
  if (process.env.E2E_SHOTS) await welcome[0].screenshot({ path: path.join(process.env.E2E_SHOTS, `${setup.name}-welcome.png`) });
  await welcome[0].close();
};

const checkNoWelcomeOnRestart = async setup => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'small-yt-restart-'));
  try {
    for (const run of [1, 2]) {
      const browser = await launch({ ...setup, userDataDir: dir });
      await new Promise(r => setTimeout(r, 2500));
      const count = browser.ctx.pages().filter(p => p.url().includes('/welcome/')).length;
      assert.equal(count, run === 1 ? 1 : 0, `welcome tabs on browser start ${run}`);
      // Closed first, so Chrome's session restore can't bring it back and hide a second install.
      for (const page of browser.ctx.pages().filter(p => p.url().includes('/welcome/'))) await page.close();
      await browser.close();
    }
  } finally {
    // Windows can hold a closed browser's profile for a while. It's only a temp folder, so that isn't a failure.
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch {
      console.log(`left temp profile behind: ${dir}`);
    }
  }
};

let failed = 0;
for (const setup of chosen) {
  const browser = await launch(setup);
  const errors = watchExtensionErrors(browser.page);
  try {
    await checkWelcome(browser.ctx, setup);
    await checkPopup(browser.ctx, setup);
    await checkNoWelcomeOnRestart(setup);
    const watch = process.env.E2E_UI_ONLY ? 'skipped' : await checkWatchColumn(browser.page, setup);
    if (!process.env.E2E_UI_ONLY) {
      await checkLateCardsDropped(browser.page);
      await checkEmptyHome(browser.page);
    }
    assert.deepEqual(errors, [], 'no extension errors');
    console.log(`PASS ${setup.name}: watch column ${watch}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${setup.name}: ${String(err.message ?? err).slice(0, 400)}`);
  } finally {
    await browser.close();
  }
}
console.log(failed ? `${failed} setup(s) failed` : `all ${chosen.length} setup(s) passed`);
process.exit(failed ? 1 : 0);
