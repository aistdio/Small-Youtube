# Small-Youtube: design

A browser extension that adds videos from small channels to YouTube, next to what YouTube already recommends.

"Small-Youtube" is a working name. Check it against YouTube's brand rules before publishing to a store.

## Why

YouTube promotes engaging, optimized content. Original or unpopular takes from small channels get buried, even when they are exactly what a viewer would value.

The target is a breakout from a tiny channel, such as 20k views on about 300 subscribers (about 66 views per subscriber), not a video nobody saw.

## Goals

- Add small-channel videos to the home feed and to the column beside the video being watched.
- Stay near the topics YouTube already shows the viewer.
- Keep everything inside the browser: no server, no analytics.
- Work in Chrome and other popular browsers from one codebase.
- Be easy for other people and their AI tools to modify.

## Non-goals (first version)

Mobile, Safari, the Shorts feed, accounts, a server, and community lists of good channels.

## Anti-goals: failure even if it technically works

- Opening tabs or otherwise taking control of the browser. Searching in a new tab was considered and rejected. The one-time welcome tab on install is the only exception.
- Removing YouTube's recommendations when the viewer didn't ask for that.
- Showing force-dubbed videos.
- Giving users captchas, or trying to get past one.
- Writing to a user's YouTube history by default.
- Distracting cards: spinners, page jumps, flicker.
- Settings that are too long to read.

## How it works

For each small card to add:

1. **Watch the page** for new cards. This covers scrolling and YouTube's in-page navigation.
2. **Pick a seed.** Home feed: a random YouTube video card near the next open position (see step 8), excluding ads, Shorts, mixes and live streams. Watch page: the video being watched, which supplies every card in that column.
3. **Collect candidates, without cookies,** from the seed's related list and from a keyword search. Keywords come from the title (remove hashtags, emoji, brackets, channel name, "part N", stop words) plus the video's tags. Keep the extra results to fill later cards.
4. **Cheap filters:** view range, at least 60 seconds, not a Short, mix, live stream or premiere, not the seed's channel, not a near-copy of the seed's title, no hidden channel or muted topic, not already shown. To save lookups, also skip videos over 300k views, even when the views range has no upper limit. Drop this cutoff when the chosen minimum is 300k or more.
5. **Subscriber filter:** go through the remaining candidates, on-topic ones first, and look up at most 8 channels per card. Keep those in the subscriber range, and drop channels that hide their count. Cache counts for 7 days, and cached channels don't count toward the 8.
6. **Rank:** on-topic videos (seed keywords in the title) go before off-topic ones. Inside each group, sort by views per subscriber, counting 0 subscribers as 1. Take the first 3, or fewer if fewer qualify, and pick one at random so results vary. Never pick "least views".
7. **Language check** on the chosen video only (rules below). If it fails, take the next candidate in the ranking.
8. **Insert** the card in the next open position below what the viewer is looking at, with a quiet fade-in. Positions come from the slider ratio, not from the seed, so spacing stays even. A card usually lands near its seed, but that isn't guaranteed. Slow cards simply take a later position. If nothing qualifies, add nothing.

The home feed needs seeds. On an empty home feed, such as a logged-out browser with no history, add nothing there. The watch page still works.

## Language check

Fetch the video's normal page with the user's account, so YouTube's own decision for that user is visible. Checks run in this order:

| What the page shows | Result |
|---|---|
| Default audio is an auto-dub (track id ends `.10`) | Skip |
| Original language is in "My languages" | Keep |
| Original language is not in "My languages" | Skip |
| No clear language | Skip, unless "Show videos with unknown language" is on |

Related-list cards sometimes already carry YouTube's "Auto-dubbed" label. Skip those early, before spending a page fetch. The label's text is localized, but its `iconName` (`PERSON_RADAR_FILLED`) isn't, so match on that.

The original language comes from the track id ending `.4`, or from the single auto-caption language when there are no tracks.

Default audio alone isn't enough. In a German test browser, a Polish video played its Polish original because it had no German dub. That doesn't mean the viewer understands Polish, so the language must also match.

With "Add videos labelled as AI" off, a video carrying YouTube's AI label is skipped first. The label's text is localized, so match on what isn't: a `howThisWasMadeSectionViewModel` section plus a `videoPrimaryInfoRenderer` badge with `iconType` `INFO`. Videos whose creators didn't declare AI use carry no label, so they can't be caught.

**Where "My languages" comes from:**

- **Logged in:** the account's preferred languages plus YouTube's display language. The display language is needed because it may not be in the list: the tested account's list left it out. Region codes are reduced to the base language.
- **Logged out, or if reading the list fails:** English plus the browser's language.
- Users can add and remove languages in the popup. Changes stay saved and never touch the YouTube account's own settings. At least one language must remain.

