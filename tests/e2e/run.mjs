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

// YouTube loading its next page of cards must not cost us ours, and must not stop it loading.
const SIDE_COLUMN_MIN_WIDTH = 1000; // narrower, the column sits under the video and may not load more, even with no extension
const checkCardsSurviveLoadingMore = async (page, setup) => {
  const state = () => page.evaluate(s => {
    const column = document.querySelector('ytd-watch-next-secondary-results-renderer');
    const shown = [...column.querySelectorAll(s)].map(el => el.querySelector('a[href*="/watch"]')?.getAttribute('href'));
    return {
      shown,
      youTubeCards: column.querySelectorAll('yt-lockup-view-model:not([data-small-yt])').length,
      reset: document.documentElement.getAttribute('data-small-yt-page'),
    };
  }, SMALL);
  const before = await state();
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => scrollBy(0, innerHeight));
    await page.waitForTimeout(1000);
    if ((await state()).youTubeCards > before.youTubeCards + 5) break;
  }
  const after = await state();
  if (setup.viewport.width >= SIDE_COLUMN_MIN_WIDTH) assert.ok(after.youTubeCards > before.youTubeCards + 5, 'YouTube keeps loading more cards');
  assert.equal(after.reset, before.reset, 'loading more does not reset the cards');
  for (const card of before.shown) assert.ok(after.shown.includes(card), 'each added card stays and keeps its video');
  await page.evaluate(() => scrollTo(0, 0));
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
    const neighbour = card.parentElement.closest('yt-lockup-view-model'); // the card it's nested in
    return {
      cardWidth: Math.round(card.getBoundingClientRect().width),
      neighbourWidth: Math.round(neighbour.getBoundingClientRect().width),
      cardHeight: Math.round(card.getBoundingClientRect().height),
      neighbourHeight: Math.round(neighbour.firstElementChild.getBoundingClientRect().height),
      cardGap: Math.round(card.getBoundingClientRect().top - neighbour.firstElementChild.getBoundingClientRect().bottom),
      neighbourMargin: parseInt(getComputedStyle(neighbour).marginTop, 10),
      youTubeCards: document.querySelectorAll('ytd-watch-next-secondary-results-renderer yt-lockup-view-model:not([data-small-yt])').length,
      title: card.querySelector('h3')?.textContent?.trim(),
      opacity: getComputedStyle(card).opacity,
      text: card.innerText,
    };
  }, SMALL);
  assert.match(report.text, /Small Creator/, 'the label shows on the card');
  assert.equal(report.cardWidth, report.neighbourWidth, 'same width as neighbour');
  // Heights differ a little with title length, but a card missing its layout values is more than twice as tall.
  assert.ok(Math.abs(report.cardHeight - report.neighbourHeight) <= report.neighbourHeight * 0.2, `about the same height as neighbour: ${report.cardHeight} vs ${report.neighbourHeight}`);
  assert.equal(report.cardGap, report.neighbourMargin, 'same gap as between real cards');
  assert.ok(report.youTubeCards >= before, 'YouTube cards stay');
  assert.ok(report.title, 'card has a title');
  assert.equal(report.opacity, '1', 'card faded in');
  await checkCardsSurviveLoadingMore(page, setup);

  await page.evaluate(() => { window.__smallYtMarker = 'same-page'; });
  const link = page.locator(`${SMALL} a[href*="/watch"]`).first();
  const href = await link.getAttribute('href');
  const expected = new URL(href, 'https://www.youtube.com').searchParams.get('v');
  await link.click({ timeout: 15000 });
  await page.waitForFunction(id => location.search.includes(id), expected, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__smallYtMarker), 'same-page', 'opens without a full reload');

  const sw = await worker(page.context());
  let watched = null;
  for (let i = 0; i < 20 && !watched?.videos?.length; i++) {
    await page.waitForTimeout(250);
    watched = (await sw.evaluate(() => chrome.storage.local.get('watched'))).watched;
  }
  assert.equal(watched?.count, 1, 'the click is counted');
  assert.equal(watched.videos[0].id, expected, 'the clicked video is listed');
  assert.ok(watched.videos[0].title && watched.videos[0].channelName, 'with its title and channel');
  return 'ok';
};

