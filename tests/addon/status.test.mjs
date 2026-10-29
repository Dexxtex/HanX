import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// /status.json: diagnostica runtime. I test avviano il server compilato in un
// processo separato perché le costanti della cache si leggono all'import.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const addonEntry = path.join(root, 'dist', 'addon.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-status-'));
const missingIndex = path.join(tmp, 'no-such-index.json');

const SECRET_TMDB = 'tmdb-secret-123';
const SECRET_MAPPING = 'mapping-secret-456';
const SECRET_PROXY = 'proxy-secret-789';

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const env = {
    ...process.env,
    ANIME_MAPPING_URL: '',
    ANIME_MAPPING_FILE: missingIndex,
    // src/mapping/overrides.json viene sempre mergiato: per il caso "indice
    // assente" va neutralizzato anche lui, altrimenti series conta 10.
    ANIME_MAPPING_OVERRIDES: path.join(tmp, 'no-such-overrides.json'),
    ANIME_MAPPING_TOKEN: SECRET_MAPPING,
    TMDB_API_KEY: SECRET_TMDB,
    TVDB_API_KEY: '',
    TVDB_PIN: '',
    EASYPROXY_URL: '',
    EASYPROXY_PASSWORD: SECRET_PROXY,
    PROXY: '',
    AU_PROXY: '',
    AS_PROXY: '',
    AW_PROXY: '',
    ANIMEUNITY_ENABLED: 'false',
    ANIMESATURN_ENABLED: 'false',
    ANIMEWORLD_ENABLED: 'false',
    PORT: String(port),
    ...extraEnv,
  };
  const child = spawn(process.execPath, [addonEntry], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server uscito (${child.exitCode}):\n${log}`);
    try {
      // /manifest.json esiste già: se /status.json è rotto il test fallisce sull'assert, non all'avvio.
      const res = await fetch(`${base}/manifest.json`);
      if (res.ok) return { base, child };
    } catch {}
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`server non avviato:\n${log}`);
    }
    await sleep(100);
  }
}

async function stopServer({ child }) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await exited;
}

async function statusBody(server) {
  const res = await fetch(`${server.base}/status.json`);
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}

test('GET /status.json: header, body esatto, versione del manifest e cache legata alle costanti', { timeout: 30000 }, async () => {
  const server = await startServer({ PROVIDER_CACHE_MAX_ENTRIES: '42', PROVIDER_CACHE_TTL_MS: '1234' });
  try {
    const { res, text, body } = await statusBody(server);

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /^application\/json/);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('cache-control'), 'no-store');

    assert.deepEqual(Object.keys(body).sort(), ['addon', 'cache', 'mapping']);
    assert.deepEqual(Object.keys(body.addon).sort(), ['uptimeMs', 'version']);
    assert.deepEqual(Object.keys(body.mapping).sort(), ['ageMs', 'generatedAt', 'movies', 'schemaVersion', 'series', 'signature']);
    assert.deepEqual(Object.keys(body.cache).sort(), ['disabled', 'entries', 'maxEntries', 'ttlMs']);

    // addon.version è quella servita dal manifest, non package.json.
    const manifest = await (await fetch(`${server.base}/manifest.json`)).json();
    assert.equal(manifest.id, 'org.stremio.hanx');
    assert.equal(body.addon.version, manifest.version);
    assert.ok(body.addon.version.length > 0);
    assert.ok(Number.isInteger(body.addon.uptimeMs) && body.addon.uptimeMs >= 0);

    // Indice assente (ANIME_MAPPING_FILE verso un percorso mai creato).
    assert.equal(body.mapping.schemaVersion, 1);
    assert.equal(body.mapping.series, 0);
    assert.equal(body.mapping.movies, 0);
    assert.equal(body.mapping.generatedAt, null);
    assert.equal(body.mapping.ageMs, null);
    assert.match(body.mapping.signature, /^[0-9a-f]{16}$/);

    const again = await statusBody(server);
    assert.equal(again.body.mapping.signature, body.mapping.signature, 'signature stabile tra due richieste');

    assert.deepEqual(body.cache, { entries: 0, maxEntries: 42, ttlMs: 1234, disabled: false });

    for (const secret of [SECRET_TMDB, SECRET_MAPPING, SECRET_PROXY]) {
      assert.ok(!text.includes(secret), `segreto nel body: ${secret}`);
    }
  } finally {
    await stopServer(server);
  }
});

test('GET /status.json: PROVIDER_CACHE_DISABLE=1 riflette la cache disabilitata', { timeout: 30000 }, async () => {
  const server = await startServer({
    PROVIDER_CACHE_MAX_ENTRIES: '42',
    PROVIDER_CACHE_TTL_MS: '1234',
    PROVIDER_CACHE_DISABLE: '1',
  });
  try {
    const { res, body } = await statusBody(server);
    assert.equal(res.status, 200);
    assert.deepEqual(body.cache, { entries: 0, maxEntries: 42, ttlMs: 1234, disabled: true });
  } finally {
    await stopServer(server);
  }
});
