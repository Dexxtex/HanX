import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-gate-'));
const fixtureFile = path.join(fixtureDir, 'anime-seasons.json');
fs.writeFileSync(fixtureFile, JSON.stringify({
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  series: { 'tmdb:1': { title: 'Mapped', seasons: { '1': [{ from: 1, kitsuId: '10', offset: 0 }] } } },
  movies: { 'imdb:tt42': { kitsuId: '11', title: 'Mapped Movie' } },
}));
process.env.ANIME_MAPPING_FILE = fixtureFile;

const { checkIsAnimeById, __resetAnimeGateCache } = await import('../../dist/utils/animeGate.js');
const { resetMappingCache } = await import('../../dist/mapping/index.js');

test('local mapping is authoritative and does not call upstream', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  __resetAnimeGateCache();
  resetMappingCache();
  globalThis.fetch = async () => {
    calls++;
    throw new Error('upstream must not be called for a mapped id');
  };
  try {
    const series = await checkIsAnimeById('tmdb', '1', 'test', 'tv');
    const movie = await checkIsAnimeById('imdb', 'tt42', 'test', 'movie');
    assert.equal(series.isAnime, true);
    assert.equal(series.reason, 'local-mapping');
    assert.equal(movie.isAnime, true);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    __resetAnimeGateCache();
  }
});

test('un-mapped TMDB ids share one upstream lookup and use official details', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  __resetAnimeGateCache();
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({ id: 999, genres: [{ id: 16, name: 'Animation' }], origin_country: ['JP'] }),
    };
  };
  try {
    const results = await Promise.all([
      checkIsAnimeById('tmdb', '999', 'test', 'tv'),
      checkIsAnimeById('tmdb', '999', 'test', 'tv'),
      checkIsAnimeById('tmdb', '999', 'test', 'tv'),
    ]);
    assert.equal(calls, 1, 'concurrent calls must share a single upstream lookup');
    for (const result of results) {
      assert.equal(result.isAnime, true);
      assert.equal(result.reason, 'tmdb-fallback');
    }
  } finally {
    globalThis.fetch = originalFetch;
    __resetAnimeGateCache();
  }
});
