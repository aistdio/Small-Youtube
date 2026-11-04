// Runs the real extension in logged-out test browsers. `E2E_ONLY=chromium-en npm run e2e` runs one setup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

let failed = 0;
for (const setup of chosen) {
  const browser = await launch(setup);
  const errors = watchExtensionErrors(browser.page);
  try {
    const watch = await checkWatchColumn(browser.page, setup);
    await checkLateCardsDropped(browser.page);
    await checkEmptyHome(browser.page);
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
