import test from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/src/lib/slots.js';

const { resolveShare, smallCardsOwed, targetAfter, placeAfter, mayRequest, cardStillWanted, cardsToMove, createGeneration } = globalThis.SmallYT?.slots ?? {};

test('slider ratios from the design', () => {
  assert.equal(smallCardsOwed(30, 0), 0);
  assert.equal(smallCardsOwed(30, 25), 10);
  assert.equal(smallCardsOwed(30, 50), 30);
  assert.equal(smallCardsOwed(30, 75), 90);
  assert.equal(smallCardsOwed(30, 100), 30); // one replacement each
  assert.equal(smallCardsOwed(2, 25), 0);
  assert.equal(smallCardsOwed(3, 25), 1);
  assert.equal(targetAfter(0, 25), 3);
  assert.equal(targetAfter(1, 25), 6);
  assert.equal(targetAfter(0, 50), 1);
  assert.equal(targetAfter(2, 75), 1);
  assert.equal(targetAfter(3, 75), 2);
});

test('random picks a new share within range', () => {
  assert.equal(resolveShare(50, Math.random), 50);
  assert.equal(resolveShare(0, Math.random), 0);
  const r = resolveShare('random', () => 0.5);
  assert.ok(r >= 1 && r <= 99);
  assert.equal(resolveShare('random', () => 0), 1);
  assert.equal(resolveShare('random', () => 0.9999), 99);
});

test('positions never land above the screen', () => {
  assert.deepEqual(placeAfter(0, 25, 12, 0), { position: 12, offset: 9 });
  assert.deepEqual(placeAfter(5, 25, 2, 0), { position: 18, offset: 0 });
});

const positions = (percent, firstBelow, count) => {
  let offset = 0;
  return Array.from({ length: count }, (_, i) => {
    const placed = placeAfter(i, percent, firstBelow, offset);
    offset = placed.offset;
    return placed.position;
  });
};

test('cards keep the slider spacing even when they all start below the screen', () => {
  assert.deepEqual(positions(25, 12, 3), [12, 15, 18]);
  assert.deepEqual(positions(50, 12, 2), [12, 13]);
  assert.deepEqual(positions(75, 9, 6), [9, 9, 9, 10, 10, 10]); // never one big block
});

test('requests stay near the screen at every share', () => {
  const limit = 2000;
  const ask = over => mayRequest({ percent: 25, anchorTop: 500, lastSmallTop: null, hasShownBelow: true, limit, ...over });
  assert.equal(ask({}), true);
  assert.equal(ask({ anchorTop: 3000 }), false);
  assert.equal(ask({ anchorTop: null }), true);
  // Above 50% the anchor barely moves, so the last small card decides.
  assert.equal(ask({ percent: 90, anchorTop: 100, lastSmallTop: 3000 }), false);
  assert.equal(ask({ percent: 90, anchorTop: 100, lastSmallTop: 500 }), true);
  assert.equal(ask({ percent: 90, anchorTop: 100, lastSmallTop: null }), true);
  assert.equal(ask({ percent: 75, anchorTop: 100, lastSmallTop: 3000 }), false);
  // At 100% a request is pointless with no YouTube card left below the screen to replace.
  assert.equal(ask({ percent: 100, hasShownBelow: false }), false);
  assert.equal(ask({ percent: 100, lastSmallTop: 500 }), true);
  assert.equal(ask({ percent: 100, lastSmallTop: 3000 }), false);
});

test('a rendered card is kept only if nothing changed while it rendered', () => {
  const ok = { current: true, on: true, paused: false, replacing: false, replacedBelow: false };
  assert.equal(cardStillWanted(ok), true);
  assert.equal(cardStillWanted({ ...ok, current: false }), false);
  assert.equal(cardStillWanted({ ...ok, on: false }), false);
  assert.equal(cardStillWanted({ ...ok, paused: true }), true); // an added card hides nothing
  assert.equal(cardStillWanted({ ...ok, replacing: true, replacedBelow: true }), true);
  assert.equal(cardStillWanted({ ...ok, replacing: true, replacedBelow: true, paused: true }), false);
  assert.equal(cardStillWanted({ ...ok, replacing: true, replacedBelow: false }), false); // would swap in view
});

test('rows stay complete before full-width sections', () => {
  assert.equal(cardsToMove(7, 3), 1);
  assert.equal(cardsToMove(6, 3), 0);
  assert.equal(cardsToMove(8, 3), 2);
  assert.equal(cardsToMove(0, 3), 0);
  assert.equal(cardsToMove(5, 0), 0); // unknown row size
});

test('a late answer from an old page is rejected', () => {
  const g = createGeneration();
  const asked = g.current();
  assert.equal(g.isCurrent(asked), true);
  g.bump();
  assert.equal(g.isCurrent(asked), false);
  assert.equal(g.isCurrent(g.current()), true);
});
