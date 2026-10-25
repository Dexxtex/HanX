import assert from 'node:assert/strict';
import { after, test } from 'node:test';

// Il default store Tenrai apre SQLite: in test resta in memoria.
process.env.TENRAI_CACHE_DB_PATH = ':memory:';

const { getEnglishTitleFromAnyId } = await import('../dist/providers/anime-core/english-title.js');

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
