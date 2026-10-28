import assert from 'node:assert/strict';
import { test } from 'node:test';

const { resolveDebugLevel } = await import('../../dist/utils/logger.js');
const { getTmdbIdFromImdbId } = await import('../../dist/utils/tmdbResolver.js');

test('debug level accepts 1-4 and clamps out-of-range values', () => {
  assert.equal(resolveDebugLevel({}), 0);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '1' }), 1);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '2' }), 2);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '3' }), 3);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '4' }), 4);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '0' }), 0);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '9' }), 4);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '-2' }), 0);
});

test('DEBUG_LOG stays backward compatible', () => {
  assert.equal(resolveDebugLevel({ DEBUG_LOG: 'true' }), 2);
  assert.equal(resolveDebugLevel({ DEBUG_LOG: 'on' }), 2);
  assert.equal(resolveDebugLevel({ DEBUG_LOG: 'false' }), 0);
  assert.equal(resolveDebugLevel({ DEBUG_LOG: '4' }), 4);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '', DEBUG_LOG: '3' }), 3);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '1', DEBUG_LOG: '4' }), 1);
});

test('getTmdbIdFromImdbId riusa il risultato di /find per la stessa richiesta', async () => {
  const originalFetch = globalThis.fetch;
  const savedTmdbKey = process.env.TMDB_API_KEY;
  delete process.env.TMDB_API_KEY;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      movie_results: [{ id: 11, title: 'Movie' }],
      tv_results: [{ id: 22, name: 'Show' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    assert.equal(await getTmdbIdFromImdbId('tt9900001', 'key-a', 'tv'), '22');
    assert.equal(await getTmdbIdFromImdbId('tt9900001', 'key-a', 'tv'), '22');
    assert.equal(calls, 1, 'la seconda chiamata identica usa la cache');

    assert.equal(await getTmdbIdFromImdbId('tt9900001', 'key-a', 'movie'), '11');
    assert.equal(calls, 2, 'un preferredType diverso è una richiesta diversa');

    assert.equal(await getTmdbIdFromImdbId('tt9900001', 'key-b', 'tv'), '22');
    assert.equal(calls, 3, 'un API key diversa non condivide la cache');
  } finally {
    globalThis.fetch = originalFetch;
    if (savedTmdbKey === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = savedTmdbKey;
  }
});
