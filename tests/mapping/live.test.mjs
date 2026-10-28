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
