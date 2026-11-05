import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.js';
import '../../extension/src/youtube.js';

const { parseSearch, parseNext, formatCount, buildLockup, setLockupTitle, addMenuEntries, addSmallCreatorLabel, pickTemplate } = globalThis.SmallYT?.yt ?? {};

const template = name => pickTemplate(parseNext(load(name), name.includes('.ru.') ? 'ru' : 'en'));
const rowsOf = lockup => lockup.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows;

test('the Small Creator label comes right after the date', () => {
  const tpl = template('next.ru.json');
  const [views, date] = rowsOf(tpl)[1].metadataParts;
  const parts = rowsOf(addSmallCreatorLabel(tpl, 'Small Creator'))[1].metadataParts;
  assert.deepEqual(parts, [views, date, { text: { content: 'Small Creator' } }]);
});

test('the label reaches screen readers too', () => {
  const tpl = template('next.en.json');
  const label = addSmallCreatorLabel(tpl, 'Small Creator').rendererContext.accessibilityContext.label;
  assert.equal(label, `${tpl.rendererContext.accessibilityContext.label}, Small Creator`);
});

test('the label works on a card built from a search result', () => {
  const tpl = template('next.en.json');
  const c = parseSearch(load('search.en.json'), 'en').find(x => x.id !== tpl.contentId && x.lengthSeconds && typeof x.views === 'number');
  const parts = rowsOf(addSmallCreatorLabel(buildLockup(tpl, c, 'en'), 'Small Creator'))[1].metadataParts;
  assert.equal(parts[parts.length - 1].text.content, 'Small Creator');
});

test('a card with no views row keeps its shape, because the feed must stay as it is', () => {
  const tpl = template('next.en.json');
  const oneRow = addMenuEntries(tpl, []);
  rowsOf(oneRow).splice(1);
  assert.deepEqual(addSmallCreatorLabel(oneRow, 'Small Creator'), oneRow);
  assert.deepEqual(addSmallCreatorLabel({}, 'Small Creator'), {});
});

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
  addSmallCreatorLabel(tpl, 'z');
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

test('added menu entries have their own icons and no borrowed action', () => {
  const lk = addMenuEntries(template('next.en.json'), ['Less of this topic', 'Hide this channel']);
  const find = value => {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value.listItems)) return value.listItems;
    for (const k in value) {
      const found = find(value[k]);
      if (found) return found;
    }
    return null;
  };
  const items = find(lk.metadata.lockupMetadataViewModel.menuButton);
  const [less, hide] = items.slice(-2).map(i => i.listItemViewModel);
  assert.equal(less.leadingImage.sources[0].clientResource.imageName, 'NOT_INTERESTED');
  assert.equal(hide.leadingImage.sources[0].clientResource.imageName, 'REMOVE_CIRCLE');
  assert.equal(less.rendererContext?.commandContext, undefined);
  assert.equal(hide.rendererContext?.commandContext, undefined);
  assert.ok(!JSON.stringify(items.slice(-2)).includes('get_share_panel'));
});
