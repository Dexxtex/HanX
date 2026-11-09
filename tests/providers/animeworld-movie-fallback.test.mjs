import assert from 'node:assert/strict';
import { test } from 'node:test';

const { AnimeWorldProvider } = await import('../../dist/providers/animeworld-provider.js');

// Le card che il sito restituisce davvero cercando "Naruto Movie 3" (verificato
// live 12/11/2026): le due schede del film più il listone generico.
const SITE_RESULTS = [
  { slug: 'naruto-movie-03-i-guardiani-del-regno-della-luna-crescente.GEr5s', name: 'Naruto Movie 03: I guardiani del Regno della Luna Crescente', searchTitle: 'Naruto Movie 03: I guardiani del Regno della Luna Crescente', language_type: 'SUB ITA' },
  { slug: 'naruto-movie-03-i-guardiani-del-regno-della-luna-crescente-t.MEWRh', name: 'Naruto Movie 03: I guardiani del Regno della Luna Crescente', searchTitle: 'Naruto Movie 03: I guardiani del Regno della Luna Crescente', language_type: 'ITA' },
  { slug: 'kuroko-no-basket-movie-2-winter-cup-namida-no-saki-e-ita.3JQEm', name: 'Kuroko no Basket Movie 2', searchTitle: 'Kuroko no Basket Movie 2', language_type: 'ITA' },
];

// Provider con ricerca simulata: le card del sito sono fixture, non fetch.
class StubProvider extends AnimeWorldProvider {
  constructor(fixtures) {
    super({ enabled: true, proxyUrl: '' });
    this.fixtures = fixtures;
    this.queries = [];
  }
  async searchAllVersions(query) {
    this.queries.push(query);
    return this.fixtures;
  }
}

test("film: il ripiego franchise+numero tiene solo le schede del film giusto", async () => {
  const p = new StubProvider(SITE_RESULTS);
  const cards = await p.movieFranchiseVersions('Naruto the Movie 3: Guardians of the Crescent Moon Kingdom');
  assert.deepEqual(
    cards.map(v => v.slug.split('.')[0]),
    [
      'naruto-movie-03-i-guardiani-del-regno-della-luna-crescente',
      'naruto-movie-03-i-guardiani-del-regno-della-luna-crescente-t',
    ]
  );
  // la query mandata al sito è senza stopword e senza numero: la ricerca è
  // letterale e "movie 1" non combacia con "Movie 01"; il numero seleziona
  // dopo, col filtro prefix+numero.
  assert.deepEqual(p.queries, ['naruto movie']);
});

test("film: numero mancante nella query + più schede del franchise = ambiguo, zero stream", async () => {
  const p = new StubProvider(SITE_RESULTS);
  const cards = await p.movieFranchiseVersions('Naruto Shippuden the Movie');
  assert.deepEqual(cards, []);
});

test("film: titolo senza il pattern 'movie N' non cerca nulla", async () => {
  const p = new StubProvider(SITE_RESULTS);
  assert.deepEqual(await p.movieFranchiseVersions('Boruto'), []);
  assert.deepEqual(p.queries, []);
});
