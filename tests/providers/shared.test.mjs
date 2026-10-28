import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';

// Utility condivise dai provider: helper episodi/qualità, URL base, cache,
// titolo inglese. Un file solo: sono tutte funzioni pure o quasi.

const { isAbortOrTimeoutError, episodeTag, pickEpisodeEntry, qualityTag, italianSeasonQuery, sameTitle } = await import('../../dist/providers/anime-core/helpers.js');
const { getCached, setCached } = await import('../../dist/providers/anime-core/cache.js');

process.env.ANIMEWORLD_BASE_URL = 'https://env.example';
const { getProviderUrl } = await import('../../dist/providers/anime-core/provider-urls.js');
const providerUrls = JSON.parse(readFileSync(new URL('../../config/provider_urls.json', import.meta.url), 'utf8'));

// Il default store Tenrai apre SQLite: in test resta in memoria.
process.env.TENRAI_CACHE_DB_PATH = ':memory:';
const { getEnglishTitleFromAnyId } = await import('../../dist/providers/anime-core/english-title.js');

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

test('qualityTag: FHD solo da 1080p in su', () => {
  assert.equal(qualityTag(1080), 'FHD');
  assert.equal(qualityTag(2160), 'FHD');
  // La variante è la più alta disponibile, ma non è full HD: niente badge.
  assert.equal(qualityTag(720), null);
  assert.equal(qualityTag(480), null);
  assert.equal(qualityTag(null), null);
  assert.equal(qualityTag(undefined), null);
});

test('episodeTag stampa la stagione solo quando è nota', () => {
  assert.equal(episodeTag(2, 5), 'S2E5');
  assert.equal(episodeTag(null, 5), 'E5');
  assert.equal(episodeTag(null, null), '');
});

test('italianSeasonQuery aggiunge la stagione e non sbaglia con gli id Kitsu', () => {
  const it = 'La malinconia di Haruhi Suzumiya';
  assert.equal(italianSeasonQuery(it, 2, 'The Melancholy of Haruhi Suzumiya Season 2'), `${it} 2`);
  assert.equal(italianSeasonQuery(it, 1, 'The Melancholy of Haruhi Suzumiya Season 2'), it);
  // Kitsu: season null, la stagione si legge dal titolo.
  assert.equal(italianSeasonQuery(it, null, 'The Melancholy of Haruhi Suzumiya Season 2'), `${it} 2`);
  assert.equal(italianSeasonQuery(it, null, 'The Melancholy of Haruhi Suzumiya II'), `${it} 2`);
  assert.equal(italianSeasonQuery(it, null, 'Cyberpunk: Edgerunners 2'), `${it} 2`);
  assert.equal(italianSeasonQuery(it, null, 'Re:Zero 2nd Season'), `${it} 2`);
  // Stagione non deducibile: niente titolo italiano (sarebbe quello dell'opera).
  assert.equal(italianSeasonQuery(it, null, 'Death Note'), '');
  assert.equal(italianSeasonQuery(it, null, 'Attack on Titan: The Final Season Part 2'), '');
  assert.equal(italianSeasonQuery(it, null, 'Mob Psycho 100'), '');
  assert.equal(italianSeasonQuery('', 2, 'Death Note'), '');
});

test('sameTitle ignora maiuscole, accenti e punteggiatura', () => {
  // Cyberpunk ha lo stesso nome in it-IT: la query italiana non va aggiunta.
  assert.equal(sameTitle('Cyberpunk: Edgerunners 2', 'CYBERPUNK: EDGERUNNERS 2'), true);
  assert.equal(sameTitle('La Malinconia di Haruhi Suzumiya', 'La malinconia di Haruhi Suzumiya'), true);
  assert.equal(sameTitle('La malinconia di Haruhi Suzumiya 2', 'La malinconia di Haruhi Suzumiya'), false);
  assert.equal(sameTitle('', 'Death Note'), false);
});

test('getProviderUrl: env esplicito batte file JSON e domains.json', () => {
  assert.equal(
    getProviderUrl('animeworld', ['ANIMEWORLD_BASE_URL', 'AW_BASE_URL']),
    'https://env.example'
  );
});

test('getProviderUrl: senza env usa il file JSON locale, non domains.json', () => {
  assert.equal(
    getProviderUrl('animeworld', []),
    String(providerUrls.animeworld).replace(/\/+$/, '')
  );
});

test('setCached scarta le entry scadute e limita la mappa a 500', () => {
  const map = new Map();
  // Una entry scaduta deve sparire durante l'eviction.
  map.set('expired', { value: 'old', expiresAt: Date.now() - 1000 });
  for (let i = 0; i < 600; i += 1) {
    setCached(map, `k${i}`, i, 60_000);
  }
  assert.equal(map.size, 500);
  assert.equal(map.has('expired'), false);
  assert.equal(map.has('k0'), false);
  assert.equal(map.has('k599'), true);
  assert.equal(getCached(map, 'k599'), 599);
});

const originalFetch = globalThis.fetch;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' },
  });
}

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => handler(new URL(String(url)), init);
}

after(() => {
  globalThis.fetch = originalFetch;
});

test('imdb: usa il solo tt... (senza :season:episode) e prende il titolo TMDB', async () => {
  const requested = [];
  stubFetch((url) => {
    requested.push(url.pathname + url.search);
    if (url.hostname === 'api.tenrai.org') return json({}, 404);
    if (url.hostname === 'kitsu.io') return json({ data: [], included: [] });
    if (url.pathname.includes('/find/')) {
      const imdbId = decodeURIComponent(url.pathname.split('/find/')[1]);
      return imdbId.includes(':') ? json({}, 404) : json({ tv_results: [{ id: 42, name: 'Found Show' }] });
    }
    if (url.pathname.endsWith('/tv/42')) return json({ name: 'Attack on Titan' });
    return json({}, 404);
  });

  const title = await getEnglishTitleFromAnyId('tt1234567:2:5', 'imdb', 'test-key');
  assert.equal(title, 'Attack on Titan');
  assert.ok(requested.some((path) => path.includes('/find/tt1234567?')));
  assert.equal(requested.some((path) => path.includes(':2:5')), false);
});

test('kitsu: restituisce il titolo Kitsu quando Tenrai non ha nulla', async () => {
  stubFetch((url) => {
    if (url.hostname === 'api.tenrai.org') return json({}, 404);
    if (url.pathname.endsWith('/mappings')) return json({ data: [] });
    return json({
      data: {
        id: '12',
        type: 'anime',
        attributes: { titles: { en: 'Kitsu Title' }, canonicalTitle: 'Kitsu Canonical' },
      },
    });
  });

  assert.equal(await getEnglishTitleFromAnyId('12', 'kitsu', 'test-key'), 'Kitsu Title');
});

test('mal: senza alcuna fonte lancia', async () => {
  stubFetch(() => json({}, 404));
  await assert.rejects(
    getEnglishTitleFromAnyId('999', 'mal', 'test-key'),
    /Impossibile ottenere titolo/
  );
});

test('mal: allowEmptyTitle restituisce un placeholder non vuoto', async () => {
  stubFetch(() => json({}, 404));
  const title = await getEnglishTitleFromAnyId('999', 'mal', 'test-key', true);
  assert.equal(title, 'Anime');
  assert.ok(title.length > 0);
});
