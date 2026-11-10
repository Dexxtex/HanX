// `type` è un segmento URL e finisce nella chiave della cache del fan-out
// (`providerCacheKey` = `${type}|${id}|${digest}`): senza il confronto col
// manifest, ogni variante inventata crea una chiave nuova e rifà le richieste
// ai tre siti. Il segnale osservabile è la riga `[stream]` di esito, che il
// ramo di rifiuto non stampa.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const addonEntry = path.join(root, 'dist', 'addon.js');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function startServer() {
  const port = await freePort();
  const env = {
    ...process.env,
    ANIME_MAPPING_URL: '',
    TMDB_API_KEY: '',
    TVDB_API_KEY: '',
    TVDB_PIN: '',
    EASYPROXY_URL: '',
    EASYPROXY_PASSWORD: '',
    PROXY: '',
    AU_PROXY: '',
    AS_PROXY: '',
    AW_PROXY: '',
    ANIMEUNITY_ENABLED: 'false',
    ANIMESATURN_ENABLED: 'false',
    ANIMEWORLD_ENABLED: 'false',
    PORT: String(port),
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
      if ((await fetch(`${base}/manifest.json`)).ok) return { base, child, log: () => log };
    } catch {}
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`server non avviato:\n${log}`);
    }
    await sleep(100);
  }
}

test('un type fuori dal manifest non arriva ai provider', { timeout: 30000 }, async () => {
  const server = await startServer();
  try {
    await fetch(`${server.base}/stream/pippo/tt1234567.json`);
    await fetch(`${server.base}/stream/movie/tt1234567.json`);
    await sleep(300);

    const lines = server.log().split('\n').filter((line) => line.includes('[stream]'));
    assert.ok(
      !lines.some((line) => line.includes('pippo/tt1234567')),
      `il type inventato non deve produrre un esito: ${lines.join(' | ')}`
    );
    assert.ok(
      lines.some((line) => line.includes('movie/tt1234567')),
      `il type del manifest deve arrivare al fan-out: ${lines.join(' | ')}`
    );
  } finally {
    if (server.child.exitCode === null) {
      const exited = new Promise((resolve) => server.child.once('exit', resolve));
      server.child.kill();
      await exited;
    }
  }
});