// Records when the page asks for a card, so a test can act while that request is really in flight.
const trackRequests = async page => {
  await page.addInitScript(() => {
    window.__smallYtAsked = 0;
    window.addEventListener('message', e => {
      if (e.data?.ns === 'small-yt' && e.data.type === 'needCard') window.__smallYtAsked++;
    });
  });
};
const waitForRequest = (page, timeout = 30000) => page.waitForFunction(() => window.__smallYtAsked > 0, null, { timeout });

const checkLateCardsDropped = async page => {
  await page.goto(WATCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('ytd-watch-next-secondary-results-renderer yt-lockup-view-model a[href*="/watch"]', { timeout: 30000 });
  await waitForRequest(page);
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

const worker = async ctx => ctx.serviceWorkers()[0] ?? ctx.waitForEvent('serviceworker', { timeout: 15000 });
const setStored = async (ctx, patch) => (await worker(ctx)).evaluate(p => chrome.storage.local.set(p), patch);

const checkHomeSelector = async page => {
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer', { timeout: 30000 });
  const selector = await page.evaluate(() => window.SmallYT.ytPage.SELECTORS.homeGrid);
  assert.ok(selector.includes('page-subtype="home"'), 'never picks a hidden page kept from earlier navigation');
  assert.ok((await page.locator(selector).count()) >= 1, 'the selector finds the home grid');
};

const checkOffStopsCardsInFlight = async (ctx, page) => {
  await page.goto(WATCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForRequest(page);
  await setStored(ctx, { settings: { enabled: false } });
  await page.waitForTimeout(12000);
  assert.equal(await page.locator(SMALL).count(), 0, 'no card appears after OFF');
  await (await worker(ctx)).evaluate(() => chrome.storage.local.remove('settings'));
};

const checkReloadStopsCleanly = async (ctx, page, setup, errors) => {
  await page.goto(WATCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (!(await waitForCards(page, setup.expectCards))) return;
  (await worker(ctx)).evaluate(() => chrome.runtime.reload()).catch(() => {});
  await page.waitForTimeout(8000);
  assert.equal(await page.locator(SMALL).count(), 0, 'an orphaned page removes its cards and stops');
  const asked = await page.evaluate(() => window.__smallYtAsked);
  await page.waitForTimeout(6000);
  assert.equal(await page.evaluate(() => window.__smallYtAsked), asked, 'an orphaned page asks for nothing more');
  assert.deepEqual(errors, [], 'stops quietly');
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

  assert.equal(await value('#requests-value'), '3k', 'the daily limit starts at 3k');
  assert.equal(await popup.evaluate(() => document.getElementById('views-min').closest('section').nextElementSibling.contains(document.getElementById('requests-slider'))), true, 'it comes right after the views range');
  await popup.locator('#requests-slider').focus();
  await popup.keyboard.press('ArrowRight');
  assert.equal((await stored()).dailyRequests, 5000, 'arrow keys move to the next stop');
  await popup.keyboard.press('ArrowRight');
  await popup.keyboard.press('ArrowRight');
  assert.equal((await stored()).dailyRequests, null, 'the last stop has no limit');
  assert.equal(await value('#requests-value'), '∞');
  for (const rejected of ['0', 'abc']) {
    await popup.locator('#requests-value').fill(rejected);
    await popup.locator('#requests-value').blur();
    assert.equal((await stored()).dailyRequests, null, `${rejected} is not a limit`);
    assert.equal(await value('#requests-value'), '∞', 'the box goes back to the saved value');
  }
  await popup.locator('#requests-value').fill('2k');
  await popup.locator('#requests-value').blur();
  assert.equal((await stored()).dailyRequests, 2000, 'a typed limit can sit between stops');
  assert.equal(await value('#requests-value'), '2k');

  await popup.locator('#add-language').selectOption('fi');
  assert.ok((await stored()).languages.includes('fi'));
  assert.equal((await stored()).languagesEdited, true);
  while ((await popup.locator('#languages li').count()) > 1) await popup.locator('#languages li button').first().click();
  assert.equal(await popup.locator('#languages li button').first().isDisabled(), true, 'the last language stays');

  assert.equal(await popup.locator('#show-ai').isChecked(), true, 'AI videos are shown by default');
  await popup.locator('#show-ai').click();
  assert.equal((await stored()).showAiVideos, false);
  await popup.locator('#show-ai').click();

  assert.equal(await popup.locator('#show-small-creator').isChecked(), true, 'the label is on by default');
  await popup.locator('#show-small-creator').click();
  assert.equal((await stored()).showSmallCreatorLabel, false);
  await popup.locator('#show-small-creator').click();

  const summary = id => popup.locator(id).textContent();
  const words = async () => (await popup.evaluate(() => chrome.storage.local.get('blocks'))).blocks?.words;
  const plainWordsSummary = await summary('#words-summary');
  await popup.locator('#word-list summary').click();
  await popup.locator('#add-word').fill('  suicide ');
  await popup.locator('#add-word').press('Enter');
  await popup.waitForFunction(() => document.querySelectorAll('#words li').length === 1);
  assert.deepEqual(await words(), ['suicide']);
  assert.equal(await popup.locator('#add-word').inputValue(), '', 'the box is ready for the next word');
  assert.equal(await summary('#words-summary'), `${plainWordsSummary}: 1`);
  await popup.locator('#words li button').click();
  await popup.waitForFunction(() => document.querySelectorAll('#words li').length === 0);
  assert.deepEqual(await words(), []);
  assert.equal(await summary('#words-summary'), plainWordsSummary);
  await popup.locator('#word-list summary').click();

  assert.match(await summary('#watched-summary'), /\b0$/, 'nothing watched yet');
  assert.equal(await popup.locator('#watched-clear').isHidden(), true);
  await popup.evaluate(() => chrome.storage.local.set({ watched: { count: 7, videos: [{ id: 'abc_123', title: '<b>A video</b>', channelName: 'A channel' }] } }));
  await popup.reload();
  await popup.waitForFunction(() => document.querySelectorAll('#watched li').length === 1);
  assert.match(await summary('#watched-summary'), /\b7$/, 'the count can be higher than the list is long');
  await popup.locator('#watched-list summary').click();
  const row = popup.locator('#watched li a');
  assert.equal(await row.textContent(), '<b>A video</b>', 'a title is only ever text');
  assert.equal(await row.getAttribute('href'), 'https://www.youtube.com/watch?v=abc_123');
  await popup.locator('#watched-clear').click();
  await popup.waitForFunction(() => document.querySelectorAll('#watched li').length === 0);
  assert.match(await summary('#watched-summary'), /\b0$/, 'clearing resets the count');
  await popup.locator('#watched-list summary').click();

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
    await trackRequests(browser.page);
    await checkWelcome(browser.ctx, setup);
    await checkPopup(browser.ctx, setup);
    await checkNoWelcomeOnRestart(setup);
    const watch = process.env.E2E_UI_ONLY ? 'skipped' : await checkWatchColumn(browser.page, setup);
    if (!process.env.E2E_UI_ONLY) {
      await checkLateCardsDropped(browser.page);
      await checkEmptyHome(browser.page);
      await checkHomeSelector(browser.page);
      await checkOffStopsCardsInFlight(browser.ctx, browser.page);
      await checkReloadStopsCleanly(browser.ctx, browser.page, setup, errors);
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
