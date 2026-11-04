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
