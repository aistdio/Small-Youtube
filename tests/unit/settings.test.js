import test from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/src/lib/settings.js';

const { DEFAULTS, normalize, initialLanguages, mergeAccountLanguages, removeLanguage } = globalThis.SmallYT?.settings ?? {};

test('defaults match the design', () => {
  const d = DEFAULTS;
  assert.equal(d.share, 25);
  assert.equal(d.subsMin, 10);
  assert.equal(d.subsMax, 10000);
  assert.equal(d.viewsMin, 0);
  assert.equal(d.viewsMax, null);
  assert.equal(d.skipDubbed, true);
  assert.equal(d.showUnknownLanguage, false);
  assert.equal(d.useAccountForSearches, false);
  assert.equal(d.enabled, true);
  assert.equal(d.showAiVideos, true);
});

test('odd settings become valid', () => {
  assert.equal(normalize({ share: 33 }).share, 33); // typed into the value box
  assert.equal(normalize({ share: 150 }).share, 25);
  assert.equal(normalize({ share: 'x' }).share, 25);
  assert.equal(normalize({ share: 'random' }).share, 'random');
  assert.equal(normalize({ subsMin: 'abc' }).subsMin, 10);
  const swapped = normalize({ subsMin: 5000, subsMax: 100 });
  assert.deepEqual([swapped.subsMin, swapped.subsMax], [100, 5000]);
  assert.equal(normalize({ viewsMin: -5 }).viewsMin, 0);
  assert.ok(normalize({ languages: [] }).languages.length >= 1);
  assert.equal(normalize({ viewsMax: null }).viewsMax, null);
  assert.equal(normalize({ subsMin: 200, subsMax: null }).subsMin, 200);
  assert.equal(normalize(null).share, 25);
  assert.equal(normalize({ skipDubbed: 'yes' }).skipDubbed, true);
  assert.equal(normalize({ showAiVideos: 'no' }).showAiVideos, true);
  assert.equal(normalize({ showAiVideos: false }).showAiVideos, false);
});

test('language defaults', () => {
  assert.deepEqual(initialLanguages('ru-RU'), ['en', 'ru']);
  assert.deepEqual(initialLanguages('en-US'), ['en']);
  assert.deepEqual(mergeAccountLanguages(['en', 'en-US', 'ja'], 'ru'), ['en', 'ja', 'ru']);
  assert.deepEqual(removeLanguage(['en', 'ru'], 'en'), ['ru']);
  assert.deepEqual(removeLanguage(['ru'], 'ru'), ['ru']);
});

const { shouldReadLanguages, applyAccountLanguages } = globalThis.SmallYT?.settings ?? {};
const DAY = 86400000;

test('reads once, retries at most daily', () => {
  assert.ok(shouldReadLanguages({ done: false, lastTry: 0 }, DAY));
  assert.ok(!shouldReadLanguages({ done: true, lastTry: 0 }, DAY * 9));
  assert.ok(!shouldReadLanguages({ done: false, lastTry: DAY }, DAY + 1000));
  assert.ok(shouldReadLanguages({ done: false, lastTry: DAY }, DAY * 2 + 1));
  assert.ok(shouldReadLanguages(undefined, DAY));
});

test("account languages replace defaults, but not the user's edits", () => {
  const s = { ...DEFAULTS, languages: ['en', 'ru'], languagesEdited: false };
  assert.deepEqual(applyAccountLanguages(s, ['en', 'en-US', 'ja'], 'ru').languages, ['en', 'ja', 'ru']);
  assert.deepEqual(applyAccountLanguages({ ...s, languagesEdited: true }, ['ja'], 'ru').languages, ['en', 'ru']);
});
