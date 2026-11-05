import test from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/src/youtube.js';
import '../../extension/src/lib/settings.js';
import '../../extension/src/lib/language.js';

const { originalLanguage, decide } = globalThis.SmallYT?.language ?? {};

const base = { skipDubbed: true, showNoSpeechVideos: false, languages: ['en', 'ru'] };
const dub = { title: 't', tracks: [{ id: 'en-US.10', isDefault: true }, { id: 'pl.4', isDefault: false }], autoCaptions: ['en', 'pl'] };
const polishOriginal = { title: 't', tracks: [{ id: 'en-US.10', isDefault: false }, { id: 'pl.4', isDefault: true }], autoCaptions: ['en', 'pl'] };
const russian = { title: 't', tracks: [{ id: 'ru.4', isDefault: true }, { id: 'en-US.10', isDefault: false }], autoCaptions: ['en', 'ru'] };
const english = { title: 't', tracks: [], autoCaptions: ['en'] };
const finnish = { title: 't', tracks: [], autoCaptions: ['fi'] };
const noSpeech = { title: 't', tracks: [], autoCaptions: [] };
const severalCaptions = { title: 't', tracks: [], autoCaptions: ['en', 'fi'] };

test('rules run in the design order', () => {
  assert.equal(decide(dub, base), 'skip');
  assert.equal(decide(polishOriginal, base), 'skip');
  assert.equal(decide(russian, base), 'keep');
  assert.equal(decide(english, base), 'keep');
  assert.equal(decide(finnish, base), 'skip');
  assert.equal(decide(noSpeech, base), 'skip');
  assert.equal(decide(severalCaptions, base), 'skip');
  assert.equal(decide(noSpeech, { ...base, showNoSpeechVideos: true }), 'keep');
  assert.equal(decide(polishOriginal, { ...base, languages: ['en', 'pl'] }), 'keep');
});

test('speech in an unclear language is not "no speech", so the setting does not add it', () => {
  const on = { ...base, showNoSpeechVideos: true };
  assert.equal(decide(severalCaptions, on), 'skip');
  assert.equal(decide({ title: 't', tracks: [{ id: 'en-US.10', isDefault: false }], autoCaptions: [] }, on), 'skip');
});

test('the setting still skips auto-dubs and AI when those are turned off', () => {
  const on = { ...base, showNoSpeechVideos: true };
  assert.equal(decide({ ...noSpeech, aiMade: true }, { ...on, showAiVideos: false }), 'skip');
});

test('skipDubbed off keeps dubs and still checks language', () => {
  assert.equal(decide(dub, { ...base, skipDubbed: false }), 'keep');
  assert.equal(decide(finnish, { ...base, skipDubbed: false }), 'skip');
});

test('a consent or sign-in page says nothing about the video, so it is always skipped', () => {
  assert.equal(decide(null, base), 'skip');
  assert.equal(decide(null, { ...base, showNoSpeechVideos: true }), 'skip');
  assert.equal(decide(null, { ...base, skipDubbed: false }), 'skip');
});

test('region codes reduce to the base language', () => {
  assert.equal(originalLanguage({ tracks: [{ id: 'en-US.4', isDefault: true }], autoCaptions: [] }), 'en');
  assert.equal(originalLanguage({ tracks: [], autoCaptions: ['pt-BR'] }), 'pt');
  assert.equal(originalLanguage(null), null);
});

test('AI-made videos stay unless the setting is off', () => {
  const ai = { ...english, aiMade: true };
  assert.equal(decide(ai, base), 'keep');
  assert.equal(decide(ai, { ...base, showAiVideos: true }), 'keep');
  assert.equal(decide(ai, { ...base, showAiVideos: false }), 'skip');
  assert.equal(decide(english, { ...base, showAiVideos: false }), 'keep');
});