**How the list is read:** the first time `ytcfg` reports a logged-in user, load `/account_playback` in a hidden same-site frame. This happens once: save the result and don't read it again. A failed attempt doesn't count, so retry on a later page load, at most once a day. Find the settings link by structure, not by its text, which is localized: the attributed-string link without an external `href`. Open the dialog with synthetic pointer and mouse events, read the checked rows, and map their labels to codes through the `get_panel` response. Then remove the frame. Never press the dialog's confirm button. YouTube's own code makes the signed request, so the extension never touches a login secret.

With "Skip auto-dubbed videos" off, a video whose default audio is an auto-dub is kept. Every other video still goes through the language rules, so the page fetch, "My languages" and the unknown-language setting all stay in use.

## Using the account

| Request | Cookies | Why |
|---|---|---|
| Search, related list, channel lookup, tags | No | Cookie searches write to the user's history |
| Language check | Yes | Only the account shows what YouTube would play |
| Language list | Yes, through YouTube's own page in a hidden frame | Only the account holds the list |
| Search and related list, with "Use my account for searches" on | Yes, through full page fetches (`/results`, `/watch`) | Closer to the user's taste, but searches enter history |

Never read or compute anything from the user's login cookies. Only let the browser send them.

"Use my account for searches" can't use the API, because cookies alone stay logged out there. Each card then needs about 3 account page fetches instead of 1. A default feed page takes about 30 account fetches, at least 60 seconds and about 7 MB (estimate). This mode hasn't been load-tested.

## Share slider

Share means the part of the feed made of small cards. All YouTube cards stay unless the slider is at 100%.

| Slider | Result |
|---|---|
| 0% | Nothing added |
| 25% (default) | 1 small card per 3 YouTube cards |
| 50% | 1 per 1 |
| 75% | 3 per 1 |
| 100% | Small cards replace YouTube's as they render (see below) |
| Random | A new share on each feed load |

The value box also accepts any whole percent between the stops.

At 100%, hide a YouTube card only after its replacement has rendered, and only below the screen so nothing swaps in view. If no replacement is found, YouTube's card stays. On a pause, the daily limit or OFF, bring every hidden card back. The feed is never left blank.

The same slider applies to the watch-page column. Never change autoplay.

## Popup

From top to bottom:

- **Share slider:** snapping stops as above.
- **Divider** with the text "What counts as small".
- **Subscribers range:** two handles; stops at 0, 10, 100, 1k, 10k, no limit; default 10 to 10k.
- **Views range:** two handles; same stops; default 0 to no limit.
- Each slider shows its value on the right in a box the user can click and type into, including values between stops.
- **Settings**, one line each:
  - Skip auto-dubbed videos (on)
  - Add videos labelled as AI (on)
  - My languages: English ×, German ×, French ×, + (example; filled automatically)
  - Show videos with unknown language (off)
  - Use my account for searches (off). Hint: "Closer to your taste, but searches appear in your YouTube history."
- **Hidden channels and topics:** a small link to the list, with undo.
- **ON/OFF button** at the very bottom.
- When paused by a rate limit, one short line says so.

## Cards

Cards are rendered by YouTube itself, not imitated, so they match its look in any theme, language or layout. There is no badge or extra button.

- **Card data:** related-list results already contain a lockup. Search results use a different format (`videoRenderer`), so build their lockup from a related-list lockup used as a template, swapping the video ID, title, thumbnail, avatar, channel, views, age and length. Drop the template's tracking and player params, and any extra rows such as "New". A smoke test passed; if this stops working, use search only to reach more related lists.
- **Home feed:** create a `ytd-rich-item-renderer` and set its `data` to `{ content: { lockupViewModel } }`.
- **Watch column:** create a `yt-lockup-view-model` and copy the neighbouring card's non-data properties before setting `data`. Setting `data` alone renders a tall card (310 px vs 124 px). Adding to the column's own `results` data also broke at narrow width (2,961 px), so don't use it.
- **Size:** never set a size. Cards take it from YouTube's layout, the same as their neighbours.
- **Title:** use the title from the language-check page. No-cookie data may be machine-translated, while that page shows what this user would normally see.
- **⋮ menu:** add two entries to the lockup's own menu data, then catch their clicks before YouTube handles them:
  - **Hide this channel:** never show this creator again.
  - **Less of this topic:** mute one best phrase from the seed, such as "Epic Seven", matched whole in titles. Matching videos are no longer picked, and matching YouTube cards stop being seeds. The phrase appears in the hidden list, so a bad guess is easy to undo. If there's no clear phrase, stop using that seed's channel as a source instead.
