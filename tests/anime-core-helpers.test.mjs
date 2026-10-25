import assert from 'node:assert/strict';
import { test } from 'node:test';

const { isAbortOrTimeoutError, episodeTag } = await import('../dist/providers/anime-core/helpers.js');

test('isAbortOrTimeoutError riconosce abort e timeout, non un errore HTTP', () => {
  assert.equal(isAbortOrTimeoutError({ name: 'AbortError' }), true);
  assert.equal(isAbortOrTimeoutError({ name: 'TimeoutError' }), true);
  assert.equal(isAbortOrTimeoutError(new Error('HTTP 404 Not Found')), false);
  assert.equal(isAbortOrTimeoutError(null), false);
});

test('episodeTag stampa la stagione solo quando è nota', () => {
  assert.equal(episodeTag(2, 5), 'S2E5');
  assert.equal(episodeTag(null, 5), 'E5');
  assert.equal(episodeTag(null, null), '');
});
