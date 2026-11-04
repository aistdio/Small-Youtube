# Small-Youtube Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 extension that adds small-channel videos, rendered by YouTube itself, to the home feed and the watch-page column.

**Architecture:** A content script finds and vets videos (requests, storage, ranking). A page-world script reads the page and renders cards. They talk by window messages. All YouTube-specific knowledge lives in one file loaded into both worlds. Pure logic is unit-tested on saved YouTube responses; real behaviour is tested with the unpacked extension in Playwright (logged out) and a logged-in Chrome (logged in).

**Tech Stack:** Plain JavaScript with no framework and no build step, `node:test`, Playwright (dev only), `web-ext lint` (dev only).

**Spec:** `docs/superpowers/specs/2026-11-04-small-youtube-design.md`. Read it first; its "Measured so far" section records real YouTube behaviour.

## Global Constraints

- Permissions: `storage` and `https://www.youtube.com/*` only. No server, no analytics.
- Never read or compute anything from login cookies, and never use `document.cookie`. Only let the browser send them.
- No-cookie requests: at most 3 per second, 3 at once. Account page fetches: at most 1 per 2 seconds, 1 at a time. About 3,000 requests a day per browser, shared across tabs. Only the visible tab fetches.
- On 403, 429, repeated server errors or any captcha sign: stop everything for 30 minutes without retrying. On 404: skip that item. Never try to get past a captcha.
- Requests run from the content script. The service worker gets 403 on API search.
- Never set a card's size. Never change autoplay. Never open tabs, except the one welcome tab on install. Never press the confirm button in YouTube's language dialog.
- Selectors, endpoints and parsers live only in `src/youtube.js`.
- Every source file is a classic script in this shape, so it loads both in the browser and through a Node side-effect import. Tests read `globalThis.SmallYT.<name>`.

```js
(() => { const api = { /* ... */ }; (globalThis.SmallYT ??= {}).name = api; })();
```

- Popup text is one line per setting. User-facing strings live in `_locales/en` and `_locales/ru`, with English as the default.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on the branch `feat/extension`, created in Task 1.

## Review Focus

1. YouTube sends an unexpected layout or response shape (common with its experiments): no card, no error, feed untouched. Test in Task 1 and Task 9.
2. A page fetch returns a consent or sign-in page instead of a video: treat the language as unknown, with no pause and no crash. Test in Task 4 and Task 7.
3. The viewer navigates while a card is in flight: the late card is dropped, never inserted on the wrong page. Test in Task 8.
4. The extension is updated or reloaded while YouTube is open, so `chrome.*` calls throw: stop quietly. Test in Task 2.
5. Odd settings: typed garbage, min above max, every language removed: normalize them to something valid. Test in Task 2.

## File Map

Everything the browser loads lives in `extension/`, so Chrome and store packages never see `node_modules` or tests. Throughout this plan, paths starting with `manifest.json`, `_locales/`, `src/`, `popup/` or `welcome/` are relative to `extension/`. All others are relative to the repo root.

```text
package.json, .gitignore, AGENTS.md, CLAUDE.md, README.md
manifest.json
_locales/{en,ru}/messages.json
src/youtube.js             selectors, endpoints, parsers, lockup builder (both worlds)
src/lib/settings.js        defaults, normalize, language defaults (content, popup)
src/lib/topic.js           keywords, phrases, filters, ranking (content)
src/lib/language.js        keep or skip decision (content)
src/lib/slots.js           share ratio, positions, row fixes, generations (page)
src/content/store.js       chrome.storage wrapper, channel cache, shown list
src/content/queue.js       rate caps, daily budget, pause
src/content/api.js         search, related, channel, tags, page fetches
src/content/pipeline.js    seed to finished card
src/content/content.js     wiring and messages
src/page/cards.js          render cards, safety check, menu clicks
src/page/feed.js           watch the page, ask for cards, insert, hide, restore
src/page/languages.js      hidden-frame language read
src/page/page.js           wiring and messages
src/background.js          welcome tab on install
popup/{popup.html,popup.css,popup.js,scale.js}
welcome/{welcome.html,welcome.css,welcome.js}
tests/unit/*.test.js, tests/fixtures/*, tests/e2e/*.mjs
```

---

### Task 1: Scaffold, fixtures and parsers

**Files:**
- Create: `manifest.json`, `package.json`, `.gitignore`, `src/youtube.js`, `tests/e2e/harness.mjs`, `tests/e2e/capture-fixtures.mjs`, `tests/fixtures/*`
- Test: `tests/unit/youtube.test.js`, `tests/unit/manifest.test.js`

**Interfaces:**
- Produces: `SmallYT.yt.SELECTORS`, `parseCount(text, hl) -> number|null`, `formatCount(n, hl) -> string`, `parseSearch(json, hl) -> Candidate[]`, `parseNext(json, hl) -> Candidate[]`, `parseSearchPage(html, hl) -> Candidate[]`, `parseWatchRelated(html, hl) -> Candidate[]`, `parseSubscribers(json) -> number|null`, `parseTags(json) -> string[]`, `parseWatchPage(html) -> WatchInfo|null`, `continuationToken(json) -> string|null`.
- `Candidate = { id, title, channelName, channelId, views, lengthSeconds, isShort, autoDubbedLabel, source: 'search'|'related', lockup?, renderer? }`. `views` and `lengthSeconds` may be null.
- `WatchInfo = { title, tracks: [{ id, isDefault }], autoCaptions: string[] }`.
- `launch({ channel, locale, viewport }) -> { ctx, page }` in `tests/e2e/harness.mjs`, which loads `extension/` as the unpacked extension in a throwaway profile with `--mute-audio`.

- [ ] **Step 1: Create the branch and commit the design documents**

```bash
git switch -c feat/extension
git add docs
git commit -m "docs: add design and build plan"
```

- [ ] **Step 2: Add `package.json` and the capture script**

`package.json`: `"type": "module"`, dev dependencies `playwright` and `web-ext`, and scripts `test` = `node --test tests/unit/` and `e2e` = `node tests/e2e/run.mjs`.

