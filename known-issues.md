# Known issues

## Ceiling on added videos

It's about fixing the ceiling of how many videos the app can realistically add. Right now it's about 56% of feed, and it can't be more since requests are not optimized. So it's required to do further optimization (either by reducing fetch time from 2 s to 1 s, giving users a slider maybe like other ones; or by some other optimization like keeping found unshown videos (the videos that app gathered successfully but user didn't scroll enough to see them)).

## No hover preview on added videos

YouTube's own videos play a preview when the mouse is over them, but added videos show nothing.

## Minor issues

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
