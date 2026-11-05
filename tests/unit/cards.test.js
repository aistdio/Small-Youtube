import test from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/src/youtube-page.js';
import '../../extension/src/page/cards.js';

const { verifyRendered } = globalThis.SmallYT?.cards ?? {};

test('safety check', () => {
  assert.ok(verifyRendered({ hasTitle: true, width: 352, referenceWidth: 352 }));
  assert.ok(verifyRendered({ hasTitle: true, width: 352, referenceWidth: 353 })); // 1 px tolerance
  assert.ok(!verifyRendered({ hasTitle: false, width: 352, referenceWidth: 352 }));
  assert.ok(!verifyRendered({ hasTitle: true, width: 200, referenceWidth: 352 }));
  assert.ok(!verifyRendered({ hasTitle: true, width: 0, referenceWidth: 0 })); // not rendered at all
});

test('a watch card takes its neighbour\'s layout values but none of its internal state', t => {
  const { createWatchCard } = globalThis.SmallYT.cards;
  globalThis.document = { createElement: () => ({}) };
  t.after(() => { delete globalThis.document; });
  const neighbour = {
    className: 'lockup',
    rawProps: { sizing: () => 'COMPACT', componentGap: () => 8, className: () => 'not-this', class: 'plain', data: () => ({ contentId: 'neighbour' }) },
    setters: { data: () => {} },
    owner: {},
    _signalValues: [],
  };
  const lockup = { contentId: 'mine' };
  const el = createWatchCard(lockup, neighbour);
  assert.equal(el.className, 'lockup');
  assert.equal(el.sizing, 'COMPACT');
  assert.equal(el.componentGap, 8);
  assert.equal(el.data, lockup);
  for (const internal of ['setters', 'owner', '_signalValues', 'rawProps', 'class']) assert.equal(el[internal], undefined, internal);
});

test('a nested card gets the same gap as the card holding it', t => {
  const { matchGap } = globalThis.SmallYT.cards;
  globalThis.getComputedStyle = () => ({ marginTop: '8px' });
  t.after(() => { delete globalThis.getComputedStyle; });
  const card = { style: {} };
  matchGap(card, {});
  assert.equal(card.style.marginTop, '8px');
});

test('a small card whose element YouTube reused for another video counts as recycled', () => {
  const { isRecycled } = globalThis.SmallYT.cards;
  assert.equal(isRecycled('abc', 'xyz'), true);
  assert.equal(isRecycled('abc', 'abc'), false);
  assert.equal(isRecycled('abc', null), false); // not rendered yet
  assert.equal(isRecycled(null, 'xyz'), false); // still settling, nothing remembered yet
});

// A stand-in for a click inside a page. `closest` answers the way the real card markup does.
const MARK = 'data-small-yt';
const cardShowing = videoId => ({ querySelector: () => ({ getAttribute: () => `/watch?v=${videoId}` }) });
const clickOn = (card, { type = 'click', button = 0, onVideoLink = true, onButton = false } = {}) => ({
  type,
  button,
  target: {
    closest: selector => {
      if (selector === 'button, [role="button"]') return onButton ? {} : null;
      if (selector === 'a[href*="/watch"]') return onVideoLink ? {} : null;
      if (selector === `[${MARK}]`) return card;
      throw new Error(`unexpected selector ${selector}`);
    },
  },
});

test('a click on an added card\'s video link finds that card', () => {
  const { clickedCard, remember } = globalThis.SmallYT.cards;
  const el = cardShowing('abc');
  const card = { videoId: 'abc' };
  remember(el, card);
  assert.equal(clickedCard(clickOn(el), MARK), card);
  assert.equal(clickedCard(clickOn(el, { type: 'auxclick', button: 1 }), MARK), card); // middle button
});

test('clicks that do not open the video are ignored', () => {
  const { clickedCard, remember } = globalThis.SmallYT.cards;
  const el = cardShowing('abc');
  remember(el, { videoId: 'abc' });
  assert.equal(clickedCard(clickOn(el, { type: 'auxclick', button: 2 }), MARK), null); // right button
  assert.equal(clickedCard(clickOn(el, { onVideoLink: false }), MARK), null); // channel name
  assert.equal(clickedCard(clickOn(el, { onButton: true }), MARK), null); // Watch later, on the thumbnail
});

test('a click on YouTube\'s own card is ignored', () => {
  const { clickedCard } = globalThis.SmallYT.cards;
  assert.equal(clickedCard(clickOn(null), MARK), null);
  assert.equal(clickedCard(clickOn(cardShowing('abc')), MARK), null); // marked, but nothing remembered
});

test('an added card reused by YouTube for another video does not count', () => {
  const { clickedCard, remember } = globalThis.SmallYT.cards;
  const el = cardShowing('other');
  remember(el, { videoId: 'abc' });
  assert.equal(clickedCard(clickOn(el), MARK), null);
});

test('the shown video is read from the link, which works in every card type', () => {
  const { shownVideoId } = globalThis.SmallYT.ytPage;
  const card = href => ({ querySelector: () => (href ? { getAttribute: () => href } : null) });
  assert.equal(shownVideoId(card('/watch?v=abc&list=RD1')), 'abc');
  assert.equal(shownVideoId(card(null)), null);
});