`capture-fixtures.mjs` uses the harness to save logged-out responses, trimmed to the first 8 results and stripped of `trackingParams`, `clickTrackingParams` and stream URLs:

| Fixture | Source |
|---|---|
| `search.en.json`, `search.ru.json` | search "Epic Seven Steam", video filter `EgIQAQ==` |
| `next.en.json`, `next.ru.json` | next for `IWbeDRbK-wk` |
| `browse.en.json` | browse a channel, params `EgZ2aWRlb3PyBgQKAjoA` |
| `player.en.json` | player for `FTrAYTyuK4Q` |
| `results.ru.html`, `watch-related.ru.html` | page fetches, kept to `ytInitialData` |
| `watch.dub-default.html` | `FTrAYTyuK4Q`, locale en-US, kept to `ytInitialPlayerResponse` |
| `watch.original-default.html` | `FTrAYTyuK4Q`, locale de-DE |
| `watch.no-tracks.html` | `IWbeDRbK-wk` |
| `watch.finnish.html` | `Tze4yg8ECxY` |
| `watch.no-language.html` | `lTzQ8W2abbo` |

Run: `npm i && npx playwright install chromium && node tests/e2e/capture-fixtures.mjs`
Expected: all files exist and each is under 300 KB.

- [ ] **Step 3: Write the failing tests**

```js
test('parseCount reads compact and exact counts', () => {
  assert.equal(parseCount('710K', 'en'), 710000);
  assert.equal(parseCount('1.2M views', 'en'), 1200000);
  assert.equal(parseCount('710 тыс.', 'ru'), 710000);
  assert.equal(parseCount('1,2 млн', 'ru'), 1200000);
  assert.equal(parseCount('5 802 просмотра', 'ru'), 5802);
  assert.equal(parseCount('No views', 'en'), 0);
  assert.equal(parseCount('nonsense', 'en'), null);
});
test('formatCount matches YouTube style', () => {
  assert.equal(formatCount(5802, 'ru').replace(/\s/g, ' '), '5,8 тыс.');
  assert.equal(formatCount(710000, 'en'), '710K');
});
test('parsers read real responses', () => {
  const s = parseSearch(load('search.en.json'), 'en');
  assert.ok(s.length >= 5);
  assert.ok(s.every(c => c.id.length === 11 && c.channelId.startsWith('UC') && c.source === 'search' && c.renderer));
  const n = parseNext(load('next.ru.json'), 'ru');
  assert.ok(n.length >= 5 && n.every(c => c.lockup && c.source === 'related'));
  assert.ok(n.some(c => typeof c.views === 'number'));
  assert.ok(parseSearchPage(read('results.ru.html'), 'ru').length >= 5);
  assert.ok(parseWatchRelated(read('watch-related.ru.html'), 'ru').length >= 5);
  assert.ok(parseSubscribers(load('browse.en.json')) > 0);
  assert.ok(parseTags(load('player.en.json')).length > 0);
});
test('parseWatchPage reads tracks and captions', () => {
  const dub = parseWatchPage(read('watch.dub-default.html'));
  assert.deepEqual(dub.tracks.find(t => t.isDefault).id, 'en-US.10');
  assert.ok(dub.tracks.some(t => t.id === 'pl.4'));
  assert.equal(parseWatchPage(read('watch.original-default.html')).tracks.find(t => t.isDefault).id, 'pl.4');
  assert.deepEqual(parseWatchPage(read('watch.finnish.html')).autoCaptions, ['fi']);
  assert.deepEqual(parseWatchPage(read('watch.no-language.html')).autoCaptions, []);
});
test('unexpected shapes give empty results, not errors', () => {
  assert.deepEqual(parseSearch({ unexpected: true }, 'en'), []);
  assert.deepEqual(parseNext({ unexpected: true }, 'en'), []);
  assert.equal(parseSubscribers({}), null);
  assert.equal(parseWatchPage('<html>consent</html>'), null);
});
test('manifest asks for the minimum', () => {
  assert.deepEqual(m.permissions, ['storage']);
  assert.deepEqual(m.host_permissions, ['https://www.youtube.com/*']);
  assert.equal(m.manifest_version, 3);
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npm test`
Expected: FAIL, `SmallYT` is undefined.

- [ ] **Step 5: Implement `src/youtube.js` and `manifest.json`**

- Build the compact-suffix table for `parseCount` from `Intl.NumberFormat(hl, { notation: 'compact' }).formatToParts` across powers of ten, and normalize non-breaking spaces and Arabic-Indic digits.
- Mark `autoDubbedLabel` from a language-neutral marker if the fixture shows one, otherwise from the en and ru label texts. A miss only costs a page fetch.
- Channel subscriber lookups always use `hl=en`, so `parseSubscribers` only needs the English form.
- Manifest: two `content_scripts` entries at `document_idle` listing the files in the File Map, the page entry with `"world": "MAIN"`; `minimum_chrome_version` 121; `background` with both `service_worker` and `scripts`; `browser_specific_settings.gecko` with `strict_min_version` 128; `default_locale` en. Keep only files that exist in each list as tasks add them.