- This is stored locally. YouTube isn't told, so its own recommendations don't change.
- **Rows:** adding a card can leave a gap before a full-width section such as the Shorts row. Keep rows complete using `--ytd-rich-grid-items-per-row`.
- **Safety:** after rendering, compare the card with a visible neighbour, or at 100% with a width recorded before hiding YouTube's cards. If the title is missing or the width differs, remove it. A missing card is fine, a broken one isn't. Don't compare height strictly, because longer titles make stacked cards taller.

Known difference: no-cookie data gives a shorter menu (Add to queue, Download, Share) without YouTube's Watch later or Not interested. Removing this difference isn't required for the first version.

## First run

On install, open a welcome tab with a picture guide to pinning the extension. An extension can't pin itself. Where supported, detect pinning with `chrome.action.getUserSettings` and finish the guide automatically.

## Load rules

YouTube publishes no limits for these requests, so these are conservative.

- No-cookie requests: at most 3 per second, 3 at once.
- Account page fetches: at most 1 per 2 seconds, 1 at a time.
- About 3,000 requests a day per browser. After that, add no new cards until the next day.
- Fetch only for cards near the screen, and only in the visible tab, so several open tabs don't multiply the rate. Keep the request counters and the pause flag in `chrome.storage`, so all tabs share them.
- On a 403, 429, repeated server errors or any captcha sign: stop everything for 30 minutes without retrying. All YouTube cards stay visible during the pause.
- On a 404, skip that video or channel and carry on.

A default feed page takes at most about 120 requests and 5 MB before caching (estimate), and about 40 seconds to fill. That's fine, because cards appear quietly and nothing waits on them.

## Measured so far

Tested on 2026-11-04 on one connection. Load and history tests ran as page scripts in a logged-in Chrome. A throwaway real extension then ran in logged-out test browsers: Chromium in English, German, Arabic and a cookie probe, plus real Edge, at widths showing 2, 3 and 4 cards per row.

| Real extension test | Result |
|---|---|
| Search, related, channel, tags and page requests from the content script | Worked in all 5 setups |
| The same search from the background service worker | 403 in all 5, so requests must run from the content script |
| `credentials` from the content script | `include` sends cookies, `omit` doesn't (checked with a test cookie) |
| Native watch-column card, click-through | Opens without a page reload in all 5 |
| `ytcfg` | Not visible to the content script, visible in the page world; the client version can be read from the page HTML |
| Logged-out home feed | Empty in all 5 |

Native cards also passed in a logged-in Chrome: home card look, ⋮ menu with added entries, and our click handler running instead of YouTube's action.

| Real extension in a logged-in Chrome | Result |
|---|---|
| Home feed at 25% | Cards native-looking, same size as neighbours, rows complete, no page jump |
| Account languages | Read once, saved, frame removed |
| ⋮ menu | Both entries work; card removed, no Share dialog, block saved |
| 100% | 3 cards replaced below the screen after about 30 s; nothing on screen changed |
| Forced pause | All hidden cards came back |
| OFF | All small cards removed without a reload |
| Language check | 0 of the last 10 picks default to an auto-dub |
| Watch history after 43 picks shown, none clicked | 0 appeared |
| Search history, defaults | 0 new entries |
| Search history, "Use my account" on for about 30 s | 4 new entries, as its hint warns; 4 cards |

| Size and account-list test | Result |
|---|---|
| Home card vs neighbour at 2, 3, 4, 5 and 6 per row (logged-in Chrome, row count forced by CSS) | Same width and height; thumbnail within 1 px |
| Watch-column card vs neighbour at 1280, 1920 and 2560 px wide | Identical, including thumbnail |
| Watch-column card at 900 px, where cards stack | Same width and thumbnail, 20 px taller (likely an extra title line) |
| Card built from a search result, watch column (logged-out test browser, page script) | Correct text, thumbnail and link; same size as neighbour; no template data left; still in place after 4 s; ⋮ menu opens; click opens the right video without a reload |
| Card built from a search result, home feed (logged-in Chrome, page script, not clicked) | Correct text, thumbnail and avatar; same size as neighbour; looks like its neighbours |
| Reading the language list through the hidden frame (page script in a logged-in Chrome) | Returned the account's languages, matching the settings dialog, in about 3 s; main page title and focus unchanged; about 28 KB in the run that measured it |

