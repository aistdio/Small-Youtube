import test from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/src/youtube.js';
import '../../extension/src/lib/settings.js';
import '../../extension/src/lib/language.js';

const { originalLanguage, decide } = globalThis.SmallYT?.language ?? {};

const base = { skipDubbed: true, showUnknownLanguage: false, languages: ['en', 'ru'] };
const dub = { title: 't', tracks: [{ id: 'en-US.10', isDefault: true }, { id: 'pl.4', isDefault: false }], autoCaptions: ['en', 'pl'] };
const polishOriginal = { title: 't', tracks: [{ id: 'en-US.10', isDefault: false }, { id: 'pl.4', isDefault: true }], autoCaptions: ['en', 'pl'] };
const russian = { title: 't', tracks: [{ id: 'ru.4', isDefault: true }, { id: 'en-US.10', isDefault: false }], autoCaptions: ['en', 'ru'] };
const english = { title: 't', tracks: [], autoCaptions: ['en'] };
const finnish = { title: 't', tracks: [], autoCaptions: ['fi'] };
const unknown = { title: 't', tracks: [], autoCaptions: [] };
const severalCaptions = { title: 't', tracks: [], autoCaptions: ['en', 'fi'] };

test('rules run in the design order', () => {
  assert.equal(decide(dub, base), 'skip');
  assert.equal(decide(polishOriginal, base), 'skip');
  assert.equal(decide(russian, base), 'keep');
  assert.equal(decide(english, base), 'keep');
  assert.equal(decide(finnish, base), 'skip');
  assert.equal(decide(unknown, base), 'skip');
  assert.equal(decide(severalCaptions, base), 'skip');
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
  assert.equal(originalLanguage({ tracks: [], autoCaptions: ['pt-BR'] }), 'pt');
  assert.equal(originalLanguage(null), null);
});
