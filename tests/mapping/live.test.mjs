import assert from 'node:assert/strict';
import { test } from 'node:test';

const { fetchKitsuAnime, getSeasonTitle } = await import('../../dist/mapping/live.js');

const originalFetch = globalThis.fetch;

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('getSeasonTitle: i nomi generici non diventano query di ricerca', async () => {
  globalThis.fetch = async () => jsonResponse({ name: 'Season 2' });

  try {
    const name = await getSeasonTitle(
      { provider: 'tmdb', id: '55501', season: 2, episode: 1, isMovie: false },
      2,
      { tmdbApiKey: 'test-key' }
    );
    assert.equal(name, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getSeasonTitle: un titolo vero passa intatto', async () => {
  globalThis.fetch = async () => jsonResponse({ name: 'La malinconia di Haruhi Suzumiya 2' });

  try {
    const name = await getSeasonTitle(
      { provider: 'tmdb', id: '55502', season: 2, episode: 1, isMovie: false },
      2,
      { tmdbApiKey: 'test-key' }
    );
    assert.equal(name, 'La malinconia di Haruhi Suzumiya 2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchJson: imposta un timeout e non ritenta un abort', async () => {
  let calls = 0;
  let signal;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    signal = init?.signal;
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };

  try {
    await assert.rejects(fetchKitsuAnime('987654321'));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 1);
  assert.ok(signal instanceof AbortSignal);
});

test('tre richieste concorrenti allo stesso anime fanno una sola GET', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return jsonResponse({
      data: {
        type: 'anime',
        id: '111222333',
        attributes: { titles: { en: 'Dedupe Test' }, canonicalTitle: 'Dedupe Test' },
      },
    });
  };

  try {
    const [a, b, c] = await Promise.all([
      fetchKitsuAnime('111222333'),
      fetchKitsuAnime('111222333'),
      fetchKitsuAnime('111222333'),
    ]);
    assert.equal(calls, 1);
    assert.equal(a?.title, 'Dedupe Test');
    assert.equal(b?.title, 'Dedupe Test');
    assert.equal(c?.title, 'Dedupe Test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// `getSeasonTitle` e `getTmdbEpisode` leggono lo stesso URL della stagione, e
// `getSeasonTitle` lo chiedono tutti e tre i provider: senza cache erano fino a
// tre GET identiche per richiesta.
test('la stagione TMDB si scarica una volta sola, anche fra chiamate diverse', async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (/\/tv\/777\d+\/season\/2/.test(url)) {
      calls += 1;
      return jsonResponse({ name: 'Arco di Prova', episodes: [{ episode_number: 1, air_date: '2024-01-01' }] });
    }
    return jsonResponse({});
  };

  try {
    const request = { provider: 'tmdb', id: '77701', season: 2, episode: 1, isMovie: false };
    const first = await getSeasonTitle(request, 2, { tmdbApiKey: 'test-key' });
    const second = await getSeasonTitle(request, 2, { tmdbApiKey: 'test-key' });
    assert.equal(first, 'Arco di Prova');
    assert.equal(second, 'Arco di Prova');
    assert.equal(calls, 1, 'la seconda chiamata deve leggere dalla cache');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('la scheda TVDB estesa si scarica una volta sola fra titolo e stagione', async () => {
  let extended = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/login')) return jsonResponse({ data: { token: 'tok' } });
    if (/\/series\/8801\/extended/.test(url)) {
      extended += 1;
      return jsonResponse({ data: { name: 'Serie Prova', seasons: [{ number: 2, name: 'Arco Due' }] } });
    }
    return jsonResponse({});
  };

  try {
    const { getTvdbTitle } = await import('../../dist/mapping/live.js');
    const credentials = { tvdbApiKey: 'test-key', tvdbPin: '' };
    assert.equal(await getTvdbTitle('8801', credentials), 'Serie Prova');
    const name = await getSeasonTitle(
      { provider: 'tvdb', id: '8801', season: 2, episode: 1, isMovie: false },
      2,
      credentials
    );
    assert.equal(name, 'Arco Due');
    assert.equal(extended, 1, 'la seconda lettura deve venire dalla cache');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