| Load and history test | Result |
|---|---|
| Most likely load, without the language check: 25%, one feed page | 39 requests, 10 s, 10 of 10 cards, no blocks |
| Max load, without the language check: 100%, fast scrolling, capped at 5 per second | 331 requests, 67 s, 62 of 72 cards, no blocks |
| Language check with account | 50 fetches in 109 s, no captcha, about 1.1 s each, about 160 KB each |
| Watch history after account page fetches | 0 of 56 test videos appeared |
| Cookie search, 6 queries | All 6 appeared in search history |
| No-cookie searches, 3 phrases checked | None appeared in search history |
| Auto-dub check on 6 reviewed picks | Flagged only the one rejected in review |

Other facts:

- `/youtubei/v1/search`, `next` and `browse` work with `credentials: 'omit'`.
- With cookies, these API calls still return `loggedOut: true`. Only normal page fetches (`/results`, `/watch`) are logged in.
- Without cookies, `/youtubei/v1/player` returns `UNPLAYABLE` and no audio tracks, but does return the original title and tags.
- The default audio track in a no-cookie page fetch reflects location rather than the user's account, so it can't drive the skip rule.
- Search results have no subscriber count. `browse` with the videos tab returns it at about 33 KB. Channel search returns it in a misnamed `videoCountText` field.
- With `hl=en`, titles come back machine-translated. With another `hl`, counts are localized ("68 тыс."). Cards must show the user's language and parse counts correctly.
- Home feed cards are `yt-lockup-view-model` inside `ytd-rich-item-renderer`.

Quality signal so far: of 5 picks reviewed by hand, 4 passed on quality, and 1 failed only on language. Topic detection is the weakest part: title-only keywords found the topic for 3 of 10 seeds.

## Not yet known

- The hidden-frame language lookup on accounts using other display languages.
- Whether background tabs really hold their requests in a real browser. It's unit-tested, but the automation tool makes every tab report itself as visible.
- On template-built cards: hover preview, and what the ⋮ menu actions do when clicked.
- Getting the short view count from search results in every language. Removing the last word worked for English and Russian, but won't work everywhere.
- The combined ranking and the keywords-plus-tags method, which haven't been tested end to end.
- Behavior over hours of daily use or on shared connections such as VPNs.
- Firefox, Opera and Safari, ad blockers and other YouTube extensions, YouTube Premium or restricted accounts, and the consent page shown in some regions, which could block no-cookie page fetches.
- How the native cards survive YouTube layout experiments. Other users may see different card types than the ones tested.
- The `.4` and `.10` track pattern is undocumented and seen on a small sample. Keep it in one place.
- Whether account page fetches influence recommendations. They didn't appear in watch history.

## Browsers

One Manifest V3 codebase in plain JavaScript with no framework. Chrome, Edge, Brave, Opera and Vivaldi should run it unchanged. Firefox needs small manifest differences; check them with `web-ext lint`. Safari is out of scope. Tested so far: the real extension in Chromium and Edge, and page scripts in Chrome. The README marks the others "untested, should work".

## Repository and docs

- Two scripts on the page: a content script for requests and storage, and a page-world script (`"world": "MAIN"`) for rendering cards. They talk by window messages.
- All YouTube-specific code lives in two files, `src/youtube.js` (endpoints, parsers, card builder) and `src/youtube-page.js` (selectors, events, reading cards), so a YouTube change has one small place to fix. It can't be one file: Chrome injects a file listed in two `content_scripts` entries only once, in the first entry's world.
- `AGENTS.md`: how to work on the project and how to test it.
- `CLAUDE.md`: one line, `@AGENTS.md`.
- `README.md`: what it is, how to install, browser status.
- Permissions: storage and youtube.com only.

## Testing

- Unit tests for parsers and selection logic, using saved YouTube responses.
- Automated real-extension runs in separate logged-out test browsers across locales and window sizes.
- Logged-in checks in Chrome through the Claude in Chrome connection. The tester loads the unpacked extension once.

## Designer's calls, not yet confirmed

- Slider ratios, 100% gradually replacing YouTube's cards, and "Random" meaning a new share per feed load.
- Positions coming from the slider ratio rather than the seed, and fetching only in the visible tab.
- "Skip auto-dubbed videos" off meaning dubbed videos are allowed while other videos still get the language rules.
- The same slider on the watch page.
- Ranking details: pick among the top 3, 8 lookups per card, 60-second minimum, 300k pre-filter, near-copy filter.
- The two ⋮ menu choices and how "Less of this topic" works.
- All load numbers, the 7-day cache and the 30-minute pause.
- Retrying the language-list read at most once a day until it succeeds, and not adding English automatically when the account's list is available.
- Plain JavaScript with no framework.
- A license still needs choosing before sharing the project.

## Left to the builder

File structure, how rows are kept complete, how the muted phrase is chosen, exact keyword cleaning, the topic-match score, cache storage format, and a development auto-reload helper.
