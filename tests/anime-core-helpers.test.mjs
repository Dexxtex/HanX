import assert from 'node:assert/strict';
import { test } from 'node:test';

const { isAbortOrTimeoutError, episodeTag, pickEpisodeEntry } = await import('../dist/providers/anime-core/helpers.js');

test('isAbortOrTimeoutError riconosce abort e timeout, non un errore HTTP', () => {
  assert.equal(isAbortOrTimeoutError({ name: 'AbortError' }), true);
  assert.equal(isAbortOrTimeoutError({ name: 'TimeoutError' }), true);
  assert.equal(isAbortOrTimeoutError(new Error('HTTP 404 Not Found')), false);
  assert.equal(isAbortOrTimeoutError(null), false);
});

test('pickEpisodeEntry: una scheda con un solo episodio non copre un episodio diverso', () => {
  // Caso reale: Black Clover 2 (ITA) su AnimeUnity ha solo l'episodio 1.
  const single = [{ num: 1, token: 'ep:110811', episodeId: 110811 }];
  assert.equal(pickEpisodeEntry(single, 4, 'tv'), null);
  assert.equal(pickEpisodeEntry(single, 1, 'tv')?.episodeId, 110811);
});

test('pickEpisodeEntry: nessun ripiego per indice su numerazioni non allineate', () => {
  const globalNumbering = [52, 53, 54].map((n) => ({ num: n, token: `ep:${n}`, episodeId: n }));
  assert.equal(pickEpisodeEntry(globalNumbering, 4, 'tv'), null);
  assert.equal(pickEpisodeEntry(globalNumbering, 53, 'tv')?.episodeId, 53);
});

test('episodeTag stampa la stagione solo quando è nota', () => {
  assert.equal(episodeTag(2, 5), 'S2E5');
  assert.equal(episodeTag(null, 5), 'E5');
  assert.equal(episodeTag(null, null), '');
});
