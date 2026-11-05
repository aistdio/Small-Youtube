# Small-Youtube

A Manifest V3 browser extension that adds videos from small channels next to YouTube's own recommendations, on the home feed and in the column beside the video being watched. There's no server. The design and its evidence are in `docs/superpowers/specs/2026-11-04-small-youtube-design.md`, so read it before changing behaviour.

## Rules that must hold

- Permissions stay `storage` and `https://www.youtube.com/*`. No server, no analytics, no outside requests.
- Never read or compute anything from login cookies, and never use `document.cookie`. Only let the browser send them.
- Search, related list, channel lookups and tags use `credentials: 'omit'`, because cookie searches write to the user's YouTube history. Page fetches (`/watch`, `/results`) are the only logged-in requests.
- No-cookie requests: at most 3 per second, 3 at once. Account page fetches: at most 1 per 2 seconds, 1 at a time. The daily request limit is the user's setting (3,000 by default, up to no limit), per browser and shared across tabs. Pauses still apply with no limit. Only the visible tab fetches.
- On 403, 429, repeated server errors or any captcha sign: stop everything for 30 minutes without retrying. On 404: skip that item. Page fetches don't follow redirects, and five redirects in a row also pause. Never try to get past a captcha.
- Cards are rendered by YouTube itself. Never set a card's size, and never change autoplay.
- Never open tabs, except the one welcome tab on install and watched-list links the user presses. Never press the confirm button in YouTube's language dialog.
- A failed card is removed, never left broken. If YouTube sends something unexpected, the feed stays as it is.
- User-facing strings live in `extension/_locales/`. Settings are one line each, and named after what the extension adds, because they don't affect YouTube's own recommendations.

## Layout

Everything the browser loads is in `extension/`. `scripts/build-firefox.mjs` copies it to `dist/firefox` with Firefox's manifest differences, because Chrome reports them as errors.

| Path | World | Job |
|---|---|---|
| `src/youtube.js` | Content | Endpoints, parsers, card builder |
| `src/youtube-page.js` | Page | Selectors, events, reading cards |
| `src/lib/settings.js`, `topic.js`, `language.js` | Content | Defaults, ranking, keep or skip rules |
| `src/lib/slots.js` | Page | Card positions from the slider |
| `src/content/` | Content | Storage, request limits, API, pipeline, bridge |
| `src/page/` | Page | Rendering, feed watching, language read, bridge |
| `popup/`, `welcome/`, `src/background.js` | Extension | Settings, pin guide, welcome tab |

The two worlds talk through `window.postMessage` with `ns: 'small-yt'`. Requests must run from the content script, because the service worker gets 403 on API search. Rendering must run in the page world, because only there can `.data` be set on YouTube's elements.

No build step for Chromium browsers. Each source file is a classic script that adds itself to `globalThis.SmallYT`, so tests can load it with a plain import:

```js
(() => { const api = { /* ... */ }; (globalThis.SmallYT ??= {}).name = api; })();
```

**YouTube reuses card elements** when a filter chip changes the feed, including ones the extension added, and keeps earlier pages hidden in the document. So name the page in selectors, and check what a marked card is showing before trusting the mark.

**YouTube goes by position when it loads more cards.** The home grid writes each entry of `data.contents` onto the element at the same position, so each added card needs its own entry (`syncList`). The watch column counts its children to place new cards, and editing its list breaks it, so watch cards are nested inside the card they follow.

**Don't list a file in two `content_scripts` entries.** Chrome injects it only once, in the first entry's world, and the other world silently breaks. A test guards this.

## Testing

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm test
```

```bash
npm run e2e
```

```bash
npm run lint
```

- `npm test`: unit tests on saved YouTube responses in `tests/fixtures/`. Run these after every change.
- `npm run lint`: builds the Firefox copy and lints it. Expect one warning about the minimum Firefox version.
- `npm run e2e`: the real extension in throwaway logged-out browsers, across languages and window sizes, plus Edge when installed. It uses real YouTube, so don't run it in a loop. Set `E2E_ONLY=chromium-en` for one setup, and `E2E_UI_ONLY=1` to skip YouTube.
- The popup must fit Chrome's 600 px limit with its lists closed, and it's nearly full. E2e checks this.
- The extension's strings follow the system language, not the e2e `locale`. To check another language, launch with `--lang=ru`.
- Logged-out home feeds are empty, so home-feed behaviour can only be checked in a logged-in browser. Load `extension/` with "Load unpacked" at `chrome://extensions`.
- Browser automation tools can make every tab report itself as visible, so background-tab behaviour can't be checked that way. A unit test covers it.
- To reload an unpacked copy from YouTube's page console: `window.postMessage({ ns: 'small-yt', from: 'page', type: 'devReload' }, location.origin)`. Then reload the tab.

## When YouTube changes something

Cards vanish or requests fail? In order:

1. Run `npm run fixtures`, then `npm test`. Failing parser tests show which response shape changed. Read the saved video titles before committing, because related lists follow the viewer's region and can include sensitive topics.
2. Fix `src/youtube.js` for data, or `src/youtube-page.js` for selectors.
3. Run `npm run e2e`, then check the home feed in a logged-in browser.

The audio track suffixes (`.4` original, `.10` auto-dub), the auto-dub icon, the AI label's shape and the menu and card data shapes are undocumented YouTube behaviour, seen in testing. Expect them to change eventually. If the AI setting stops working, nothing visibly breaks, so check it with a labelled video.

## Known minor issues

These were found in review and left for later:

- A card counter can drift after a restart. Dropped cards stay in the shown list, and stale requests aren't cancelled.
- The captcha check matches `g-recaptcha` in any short response, including JSON.
- An unreadable channel reply is cached as a hidden subscriber count for 7 days.
- Share changes apply at the next page load, so going from 100 to 25 leaves cards hidden until then.
- Keyboard users' ⋮ actions use the last card pressed with a pointer, so they could hide the wrong channel.
- Search-built cards show "6.8K" where some neighbours show "6.8K views".
- Page scripts can post bridge messages (languages, blocks, budget, watched videos, reloading an unpacked copy). They gain no privileges, but payloads aren't validated.
- The dev reload may be live in signed Firefox builds, which may have no `update_url`.
- Shared counters can lose updates, and two visible windows double the request rate.
- One startup check polls forever if `ytcfg` never appears, and the candidate pools may hold tens of MB.
- A watch-column card can show a video that YouTube's own column also shows.
