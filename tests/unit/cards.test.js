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

test('a small card whose element YouTube reused for another video counts as recycled', () => {
  const { isRecycled } = globalThis.SmallYT.cards;
  assert.equal(isRecycled('abc', 'xyz'), true);
  assert.equal(isRecycled('abc', 'abc'), false);
  assert.equal(isRecycled('abc', null), false); // not rendered yet
  assert.equal(isRecycled(null, 'xyz'), false); // still settling, nothing remembered yet
});

test('the shown video is read from the link, which works in every card type', () => {
  const { shownVideoId } = globalThis.SmallYT.ytPage;
  const card = href => ({ querySelector: () => (href ? { getAttribute: () => href } : null) });
  assert.equal(shownVideoId(card('/watch?v=abc&list=RD1')), 'abc');
  assert.equal(shownVideoId(card(null)), null);
});
