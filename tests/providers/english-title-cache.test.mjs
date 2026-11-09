import assert from 'node:assert/strict';
import { test } from 'node:test';

const { getEnglishTitleFromAnyId } = await import('../../dist/providers/anime-core/english-title.js');

const originalFetch = globalThis.fetch;

// I tre provider chiedono lo stesso titolo in parallelo: senza cache e dedupe
// partono tre GET identiche verso TMDB.
test('il titolo TMDB si scarica una volta sola anche con tre chiamate in parallelo', async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (/api\.themoviedb\.org\/3\/tv\/91001/.test(url)) {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify({ name: 'Titolo TMDB' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const results = await Promise.all([
      getEnglishTitleFromAnyId('91001', 'tmdb', 'test-key'),
      getEnglishTitleFromAnyId('91001', 'tmdb', 'test-key'),
      getEnglishTitleFromAnyId('91001', 'tmdb', 'test-key'),
    ]);
    assert.deepEqual(results, ['Titolo TMDB', 'Titolo TMDB', 'Titolo TMDB']);
    assert.equal(calls, 1, 'tre chiamate devono produrre una sola GET');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('un errore TMDB non resta in cache: la chiamata dopo riprova', async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (/api\.themoviedb\.org\/3\/(tv|movie)\/91002/.test(url)) {
      calls += 1;
      return new Response('boom', { status: 500 });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    await assert.rejects(() => getEnglishTitleFromAnyId('91002', 'tmdb', 'test-key'));
    await assert.rejects(() => getEnglishTitleFromAnyId('91002', 'tmdb', 'test-key'));
    assert.equal(calls, 4, 'due chiamate × (tv + movie), nessuna cache sul fallimento');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
