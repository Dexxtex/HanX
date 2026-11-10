import assert from 'node:assert/strict';
import { test } from 'node:test';

// `fetch-resource` cattura `globalThis.fetch` all'import: lo stub va installato
// PRIMA di importare il provider. Prima era assegnato dentro il test, quindi
// non aveva effetto e quel caso parlava con i siti veri.
let fetchBehavior = async () => { throw new Error('rete non stubata in questo test'); };
globalThis.fetch = async (input) => fetchBehavior(input);

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


// Il catalogo matcha per titolo ("Quando c'era Marnie" per "When Marnie Was
// There"): lo slug è in un'altra lingua e il filtro stretto lo scartava prima
// ancora di provare la scheda. Catalogo fixture + rete stubbata.
test('film dal catalogo: lo slug in un altra lingua non viene scartato', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-aw-marnie-'));
  fs.writeFileSync(
    path.join(dir, 'catalog-titles.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      sites: {
        world: [
          {
            slug: 'quando-cera-marnie.W3Cwk',
            url: 'https://www.animeworld.ac/play/quando-cera-marnie.W3Cwk',
            title: "Quando c'era Marnie",
            key: '',
          },
        ],
      },
    })
  );
  process.env.CATALOG_DIR = dir;

  const PLAY = '<html><a data-id="tok1" data-episode-num="1" href="/play/quando-cera-marnie.W3Cwk/tok1">Ep 1</a></html>';
  const PLAYER = '<html>file: "https://cdn.example.test/marnie.mp4"</html>';
  const previous = fetchBehavior;
  fetchBehavior = async (url) => {
    const href = String(url?.url || url);
    // La ricerca non deve trovare nulla: la scheda arriva solo dal catalogo.
    const body = href.includes('/filter?') ? '<html></html>' : href.includes('serverPlayer') ? PLAYER : PLAY;
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  };
  try {
    const p = new AnimeWorldProvider({ enabled: true, proxyUrl: '' });
    const out = await p.handleTitleRequest('When Marnie Was There', null, 1, true, 'Omoide no Marnie', "Quando c'era Marnie");
    assert.ok(out.streams.length > 0, 'la scheda del catalogo è stata scartata dal filtro slug');
  } finally {
    fetchBehavior = previous;
    process.env.CATALOG_DIR = path.join(os.tmpdir(), 'hanx-test-catalog-vuoto');
  }
});
