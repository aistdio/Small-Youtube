# Small-Youtube

YouTube promotes videos built for engagement, so original takes from small channels often go unseen. This browser extension adds videos from small channels next to what YouTube already recommends you, on the home feed and beside the video you're watching. The cards look exactly like YouTube's, and YouTube's own recommendations stay unless you set the share to 100%.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin the extension, as the welcome page shows.

## Settings

Click the extension's icon.

- **Small channels in your feed:** how much of your feed is small channels. The default is 25%.
- **What counts as small:** the range of subscribers (default 10 to 10k) and video views (default no limit). Drag the handles, or type a value into the box.
- **Don't add auto-dubbed videos:** on by default. The extension won't add videos YouTube would play with a robotic translation.
- **Add videos labelled as AI:** on by default. Turn it off and the extension won't add videos that carry YouTube's AI label. YouTube's own recommendations aren't affected.
- **My languages:** taken from your YouTube account once. The extension won't add videos in other languages.
- **Add videos in unknown languages:** off by default.
- **Use my account for searches:** off by default. Picks may suit your taste better, but these searches appear in your YouTube history.

In a small card's ⋮ menu, **Hide this channel** and **Less of this topic** tune what you see. You can undo both in the settings.

## Privacy

Everything stays in your browser, with no server and no analytics. The extension only talks to YouTube. It never reads your login details. To check languages and which audio YouTube would play, it loads normal YouTube pages using your account, which didn't appear in watch history in testing.

## Browsers

| Browser | Status |
|---|---|
| Chrome, Edge | Tested |
| Brave, Opera, Vivaldi, Firefox | Untested, should work |
| Safari, mobile | Not supported |

## Contributing

See [AGENTS.md](AGENTS.md) for the project's rules, layout and tests.