- [ ] **Step 6: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add manifest, fixtures and YouTube parsers"
```

### Task 2: Settings and storage

**Files:**
- Create: `src/lib/settings.js`, `src/content/store.js`
- Test: `tests/unit/settings.test.js`, `tests/unit/store.test.js`

**Interfaces:**
- Produces: `SmallYT.settings.DEFAULTS`, `normalize(raw) -> Settings`, `initialLanguages(browserLang) -> string[]`, `mergeAccountLanguages(codes, hl) -> string[]`, `removeLanguage(list, code) -> string[]`.
- `Settings = { enabled, share: 0|25|50|75|100|'random', subsMin, subsMax, viewsMin, viewsMax, skipDubbed, showUnknownLanguage, useAccountForSearches, languages, languagesEdited }`. A null max means no limit.
- Produces: `createStore(chromeApi, now) -> { getSettings(), setSettings(patch), onChange(fn), getSubs(channelId), setSubs(channelId, n), getShown(), addShown(id), getBlocks() -> { channels, phrases, seedChannels }, hideChannel(id, name), muteTopic(phrase), muteSeedChannel(name), unblock(item), getState(key), setState(key, value) }`.

- [ ] **Step 1: Write the failing tests**

```js
test('defaults match the design', () => {
  const d = DEFAULTS;
  assert.equal(d.share, 25); assert.equal(d.subsMin, 10); assert.equal(d.subsMax, 10000);
  assert.equal(d.viewsMin, 0); assert.equal(d.viewsMax, null);
  assert.equal(d.skipDubbed, true); assert.equal(d.showUnknownLanguage, false);
  assert.equal(d.useAccountForSearches, false); assert.equal(d.enabled, true);
});
test('odd settings become valid', () => {
  assert.equal(normalize({ share: 33 }).share, 25);
  assert.equal(normalize({ subsMin: 'abc' }).subsMin, 10);
  const swapped = normalize({ subsMin: 5000, subsMax: 100 });
  assert.deepEqual([swapped.subsMin, swapped.subsMax], [100, 5000]);
  assert.equal(normalize({ viewsMin: -5 }).viewsMin, 0);
  assert.ok(normalize({ languages: [] }).languages.length >= 1);
});
test('language defaults', () => {
  assert.deepEqual(initialLanguages('ru-RU'), ['en', 'ru']);
  assert.deepEqual(initialLanguages('en-US'), ['en']);
  assert.deepEqual(mergeAccountLanguages(['en', 'en-US', 'ja'], 'ru'), ['en', 'ja', 'ru']);
  assert.deepEqual(removeLanguage(['en', 'ru'], 'en'), ['ru']);
  assert.deepEqual(removeLanguage(['ru'], 'ru'), ['ru']);
});
test('channel cache expires after 7 days', async () => {
  await store.setSubs('UC1', 500);
  assert.equal(await store.getSubs('UC1'), 500);
  clock.advance(7 * 24 * 3600 * 1000 + 1);
  assert.equal(await store.getSubs('UC1'), undefined);
});
test('invalidated extension context stops quietly', async () => {
  const store = createStore({ runtime: { get id() { throw new Error('Extension context invalidated'); } }, storage: throwingStorage }, Date.now);
  assert.deepEqual(await store.getSettings(), DEFAULTS);
  await store.addShown('abc');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL, `SmallYT.settings` is undefined.

- [ ] **Step 3: Implement both files**

Keep the shown list to the latest 2,000 ids. Keep channel counts in one `chrome.storage.local` key, dropping expired entries on write.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add settings and storage"
```

### Task 3: Topic, filters and ranking

**Files:**
- Create: `src/lib/topic.js`
- Test: `tests/unit/topic.test.js`

**Interfaces:**
- Consumes: `Candidate` from Task 1.
- Produces: `SmallYT.topic.cleanTitle(title, channel) -> string[]`, `buildQuery(title, channel, tags) -> string`, `topicTerms(title, channel, tags) -> string[]`, `bestPhrase(title, tags) -> string|null`, `matchesPhrase(title, phrase) -> boolean`, `isNearCopy(a, b) -> boolean`, `passesCheapFilters(candidate, ctx) -> boolean`, `lookupOrder(candidates, terms) -> Candidate[]`, `inSubscriberRange(subs, settings) -> boolean`, `rank(candidates, terms) -> Candidate[]`, `chooseOrder(ranked, rng) -> Candidate[]`.
- `ctx = { seed, settings, shownIds: Set, hiddenChannels: Set, mutedPhrases: string[] }`.

- [ ] **Step 1: Write the failing tests**

```js
test('titles and queries', () => {
  assert.deepEqual(cleanTitle('Rina ⚡🧹 - Bass Shake [Zenless Zone Zero MMD] #mmd part 3', 'PulsePixel'), ['Rina', 'Bass', 'Shake']);
  assert.equal(buildQuery('Modern Writing To Invoke A Sense Of Dread', 'BunTheOne', []), 'Modern Writing Invoke Sense');
  assert.ok(buildQuery('Epic Seven — Релиз в Steam 2026! День шестой', 'Nibiru', ['Epic Seven', 'Epic7']).startsWith('Epic Seven'));
  assert.ok(!buildQuery('HOLY CRAP!!! They Released Real INGAME FOOTAGE', 'Stix', ['stix', 'mmorpg']).toLowerCase().includes('stix'));
  assert.ok(buildQuery('HOLY CRAP!!! They Released Real INGAME FOOTAGE', 'Stix', ['stix', 'mmorpg']).includes('mmorpg'));
});
test('muted phrases match whole', () => {
  assert.equal(bestPhrase('Epic Seven — Steam launch', ['Epic Seven', 'E7']), 'Epic Seven');
  assert.equal(bestPhrase('i humbly submit a toast', []), null);
  assert.ok(matchesPhrase('New epic seven patch', 'Epic Seven'));
  assert.ok(!matchesPhrase('Epic Sevenfold live', 'Epic Seven'));
});
test('cheap filters', () => {
  const ok = { id: 'a', title: 'Epic Seven guide', channelName: 'X', channelId: 'UCx', views: 500, lengthSeconds: 300, isShort: false };
  const ctx = { seed: { id: 's', title: 'Epic Seven launch', channelName: 'Y' }, settings: DEFAULTS, shownIds: new Set(), hiddenChannels: new Set(), mutedPhrases: [] };
  assert.ok(passesCheapFilters(ok, ctx));
  assert.ok(!passesCheapFilters({ ...ok, lengthSeconds: 59 }, ctx));
  assert.ok(!passesCheapFilters({ ...ok, lengthSeconds: null }, ctx)); // live streams and premieres have no length
  assert.ok(!passesCheapFilters({ ...ok, isShort: true }, ctx));
  assert.ok(!passesCheapFilters({ ...ok, views: 300001 }, ctx));
  assert.ok(passesCheapFilters({ ...ok, views: 400000 }, { ...ctx, settings: { ...DEFAULTS, viewsMin: 300000 } }));
  assert.ok(!passesCheapFilters({ ...ok, channelName: 'Y' }, ctx));
  assert.ok(!passesCheapFilters({ ...ok, title: 'Epic Seven launch' }, ctx));
  assert.ok(!passesCheapFilters({ ...ok, autoDubbedLabel: true }, ctx));
  assert.ok(passesCheapFilters({ ...ok, autoDubbedLabel: true }, { ...ctx, settings: { ...DEFAULTS, skipDubbed: false } }));
  assert.ok(!passesCheapFilters(ok, { ...ctx, hiddenChannels: new Set(['UCx']) }));
  assert.ok(!passesCheapFilters(ok, { ...ctx, mutedPhrases: ['Epic Seven'] }));
  assert.ok(!passesCheapFilters(ok, { ...ctx, shownIds: new Set(['a']) }));
});
test('ranking uses the design example', () => {
  const v = (id, views, subs, title = 'Epic Seven') => ({ id, views, subs, title });
  const r = rank([v('d', 13, 110), v('c', 180, 59), v('off', 90000, 100, 'Other game'), v('a', 5802, 687), v('b', 662, 118)], ['Epic', 'Seven']);
  assert.deepEqual(r.map(x => x.id), ['a', 'b', 'c', 'd', 'off']);
  assert.ok(rank([v('z', 10, 0)], ['Epic']).length === 1); // 0 subscribers count as 1
  assert.deepEqual(chooseOrder(r, () => 0.99).map(x => x.id), ['c', 'a', 'b', 'd', 'off']);
  assert.ok(!inSubscriberRange(null, DEFAULTS)); // hidden count
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL, `SmallYT.topic` is undefined.

- [ ] **Step 3: Implement `src/lib/topic.js`**

- A query prefers a tag sharing a word with the title, then non-channel tags, then fills from title terms, up to 4 words. Stop words cover English and Russian.
- `isNearCopy` is token overlap of at least 0.8 after lowercasing.
- A candidate is on-topic when any term of 3 or more characters is in its title.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add topic matching, filters and ranking"
```

### Task 4: Language rules

**Files:**
- Create: `src/lib/language.js`
- Test: `tests/unit/language.test.js`

**Interfaces:**
- Consumes: `WatchInfo|null` from Task 1.
- Produces: `SmallYT.language.originalLanguage(info) -> string|null`, `decide(info, settings) -> 'keep'|'skip'`.

- [ ] **Step 1: Write the failing test**

```js
const base = { skipDubbed: true, showUnknownLanguage: false, languages: ['en', 'ru'] };
const dub = { title: 't', tracks: [{ id: 'en-US.10', isDefault: true }, { id: 'pl.4', isDefault: false }], autoCaptions: ['en', 'pl'] };
const polishOriginal = { title: 't', tracks: [{ id: 'en-US.10', isDefault: false }, { id: 'pl.4', isDefault: true }], autoCaptions: ['en', 'pl'] };
const russian = { title: 't', tracks: [{ id: 'ru.4', isDefault: true }, { id: 'en-US.10', isDefault: false }], autoCaptions: ['en', 'ru'] };
const english = { title: 't', tracks: [], autoCaptions: ['en'] };
const finnish = { title: 't', tracks: [], autoCaptions: ['fi'] };
const unknown = { title: 't', tracks: [], autoCaptions: [] };
test('rules run in the design order', () => {
  assert.equal(decide(dub, base), 'skip');
  assert.equal(decide(polishOriginal, base), 'skip');
  assert.equal(decide(russian, base), 'keep');
  assert.equal(decide(english, base), 'keep');
  assert.equal(decide(finnish, base), 'skip');
  assert.equal(decide(unknown, base), 'skip');
  assert.equal(decide(unknown, { ...base, showUnknownLanguage: true }), 'keep');
  assert.equal(decide(polishOriginal, { ...base, languages: ['en', 'pl'] }), 'keep');
});
test('skipDubbed off keeps dubs and still checks language', () => {
  assert.equal(decide(dub, { ...base, skipDubbed: false }), 'keep');
  assert.equal(decide(finnish, { ...base, skipDubbed: false }), 'skip');
});
test('consent or sign-in page counts as unknown', () => {
  assert.equal(decide(null, base), 'skip');
  assert.equal(decide(null, { ...base, showUnknownLanguage: true }), 'keep');
});
test('region codes reduce to the base language', () => {
  assert.equal(originalLanguage({ tracks: [{ id: 'en-US.4', isDefault: true }], autoCaptions: [] }), 'en');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL, `SmallYT.language` is undefined.

- [ ] **Step 3: Implement `src/lib/language.js`**

Original language is the track id ending `.4`, otherwise the single auto-caption language. Several captions with no tracks count as unknown. Keep the `.4` and `.10` suffixes in `SmallYT.yt` constants, since they belong to the YouTube module.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add language rules"
```

### Task 5: Request queue and API client

**Files:**
- Create: `src/content/queue.js`, `src/content/api.js`
- Test: `tests/unit/queue.test.js`, `tests/unit/api.test.js`, `tests/unit/safety.test.js`

**Interfaces:**
- Consumes: store `getState/setState/onChange` from Task 2; parsers from Task 1.
- Produces: `SmallYT.queue.createQueue({ store, now, sleep, isVisible }) -> { run(kind, fn), isPaused(), onPauseChange(cb) }`, where `kind` is `'plain'|'account'` and `fn` returns `{ status, finalUrl, body }`. `run` resolves with the response, or rejects with `{ reason: 'paused'|'budget'|'skip' }`.
- Produces: `SmallYT.api.createApi({ queue, fetchFn, context }) -> { search(query, useAccount), related(videoId, useAccount), subscribers(channelId), tags(videoId), watchInfo(videoId) }`. `context = { clientVersion, hl, gl }`. `search` returns page 1 and page 2 together.

- [ ] **Step 1: Write the failing tests**

```js
test('plain requests: 3 per second, 3 at once', async () => {
  await runMany(q, 'plain', 10);
  assert.ok(maxInAnySecond(starts) <= 3);
  assert.ok(maxConcurrent <= 3);
});
test('account requests: 1 per 2 seconds, 1 at a time', async () => {
  await runMany(q, 'account', 4);
  assert.ok(minGap(starts) >= 2000);
  assert.equal(maxConcurrent, 1);
});
test('daily budget is shared and stops at 3000', async () => {
  await store.setState('budget', { day: today(), used: 3000 });
  await assert.rejects(q.run('plain', ok), { reason: 'budget' });
});
test('403, 429 and captcha pause for 30 minutes across tabs', async () => {
  for (const r of [{ status: 403 }, { status: 429 }, { status: 200, finalUrl: 'https://www.google.com/sorry/index' }]) {
    const { q, store, clock } = fresh();
    await assert.rejects(q.run('plain', () => r), { reason: 'paused' });
    assert.equal((await store.getState('pausedUntil')), clock.now() + 30 * 60 * 1000);
    await assert.rejects(q.run('plain', ok), { reason: 'paused' });
  }
});
test('404 skips without pausing', async () => {
  await assert.rejects(q.run('plain', () => ({ status: 404 })), { reason: 'skip' });
  assert.equal(q.isPaused(), false);
});
test('3 server errors in a row pause, a success resets the count', async () => { /* 503, 503, 200, 503, 503 => not paused; a third 503 => paused */ });
test('a hidden tab holds its requests until visible', async () => { /* isVisible false => fn not called; true => called */ });
test('api uses the right credentials', async () => {
  await api.search('x', false); assert.ok(calls.every(c => c.credentials === 'omit' && c.url.includes('/youtubei/v1/search')));
  await api.subscribers('UC1'); assert.equal(last().credentials, 'omit');
  await api.tags('v'); assert.equal(last().credentials, 'omit');
  await api.watchInfo('v'); assert.equal(last().credentials, 'include'); assert.ok(last().url.includes('/watch?v=v'));
  await api.search('x', true); assert.equal(last().credentials, 'include'); assert.ok(last().url.includes('/results?search_query='));
  await api.related('v', true); assert.equal(last().credentials, 'include');
});
test('source never touches login cookies', () => {
  for (const f of allSourceFiles()) assert.ok(!read(f).includes('document.cookie'), f);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL, `SmallYT.queue` is undefined.

- [ ] **Step 3: Implement both files**

`pausedUntil` and the budget live in storage, so all tabs share them, and `onPauseChange` also fires on storage changes from other tabs. Treat a thrown fetch as a server error. A `/sorry/` final URL or `g-recaptcha` in the body counts as a captcha sign. Requests use `SmallYT.yt` endpoints, with `hl=en` only for `subscribers`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add request queue and API client"
```

### Task 6: Lockup builder and menu data

**Files:**
- Modify: `src/youtube.js`
- Test: `tests/unit/lockup.test.js`

**Interfaces:**
- Produces: `SmallYT.yt.buildLockup(template, candidate, hl) -> lockup`, `setLockupTitle(lockup, title) -> lockup`, `addMenuEntries(lockup, labels: string[]) -> lockup`, `pickTemplate(candidates) -> lockup|null` (needs an avatar).

- [ ] **Step 1: Write the failing test**

```js
test('builds a card from a search result', () => {
  const tpl = pickTemplate(parseNext(load('next.en.json'), 'en'));
  const c = parseSearch(load('search.en.json'), 'en').find(x => x.id !== tpl.contentId && x.lengthSeconds);
  const built = buildLockup(tpl, c, 'en');
  const s = JSON.stringify(built);
  assert.equal(built.contentId, c.id);
  assert.ok(!s.includes(tpl.contentId));
  assert.ok(!s.includes(tpl.metadata.lockupMetadataViewModel.title.content));
  assert.ok(!/trackingParams|playerParams/.test(s));
  const rows = built.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].metadataParts[0].text.content, c.channelName);
  assert.equal(rows[1].metadataParts[0].text.content, formatCount(c.views, 'en'));
  assert.equal(built.contentImage.thumbnailViewModel.image.sources[0].url, c.renderer.thumbnail.thumbnails[0].url);
});
test('menu entries and title', () => {
  const lk = addMenuEntries(pickTemplate(parseNext(load('next.ru.json'), 'ru')), ['Меньше по этой теме', 'Скрыть этот канал']);
  assert.ok(JSON.stringify(lk).includes('Скрыть этот канал'));
  assert.equal(setLockupTitle(lk, 'Real title').metadata.lockupMetadataViewModel.title.content, 'Real title');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL, `buildLockup` is not a function.

- [ ] **Step 3: Implement the builder**

Clone the template, swapping the old video id, title, channel name, channel id and handle in every string. Drop `trackingParams`, `clickTrackingParams`, `params`, `playerParams`, `loggingDirectives`, `loggingContext` and `attachmentRuns`. Then set the thumbnail, avatar, channel, views, age and length directly, and keep only the first two rows. Menu entries clone the last `listItems` item and change its title.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: build cards from search results and add menu entries"
```

### Task 7: Pipeline

**Files:**
- Create: `src/content/pipeline.js`
- Test: `tests/unit/pipeline.test.js`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: `SmallYT.pipeline.createPipeline({ api, store, rng }) -> { findCard(seed, settings, labels) -> Promise<Card|null> }`.
- `seed = { id, title, channelName }`. `Card = { lockup, videoId, channelId, channelName, seed }`.

- [ ] **Step 1: Write the failing tests**

All use a fake `api` built from fixtures, with call counters.

```js
test('returns a card titled from the language-check page', async () => {
  const card = await p.findCard(seed, settings, labels);
  assert.equal(card.lockup.metadata.lockupMetadataViewModel.title.content, fakeWatchInfo.title);
  assert.equal(calls.watchInfo, 1);
});
test('looks up at most 8 new channels per card', async () => { assert.ok(calls.subscribers <= 8); });
test('cached channels do not count toward the 8', async () => { /* prefill the cache; 8 new lookups still allowed */ });
test('on-topic candidates are looked up first', async () => { /* first looked-up channel belongs to an on-topic candidate */ });
test('a failed language check moves to the next in the ranking', async () => {
  // first watchInfo is a dub, second is English
  const card = await p.findCard(seed, settings, labels);
  assert.equal(calls.watchInfo, 2);
  assert.ok(card);
});
test('a candidate already labelled auto-dubbed spends no page fetch', async () => { assert.equal(calls.watchInfo, 0); });
test('a consent page counts as unknown and does not throw', async () => {
  // watchInfo returns null for every candidate
  assert.equal(await p.findCard(seed, settings, labels), null);
});
test('the same seed reuses its pool', async () => {
  await p.findCard(seed, settings, labels); await p.findCard(seed, settings, labels);
  assert.equal(calls.search, 1); assert.equal(calls.related, 1);
});
test('search results are dropped when no template exists', async () => { /* related empty => null */ });
test('a pause or budget rejection ends quietly', async () => { assert.equal(await p.findCard(seed, settings, labels), null); });
test('a shown video is not offered again', async () => { /* second card has a different videoId */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL, `SmallYT.pipeline` is undefined.

- [ ] **Step 3: Implement `src/content/pipeline.js`**

Follow spec steps 3–7. Fetch tags once per seed. Pools live in memory, keyed by seed id. Pass `useAccountForSearches` to `api.search` and `api.related`. Add the shown id only when a card is returned.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add the pipeline from seed to card"
```

### Task 8: Slots, rows and page generations

**Files:**
- Create: `src/lib/slots.js`
- Test: `tests/unit/slots.test.js`

**Interfaces:**
- Produces: `SmallYT.slots.resolveShare(share, rng) -> number` (Random gives a whole number from 1 to 99), `smallCardsOwed(youTubeCount, percent) -> number`, `targetAfter(i, percent) -> number` (YouTube cards before the i-th small card), `nextPosition(i, percent, firstBelowScreen) -> number`, `cardsToMove(segmentCount, perRow) -> number`, `createGeneration() -> { current(), bump(), isCurrent(n) }`.

- [ ] **Step 1: Write the failing test**

```js
test('slider ratios from the design', () => {
  assert.equal(smallCardsOwed(30, 0), 0);
  assert.equal(smallCardsOwed(30, 25), 10);
  assert.equal(smallCardsOwed(30, 50), 30);
  assert.equal(smallCardsOwed(30, 75), 90);
  assert.equal(smallCardsOwed(30, 100), 30); // one replacement each
  assert.equal(targetAfter(0, 25), 3); assert.equal(targetAfter(1, 25), 6);
  assert.equal(targetAfter(0, 50), 1);
  assert.equal(targetAfter(2, 75), 1);
});
test('random picks a new share within range', () => {
  assert.equal(resolveShare(50, Math.random), 50);
  const r = resolveShare('random', () => 0.5);
  assert.ok(r >= 1 && r <= 99);
});
test('positions never land above the screen', () => {
  assert.equal(nextPosition(0, 25, 12), 12);
  assert.equal(nextPosition(5, 25, 2), 18);
});
test('rows stay complete before full-width sections', () => {
  assert.equal(cardsToMove(7, 3), 1);
  assert.equal(cardsToMove(6, 3), 0);
});
test('a late answer from an old page is rejected', () => {
  const g = createGeneration(); const asked = g.current();
  g.bump();
  assert.equal(g.isCurrent(asked), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL, `SmallYT.slots` is undefined.

- [ ] **Step 3: Implement `src/lib/slots.js`**

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add slot, row and generation logic"
```

### Task 9: Watch column, end to end

First working extension: real cards in the column, logged out.

**Files:**
- Create: `src/content/content.js`, `src/page/cards.js`, `src/page/feed.js`, `src/page/page.js`, `_locales/en/messages.json`, `_locales/ru/messages.json`, `tests/e2e/run.mjs`
- Modify: `manifest.json`
- Test: `tests/unit/cards.test.js`, `tests/e2e/run.mjs`

**Interfaces:**
- Consumes: pipeline, slots, `SELECTORS`, store, queue, api.
- Messages use `window.postMessage({ ns: 'small-yt', type, ... }, location.origin)`, checking `e.source === window` and `ns`:
  - Page to content: `context { clientVersion, hl, gl, loggedIn }`, `needCard { slotId, generation, seed }`, `pageChanged`, `hideChannel { channelId, channelName }`, `lessTopic { seed }`, `languages { codes, hl }`, `languagesFailed`.
  - Content to page: `config { settings, labels, paused, readLanguages }`, `card { slotId, generation, card }`, `noCard { slotId, generation }`.
- Produces: `SmallYT.cards.verifyRendered({ hasTitle, width, referenceWidth }) -> boolean`, `createWatchCard(lockup, neighbour) -> Element`, `createHomeCard(lockup, neighbour) -> Element`.
- Produces: `SmallYT.feed.start(send)`, `SmallYT.feed.onCard(message)`, `SmallYT.feed.applyConfig(config)`, `SmallYT.feed.removeAll()`.

- [ ] **Step 1: Write the failing tests**

```js
test('safety check', () => {
  assert.ok(verifyRendered({ hasTitle: true, width: 352, referenceWidth: 352 }));
  assert.ok(verifyRendered({ hasTitle: true, width: 352, referenceWidth: 353 })); // 1 px tolerance
  assert.ok(!verifyRendered({ hasTitle: false, width: 352, referenceWidth: 352 }));
  assert.ok(!verifyRendered({ hasTitle: true, width: 200, referenceWidth: 352 }));
});
```

`tests/e2e/run.mjs` runs these setups: Chromium en-US 1280, de-DE 1920, ar-EG 900, and Edge en-US when installed. On `/watch?v=IWbeDRbK-wk` with the default 25%, within 90 seconds:

```js
assert.ok(smallCards.length >= 1);
assert.equal(card.width, neighbour.width);
assert.equal(youTubeCardsAfter, youTubeCardsBefore);
assert.equal(extensionConsoleErrors.length, 0);
// click: opens card's video, no full reload
// home feed: logged out it is empty => no small cards, no errors
// navigate away mid-fill: no card appears on the new page's wrong column
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test` and `npm run e2e`
Expected: FAIL, no small cards found.

- [ ] **Step 3: Implement the wiring and watch-column flow**

- Page world reads `ytcfg` and posts `context`. Bump the generation and reset on `yt-navigate-finish`.
- `createWatchCard` creates `yt-lockup-view-model`, copies the neighbour's class and non-data own properties, then sets `data`. Do not use the column's `results` data, which rendered a 2,961 px card at narrow width.
- Ask for cards only near the screen. Mark small cards with `data-small-yt` and fade them in with a short opacity transition. Run `verifyRendered` after rendering, and remove failures.
- Add a card only if `generation` is still current.
- Content script: start the queue, pipeline and settings, and resolve `labels` from `chrome.i18n`. When `settings.languages` is still null on first run, set it to `initialLanguages(navigator.language)`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test` and `npm run e2e`
Expected: PASS in every setup.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add small cards to the watch column"
```

### Task 10: Home feed, rows and 100%

**Files:**
- Modify: `src/page/feed.js`, `src/page/cards.js`

**Interfaces:**
- Consumes: `createHomeCard`, slot functions, `SELECTORS`, `verifyRendered`.

Home feeds are empty when logged out, so this task is verified in a logged-in Chrome.

- [ ] **Step 1: Load the unpacked extension once**

Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and choose the `extension` folder. Add a development reload helper if it saves real time: an unpacked extension can read its own files, so a stamp file can trigger `chrome.runtime.reload()`.

- [ ] **Step 2: Implement home insertion**

- Seeds and positions use the Task 8 functions. Pick each seed near the next open position. Skip ads, Shorts, mixes and live streams.
- `createHomeCard` creates `ytd-rich-item-renderer`, copies the neighbour's attributes and class, then sets `data` to `{ ...neighbour.data, content: { lockupViewModel } }`.
- Keep rows complete: when a segment before a `ytd-rich-section-renderer` overflows `--ytd-rich-grid-items-per-row`, move the extra cards below the section. Recompute on resize.
- New `#contents` children trigger more cards. On an empty feed, add nothing.

- [ ] **Step 3: Implement 100% and restore**

Hide a YouTube card with a `small-yt-hidden` class only after its replacement renders, and only below the screen. Record a reference width before hiding, for `verifyRendered`. If no replacement is found, the card stays. `removeAll()` removes small cards and unhides everything on OFF. Unhide everything on a pause or when the budget runs out.

- [ ] **Step 4: Verify in a logged-in Chrome through Claude in Chrome, without clicking any video**

Expected:
- At 25%, cards appear on home with the same size as neighbours, and no gap before the Shorts row.
- With the CSS row count forced to 2, 3, 4, 5 and 6, rows stay complete after a resize event.
- At 100%, nothing swaps on screen, and scrolling shows small cards.
- OFF restores the feed without a reload.
- Scrolling loads more cards.
- `myactivity.google.com/product/youtube` shows no new searches.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add small cards to the home feed"
```

### Task 11: ⋮ menu actions

**Files:**
- Modify: `src/page/cards.js`, `src/content/content.js`, `src/content/pipeline.js`
- Test: `tests/unit/pipeline.test.js`

**Interfaces:**
- Consumes: `addMenuEntries`, `bestPhrase`, store `hideChannel/muteTopic/muteSeedChannel`.

- [ ] **Step 1: Write the failing tests**

```js
test('less of this topic mutes the best phrase', async () => {
  await handleLessTopic({ seed: { title: 'Epic Seven launch', channelName: 'N' }, tags: ['Epic Seven'] }, store);
  assert.deepEqual((await store.getBlocks()).phrases, ['Epic Seven']);
});
test('with no clear phrase it stops using the seed channel', async () => {
  await handleLessTopic({ seed: { title: 'i humbly submit a toast', channelName: 'yuyu' }, tags: [] }, store);
  assert.deepEqual((await store.getBlocks()).seedChannels, ['yuyu']);
});
test('muted topics and seed channels stop seeds', () => {
  assert.equal(seedAllowed({ title: 'Epic Seven news', channelName: 'A' }, { phrases: ['Epic Seven'], seedChannels: [] }), false);
  assert.equal(seedAllowed({ title: 'Other', channelName: 'yuyu' }, { phrases: [], seedChannels: ['yuyu'] }), false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL, `handleLessTopic` is not defined.

- [ ] **Step 3: Implement the actions**

Export `handleLessTopic` and `seedAllowed` on `SmallYT.pipeline`. `findCard` returns null for a blocked seed, and the page then tries another seed. In the page world, a capture-phase click listener on `document` matches `yt-list-item-view-model` by our labels and stops the event. Find the owning card from the last pointer press inside a `[data-small-yt]` card. On either action, close the menu and remove the card. "Hide this channel" also removes that channel's other small cards.

- [ ] **Step 4: Run to verify they pass, then check in a logged-in Chrome**

Run: `npm test`
Expected: PASS. In Chrome: both entries appear in the ⋮ menu, each removes the card, and no Share dialog opens. Record whether hover preview works on cards built from search results. If it doesn't, report that without blocking.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add hide channel and less of this topic"
```

### Task 12: Reading account languages

**Files:**
- Create: `src/page/languages.js`
- Modify: `src/page/page.js`, `src/content/content.js`, `src/lib/settings.js`
- Test: `tests/unit/settings.test.js`

**Interfaces:**
- Consumes: `mergeAccountLanguages`, store state.
- Produces: `SmallYT.languages.readAccountLanguages() -> Promise<string[]|null>`, `SmallYT.settings.shouldReadLanguages(state, now) -> boolean`, `applyAccountLanguages(settings, codes, hl) -> Settings`.

- [ ] **Step 1: Write the failing tests**

```js
const DAY = 86400000;
test('reads once, retries at most daily', () => {
  assert.ok(shouldReadLanguages({ done: false, lastTry: 0 }, DAY));
  assert.ok(!shouldReadLanguages({ done: true, lastTry: 0 }, DAY * 9));
  assert.ok(!shouldReadLanguages({ done: false, lastTry: DAY }, DAY + 1000));
  assert.ok(shouldReadLanguages({ done: false, lastTry: DAY }, DAY * 2 + 1));
});
test('account languages replace defaults, but not the user\'s edits', () => {
  const s = { ...DEFAULTS, languages: ['en', 'ru'], languagesEdited: false };
  assert.deepEqual(applyAccountLanguages(s, ['en', 'en-US', 'ja'], 'ru').languages, ['en', 'ja', 'ru']);
  assert.deepEqual(applyAccountLanguages({ ...s, languagesEdited: true }, ['ja'], 'ru').languages, ['en', 'ru']);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL, `shouldReadLanguages` is not a function.

- [ ] **Step 3: Implement the read**

Follow the spec's "How the list is read". Run only when `ytcfg` reports a logged-in user. Find the first `ytd-settings-options-renderer a[class*="AttributedStringLink"]` without an external `href`, never by text. Send pointer and mouse events from `elementFromPoint`. Wrap the frame's `fetch` to catch `get_panel`. Read checked rows, map labels to codes through `checkboxItemViewModel`, and remove the frame in every outcome. Time out after 15 seconds and return null.

- [ ] **Step 4: Run to verify they pass, then check in a logged-in Chrome**

Run: `npm test`
Expected: PASS. In Chrome: the popup's languages become the account's languages after one home load, the frame is gone, and a page reload doesn't repeat the read.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: read account languages once"
```

### Task 13: Popup

**Files:**
- Create: `popup/popup.html`, `popup/popup.css`, `popup/popup.js`, `popup/scale.js`
- Modify: `manifest.json`, `_locales/en/messages.json`, `_locales/ru/messages.json`
- Test: `tests/unit/scale.test.js`, `tests/e2e/run.mjs`

**Interfaces:**
- Consumes: `normalize`, `removeLanguage`, store via `chrome.storage`.
- Produces: `SmallYT.scale.STOPS` = `[0, 10, 100, 1000, 10000, null]`, `valueToPos(value) -> 0..1`, `posToValue(pos) -> value`, `parseTyped(text) -> number|null|undefined` (null means no limit, undefined means invalid), `formatValue(value, noLimitLabel) -> string`.

Use the `frontend-design` skill for the popup's look. Follow the spec's Popup section in order: share slider, divider "What counts as small", subscribers range, views range, settings, hidden list link, ON/OFF at the very bottom. Support light and dark.

- [ ] **Step 1: Write the failing tests**

```js
test('scale snaps to stops and places typed values between them', () => {
  assert.equal(posToValue(0), 0); assert.equal(posToValue(1), null);
  assert.equal(posToValue(valueToPos(1000)), 1000);
  const p = valueToPos(5000);
  assert.ok(p > valueToPos(1000) && p < valueToPos(10000));
});
test('typed values', () => {
  assert.equal(parseTyped('1.5k'), 1500);
  assert.equal(parseTyped('250'), 250);
  assert.equal(parseTyped(''), null);
  assert.equal(parseTyped('abc'), undefined);
  assert.equal(formatValue(10000, '∞'), '10k');
  assert.equal(formatValue(null, '∞'), '∞');
});
```

Add to `tests/e2e/run.mjs`, with the popup open at `chrome-extension://<id>/popup/popup.html`:

```js
// default values shown: share 25%, subscribers 10 to 10k, views 0 to no limit
// typing 5000 into the subscribers max box stores 5000 and keeps the handle between stops
// typing abc restores the previous value
// removing the last language is refused
// the width has no horizontal scroll at 320 px
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL, `SmallYT.scale` is undefined.

- [ ] **Step 3: Implement the popup**

Settings text: "Skip auto-dubbed videos", "My languages", "Show videos with unknown language", "Use my account for searches" with the hint "Closer to your taste, but searches appear in your YouTube history." The hidden list shows channels, phrases and seed channels, each with undo through `store.unblock`. Show the one-line paused notice when `pausedUntil` is in the future. Apply changes to `chrome.storage` right away. OFF and 0% remove cards at once; other changes apply on the next page load.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test` and `npm run e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add popup"
```

### Task 14: First run, docs and final verification

**Files:**
- Create: `src/background.js`, `welcome/welcome.html`, `welcome/welcome.css`, `welcome/welcome.js`, `AGENTS.md`, `CLAUDE.md`, `README.md`
- Modify: `manifest.json`, `tests/e2e/run.mjs`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing e2e check**

```js
// on a fresh profile, exactly one welcome tab opens; restarting with the same profile opens none
// lint: `npx web-ext lint --source-dir extension` reports 0 errors
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run e2e`
Expected: FAIL, no welcome tab.

- [ ] **Step 3: Implement the welcome flow**

`chrome.runtime.onInstalled` with reason `install` opens `welcome/welcome.html`. The page shows an inline SVG picture guide to pinning. Where `chrome.action.getUserSettings` exists, poll `isOnToolbar` every second and show a finished state. Elsewhere, keep the static guide.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run e2e`
Expected: PASS.

- [ ] **Step 5: Write the docs**

- `AGENTS.md`: what the project is, the Global Constraints above, the two-world layout, where YouTube-specific code lives, how to run unit and e2e tests, how to refresh fixtures, and what to check first when YouTube changes.
- `CLAUDE.md`: exactly one line, `@AGENTS.md`.
- `README.md`: what it does, how to install unpacked, settings, privacy, and browser status: tested in Chrome, Edge and Chromium; "untested, should work" for Brave, Opera, Vivaldi and Firefox; Safari out of scope.

- [ ] **Step 6: Run the final checks**

Run: `npm test`, `npm run e2e`, and the lint command above.
Expected: all pass.

In a logged-in Chrome, through Claude in Chrome, covering the spec's "Not yet known" list:
- The real extension finds cards on home and in the column at 25%, and fills a default page in about 40 seconds.
- Default audio skipping: no auto-dubbed video appears in 20 cards.
- Search history gets no new entries with "Use my account" off. Turning it on adds them, as its hint says.
- Watch history gets nothing from cards you don't click.
- Two YouTube tabs: only the visible one requests, and they share the budget and pause.
- A forced pause: set `pausedUntil` in storage; hidden cards return and the popup shows the notice.
- "Use my account" produces cards at the account-fetch pace, watched for one default page only.

Report anything not covered, including Firefox, Opera, ad blockers and region consent pages, which remain untested.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add welcome page and project docs"
```
