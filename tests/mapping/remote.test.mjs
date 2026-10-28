import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ANIME_MAPPING_URL: indice remoto scaricato con cache su disco. Il caso che
// conta è il fallimento: rete giù o payload invalido non devono mai cancellare
// l'indice già presente.

const { refreshMappingFromUrl, resolveLocalTarget, resetMappingCache } = await import('../../dist/mapping/index.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-mapping-'));
const indexFile = path.join(tmp, 'anime-seasons.json');
const etagFile = `${indexFile}.etag`;

const INDEX = {
  version: 1,
  generatedAt: '2026-10-24T00:00:00Z',
  series: { 'tmdb:123': { title: 'Test', seasons: { '1': [{ from: 1, kitsuId: '999' }] } } },
  movies: {},
};

function cleanup() {
  fs.rmSync(indexFile, { force: true });
  fs.rmSync(etagFile, { force: true });
  fs.rmSync(`${indexFile}.tmp`, { force: true });
  resetMappingCache();
}

function stubFetch(impl) {
  const prev = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = prev; };
}

function localTarget() {
  resetMappingCache();
  return resolveLocalTarget({ provider: 'tmdb', id: '123', season: 1, episode: 1, isMovie: false });
}

beforeEach(() => {
  cleanup();
  process.env.ANIME_MAPPING_FILE = indexFile;
});

after(() => {
  delete process.env.ANIME_MAPPING_URL;
  delete process.env.ANIME_MAPPING_FILE;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('senza ANIME_MAPPING_URL non fa nessuna richiesta', async () => {
  delete process.env.ANIME_MAPPING_URL;
  let calls = 0;
  const restore = stubFetch(async () => { calls++; throw new Error('non deve essere chiamato'); });
  try { await refreshMappingFromUrl(); } finally { restore(); }
  assert.equal(calls, 0);
  assert.equal(localTarget(), null);
});

test('scarica l’indice e lo rende disponibile al resolver', async () => {
  process.env.ANIME_MAPPING_URL = 'https://example.test/anime-seasons.json';
  const restore = stubFetch(async () => new Response(JSON.stringify(INDEX), {
    status: 200,
    headers: { etag: '"v1"' },
  }));
  try { await refreshMappingFromUrl(); } finally { restore(); }

  assert.ok(fs.existsSync(indexFile));
  assert.equal(fs.readFileSync(etagFile, 'utf8'), '"v1"');
  const target = localTarget();
  assert.equal(target?.kitsuId, '999');
});

test('un indice vuoto non sovrascrive quello buono', async () => {
  fs.writeFileSync(indexFile, JSON.stringify(INDEX));
  process.env.ANIME_MAPPING_URL = 'https://example.test/anime-seasons.json';
  const restore = stubFetch(async () => new Response(JSON.stringify({ version: 1, series: {}, movies: {} }), { status: 200 }));
  try { await refreshMappingFromUrl(); } finally { restore(); }

  assert.equal(localTarget()?.kitsuId, '999', 'il file precedente deve restare');
});

test('un errore di rete non sovrascrive quello buono', async () => {
  fs.writeFileSync(indexFile, JSON.stringify(INDEX));
  process.env.ANIME_MAPPING_URL = 'https://example.test/anime-seasons.json';
  const restore = stubFetch(async () => { throw new Error('offline'); });
  try { await refreshMappingFromUrl(); } finally { restore(); }

  assert.equal(localTarget()?.kitsuId, '999');
});

test('un indice fresco (entro 24h) non viene riscaricato', async () => {
  fs.writeFileSync(indexFile, JSON.stringify(INDEX));
  const now = new Date();
  fs.utimesSync(indexFile, now, now);
  process.env.ANIME_MAPPING_URL = 'https://example.test/anime-seasons.json';
  let calls = 0;
  const restore = stubFetch(async () => { calls++; return new Response('{}', { status: 200 }); });
  try { await refreshMappingFromUrl(); } finally { restore(); }

  assert.equal(calls, 0);
  assert.equal(localTarget()?.kitsuId, '999');
});
test('con ANIME_MAPPING_TOKEN scarica un asset di repo privato', async () => {
  fs.rmSync(indexFile, { force: true });
  process.env.ANIME_MAPPING_URL = 'https://example.test/anime-seasons.json';
  process.env.ANIME_MAPPING_TOKEN = 'tok_123';
  let auth = '';
  const restore = stubFetch(async (_url, init) => {
    auth = String((init?.headers || {}).authorization || '');
    return new Response(JSON.stringify(INDEX), { status: 200, headers: { etag: '"v2"' } });
  });
  try { await refreshMappingFromUrl(); } finally { restore(); delete process.env.ANIME_MAPPING_TOKEN; }

  assert.equal(auth, 'Bearer tok_123');
  assert.equal(localTarget()?.kitsuId, '999');
});
