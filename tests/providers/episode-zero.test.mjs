// Un `data-episode-num="0"` (AnimeWorld ha davvero la special in lista) non è
// "manca il numero": ripiegando su index+1 prendeva il numero dell'episodio 1
// e `episodes.find(e => e.number === 1)` restituiva il token della special.
// Nessuno può chiedere l'episodio 0 (`parsePositiveInt` richiede > 0), quindi
// scartarlo non toglie niente.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { normalizeEpisodesList } = await import('../../dist/providers/anime-core/helpers.js');
const { parseAwEpisodeNumber } = await import('../../dist/providers/animeworld-provider.js');

test("un episodio 0 esplicito non diventa l'episodio 1", () => {
  const list = normalizeEpisodesList([
    { num: 0, token: 'special' },
    { num: 1, token: 'ep1' },
    { num: 2, token: 'ep2' },
  ], 'https://example.test');

  assert.deepEqual(list.map((entry) => entry.num), [1, 2]);
  assert.equal(list.find((entry) => entry.num === 1).token, 'ep1');
});

test('senza numero resta la posizione: il fallback non è sparito', () => {
  const list = normalizeEpisodesList([
    { token: 'a' },
    { token: 'b' },
  ], 'https://example.test');

  assert.deepEqual(list.map((entry) => entry.num), [1, 2]);
});

test('parseAwEpisodeNumber: 0 esplicito è null, numero assente è fallback', () => {
  assert.equal(parseAwEpisodeNumber('0', 7), null);
  assert.equal(parseAwEpisodeNumber(0, 7), null);
  assert.equal(parseAwEpisodeNumber('', 7), 7, 'attributo vuoto = numero assente');
  assert.equal(parseAwEpisodeNumber(undefined, 7), 7);
  assert.equal(parseAwEpisodeNumber('3', 7), 3);
  // Il ramo float vale solo se il numero non è in testa: `parseInt('12.5')` è 12.
  assert.equal(parseAwEpisodeNumber('12.5', 7), 12);
  assert.equal(parseAwEpisodeNumber('ep 12.5', 7), 13);
});
