import test from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/popup/scale.js';

const { STOPS, valueToPos, posToValue, parseTyped, formatValue, shareToPos, posToShare, parseShare, isSmallTile } = globalThis.SmallYT?.scale ?? {};

test('scale snaps to stops and places typed values between them', () => {
  assert.deepEqual(STOPS, [0, 10, 100, 1000, 10000, null]);
  assert.equal(posToValue(0), 0);
  assert.equal(posToValue(1), null);
  assert.equal(posToValue(valueToPos(1000)), 1000);
  assert.equal(posToValue(0.41), 100);
  const p = valueToPos(5000);
  assert.ok(p > valueToPos(1000) && p < valueToPos(10000));
  assert.ok(valueToPos(50000) > valueToPos(10000) && valueToPos(50000) < 1);
  assert.equal(valueToPos(null), 1);
  assert.equal(valueToPos(0), 0);
  assert.ok(valueToPos(5) > 0 && valueToPos(5) < valueToPos(10));
});

test('typed values', () => {
  assert.equal(parseTyped('1.5k'), 1500);
  assert.equal(parseTyped('250'), 250);
  assert.equal(parseTyped('10K'), 10000);
  assert.equal(parseTyped('1,5к'), 1500);
  assert.equal(parseTyped('2m'), 2000000);
  assert.equal(parseTyped(' 1 000 '), 1000);
  assert.equal(parseTyped(''), null);
  assert.equal(parseTyped('∞'), null);
  assert.equal(parseTyped('abc'), undefined);
  assert.equal(parseTyped('-5'), undefined);
  assert.equal(formatValue(10000, '∞'), '10k');
  assert.equal(formatValue(1500, '∞'), '1.5k');
  assert.equal(formatValue(2000000, '∞'), '2M');
  assert.equal(formatValue(250, '∞'), '250');
  assert.equal(formatValue(null, '∞'), '∞');
});

test('the share slider has its own stops, and typed shares sit between them', () => {
  assert.equal(shareToPos(0), 0);
  assert.equal(shareToPos('random'), 1);
  assert.equal(posToShare(shareToPos(50)), 50);
  assert.equal(posToShare(1), 'random');
  assert.equal(posToShare(0.21), 25);
  assert.ok(shareToPos(30) > shareToPos(25) && shareToPos(30) < shareToPos(50));
  assert.equal(parseShare('30'), 30);
  assert.equal(parseShare('30%'), 30);
  assert.equal(parseShare('Random', 'Random'), 'random');
  assert.equal(parseShare('случайно', 'Случайно'), 'random');
  assert.equal(parseShare('150'), undefined);
  assert.equal(parseShare('abc'), undefined);
});

test('the preview lights tiles in the same rhythm as the feed', () => {
  const lit = percent => Array.from({ length: 12 }, (_, i) => isSmallTile(i, percent)).filter(Boolean).length;
  assert.equal(lit(0), 0);
  assert.equal(lit(25), 3);
  assert.equal(lit(50), 6);
  assert.equal(lit(100), 12);
  assert.equal(isSmallTile(3, 25), true);
  assert.equal(isSmallTile(0, 25), false);
});
