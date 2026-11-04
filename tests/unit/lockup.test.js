import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.js';
import '../../extension/src/youtube.js';

const { parseSearch, parseNext, formatCount, buildLockup, setLockupTitle, addMenuEntries, pickTemplate } = globalThis.SmallYT?.yt ?? {};

const template = name => pickTemplate(parseNext(load(name), name.includes('.ru.') ? 'ru' : 'en'));

test('builds a card from a search result', () => {
  const tpl = template('next.en.json');
  const c = parseSearch(load('search.en.json'), 'en').find(x => x.id !== tpl.contentId && x.lengthSeconds && typeof x.views === 'number');
  const built = buildLockup(tpl, c, 'en');
  const s = JSON.stringify(built);
  assert.equal(built.contentId, c.id);
  assert.ok(!s.includes(tpl.contentId));
  assert.ok(!s.includes(tpl.metadata.lockupMetadataViewModel.title.content));
  assert.ok(!/trackingParams|playerParams/.test(s));
  const rows = built.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].metadataParts[0].text.content, c.channelName);
  assert.equal(rows[1].metadataParts[0].text.content, formatCount(c.views, 'en'));
  assert.equal(built.contentImage.thumbnailViewModel.image.sources[0].url, c.renderer.thumbnail.thumbnails[0].url);
  assert.ok(s.includes(c.channelId));
});

test('the template is left unchanged', () => {
  const tpl = template('next.en.json');
  const before = JSON.stringify(tpl);
  const c = parseSearch(load('search.en.json'), 'en').find(x => x.id !== tpl.contentId && x.lengthSeconds);
  buildLockup(tpl, c, 'en');
  addMenuEntries(tpl, ['x']);
  setLockupTitle(tpl, 'y');
  assert.equal(JSON.stringify(tpl), before);
});

test('menu entries and title', () => {
  const lk = addMenuEntries(template('next.ru.json'), ['Меньше по этой теме', 'Скрыть этот канал']);
  assert.ok(JSON.stringify(lk).includes('Скрыть этот канал'));
  assert.equal(setLockupTitle(lk, 'Real title').metadata.lockupMetadataViewModel.title.content, 'Real title');
});

test('a template needs an avatar', () => {
  assert.equal(pickTemplate([]), null);
  assert.equal(pickTemplate([{ lockup: { metadata: { lockupMetadataViewModel: {} } } }]), null);
});

test('a lockup without a menu or a usable shape does not throw', () => {
  const lk = { metadata: { lockupMetadataViewModel: { title: { content: 't' } } } };
  assert.deepEqual(addMenuEntries(lk, ['x']).metadata.lockupMetadataViewModel.title.content, 't');
});
