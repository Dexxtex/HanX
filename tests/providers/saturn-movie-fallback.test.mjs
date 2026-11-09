import assert from 'node:assert/strict';
import { test } from 'node:test';

const { AnimeSaturnProvider } = await import('../../dist/providers/animesaturn-provider.js');

class StubSaturn extends AnimeSaturnProvider {
  constructor() {
    super({ enabled: true, proxyUrl: '' });
    this.queries = [];
  }
  async searchAllVersions(query) {
    this.queries.push(query);
    return [];
  }
}

// I film con scheda italiana sul sito e titolo TMDB divergente ("Naruto: Il
// film - ..."): la ricerca letterale non attraversa il prefisso, quindi la
// coda italiana del titolo TMDB deve arrivare tra i ripieghi.
test('film: la coda italiana del titolo TMDB entra tra i ripieghi', async () => {
  const p = new StubSaturn();
  await p.handleTitleRequest(
    'Naruto the Movie 1: Ninja Clash in the Land of Snow',
    null,
    1,
    true,
    'Naruto Movie 1: Dai Katsugeki!! Yuki Hime Ninpouchou Dattebayo!',
    'Naruto: Il film - La primavera nel Paese della Neve'
  );
  assert.ok(
    p.queries.some(q => q.toLowerCase() === 'la primavera nel paese della neve'),
    'la coda italiana non è stata provata. Query: ' + JSON.stringify(p.queries)
  );
});

// Le serie restano sul budget a due ripieghi: il romaji prima dei fallback.
test('serie: il romaji è il primo ripiego, budget due', async () => {
  const p = new StubSaturn();
  await p.handleTitleRequest('Kaze no Stigma', null, 1, 1, false, 'Kaze no Stigma', 'Kaze no Stigma', null, null);
  assert.ok(p.queries.length <= 3, 'query: ' + JSON.stringify(p.queries));
  assert.ok(p.queries[0].toLowerCase().includes('kaze'), 'la prima query usa il titolo: ' + JSON.stringify(p.queries));
});

// "Snow Fairy" è una query di ripiego troncata: l'unico risultato del sito
// ("A Little Snow Fairy Sugar") è un'altra opera, e veniva servito.
test('unico risultato di una query di ripiego: non si accetta senza match', async () => {
  const { filterAnimeResults } = await import('../../dist/providers/animesaturn-provider.js');
  const results = [{ version: { title: 'A Little Snow Fairy Sugar', url: '/anime/x' }, language_type: 'SUB ITA' }];
  // Query di ripiego: nessun match di titolo -> scartato.
  assert.deepEqual(filterAnimeResults(results, ['Yuki: Snow Fairy', 'Snow Fairy'], false), []);
  // Titolo richiesto: l'euristica resta valida.
  assert.equal(filterAnimeResults(results, ['Yuki: Snow Fairy'], true).length, 1);
});
