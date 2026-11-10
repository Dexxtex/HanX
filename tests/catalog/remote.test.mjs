import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const { refreshCatalogFromUrl } = await import('../../dist/catalog/remote.js');
const { CATALOG_SCHEMA_VERSION } = await import('../../dist/catalog/sync.js');

// `refreshCatalogFromUrl` non aveva nessun test, mentre il gemello del mapping
// ne ha cinque. I suoi modi di fallire sono quelli che degradano ogni richiesta
// in silenzio: catalogo vecchio, schema sconosciuto, download troncato.

const originalFetch = globalThis.fetch;

function useDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-cat-remote-'));
  process.env.CATALOG_DIR = dir;
  return { dir, file: path.join(dir, 'catalog-titles.json') };
}

/**
 * Rende il file più vecchio del TTL. Senza, `refreshCatalogFromUrl` esce
 * subito e il test verifica solo che il file sia rimasto com'era.
 */
function makeStale(file) {
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(file, old, old);
}

function payload(extra = {}) {
  return JSON.stringify({
    version: CATALOG_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sites: { saturn: [{ slug: 'a', url: 'u', title: 'A', key: 'a' }], world: [], unity: [] },
    ...extra,
  });
}

test('scarica e scrive il catalogo quando il file locale manca', async () => {
  const { file } = useDir();
  process.env.CATALOG_URL = 'https://example.test/catalog.json';
  globalThis.fetch = async () => new Response(payload(), { status: 200 });
  try {
    await refreshCatalogFromUrl();
    assert.ok(fs.existsSync(file), 'il file deve essere scritto');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sites.saturn.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uno schema sconosciuto non sovrascrive il catalogo buono', async () => {
  const { file } = useDir();
  fs.writeFileSync(file, payload());
  makeStale(file);
  const before = fs.readFileSync(file, 'utf8');
  process.env.CATALOG_URL = 'https://example.test/catalog.json';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ version: 99, sites: { saturn: [] } }), { status: 200 });
  };
  try {
    await refreshCatalogFromUrl();
    assert.equal(calls, 1, 'il download deve essere tentato');
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'il file precedente resta intatto');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Un payload che passa i guard e rompe il matcher: `sites.saturn` non-array,
// una scheda senza `title`, o un file senza `version` (il caso `catalogs.json`
// scambiato per `catalog-titles.json`). Tutti e tre devono fermarsi prima della
// scrittura, altrimenti il provider diventa muto invece di ricadere sulla rete.
for (const [name, body] of [
  ['un sito non-array', { version: CATALOG_SCHEMA_VERSION, generatedAt: null, sites: { saturn: { nope: true }, world: [], unity: [] } }],
  ['una scheda senza title', { version: CATALOG_SCHEMA_VERSION, generatedAt: null, sites: { saturn: [{ slug: 'a', url: 'u', key: 'a' }], world: [], unity: [] } }],
  ['un payload senza version', { generatedAt: null, sites: { saturn: [], world: [], unity: [] } }],
]) {
  test(`${name} non sovrascrive il catalogo buono`, async () => {
    const { file } = useDir();
    fs.writeFileSync(file, payload());
    makeStale(file);
    const before = fs.readFileSync(file, 'utf8');
    process.env.CATALOG_URL = 'https://example.test/catalog.json';
    globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 });
    try {
      await refreshCatalogFromUrl();
      assert.equal(fs.readFileSync(file, 'utf8'), before, 'il file precedente resta intatto');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test('un download fallito non tocca il file locale', async () => {
  const { file } = useDir();
  fs.writeFileSync(file, payload());
  const before = fs.readFileSync(file, 'utf8');
  process.env.CATALOG_URL = 'https://example.test/catalog.json';
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  try {
    await refreshCatalogFromUrl();
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('un file fresco non fa partire nessuna richiesta', async () => {
  const { file } = useDir();
  fs.writeFileSync(file, payload());
  process.env.CATALOG_URL = 'https://example.test/catalog.json';
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(payload(), { status: 200 }); };
  try {
    await refreshCatalogFromUrl();
    assert.equal(calls, 0, 'il TTL deve evitare il download');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('senza CATALOG_URL non fa niente', async () => {
  const { file } = useDir();
  delete process.env.CATALOG_URL;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('', { status: 200 }); };
  try {
    await refreshCatalogFromUrl();
    assert.equal(calls, 0);
    assert.ok(!fs.existsSync(file));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
