#!/usr/bin/env node
/**
 * Verifica ripetibile di una feature HanX. Oggi supporta: status, mapping-stale.
 * Uso: node scripts/verify-feature.mjs status|mapping-stale [--out file.json]
 *      [--fingerprint hex] [--skip-build] [--network --stream-id tt...:S:E]
 *
 * Offline per default: avvia il server compilato su una porta libera, env
 * neutralizzate, e termina sempre il processo. La verifica di rete (AC3b di
 * status) e' separata e va autorizzata esplicitamente con --network.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const feature = process.argv[2];
if (feature !== 'status' && feature !== 'mapping-stale') {
  console.error('feature non supportata. Uso: node scripts/verify-feature.mjs status|mapping-stale [opzioni]');
  process.exit(2);
}

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const outFile = path.resolve(arg('out', path.join(root, '.opencode', 'orchestra', 'verify-results.json')));
const fingerprint = arg('fingerprint', 'unrecorded');
const network = flag('network');
const streamId = arg('stream-id', '');
const artifact = arg('artifact', '');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-verify-'));
const missingIndex = path.join(tmp, 'no-such-index.json');

const SECRETS = { TMDB_API_KEY: 'tmdb-secret-123', ANIME_MAPPING_TOKEN: 'mapping-secret-456', EASYPROXY_PASSWORD: 'proxy-secret-789' };
const STATUS_IDS = ['AC1', 'AC2', 'AC3a', 'AC3b', 'AC4', 'AC5', 'AC6'];
// Lista dedicata: gli stessi ID hanno significati diversi da quelli di status.
const MAPPING_STALE_IDS = ['AC1', 'AC2', 'AC3', 'AC4', 'AC5', 'AC6'];
const IDS = feature === 'status' ? STATUS_IDS : MAPPING_STALE_IDS;
const checks = [];
const add = (id, verdict, detail) => checks.push({ id, verdict, detail });
const guard = async (id, fn) => {
  try {
    const r = await fn();
    add(id, r.verdict, r.detail);
  } catch (e) {
    add(id, 'FAIL', String(e?.message || e));
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function baseEnv(extra = {}) {
  return {
    ...process.env,
    ANIME_MAPPING_URL: '',
    ANIME_MAPPING_FILE: missingIndex,
    ANIME_MAPPING_OVERRIDES: path.join(tmp, 'no-such-overrides.json'),
    TVDB_API_KEY: '',
    TVDB_PIN: '',
    EASYPROXY_URL: '',
    PROXY: '',
    AU_PROXY: '',
    AS_PROXY: '',
    AW_PROXY: '',
    ANIMEUNITY_ENABLED: 'false',
    ANIMESATURN_ENABLED: 'false',
    ANIMEWORLD_ENABLED: 'false',
    ANIME_HOST_MIN_INTERVAL_MS: '0',
    ...SECRETS,
    ...extra,
  };
}

async function startServer(extraEnv = {}) {
  const port = Number(arg('port', '0')) || (await freePort());
  const env = baseEnv({ PORT: String(port), ...extraEnv });
  const child = spawn(process.execPath, [path.join(root, 'dist', 'addon.js')], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (c) => { log += c; });
  child.stderr.on('data', (c) => { log += c; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server uscito (${child.exitCode}):\n${log.slice(-1500)}`);
    try {
      const res = await fetch(`${base}/manifest.json`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { base, child, port, env: { PORT: String(port), ANIME_MAPPING_URL: '', providers: 'false', cache: extraEnv } };
    } catch {}
    if (Date.now() > deadline) {
      await stopServer({ child });
      throw new Error(`server non avviato in 20s:\n${log.slice(-1500)}`);
    }
    await sleep(100);
  }
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  const exited = new Promise((r) => server.child.once('exit', r));
  server.child.kill();
  await Promise.race([exited, sleep(5000)]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

async function fetchStatus(server) {
  const res = await fetch(`${server.base}/status.json`, { signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { res, text, body };
}

function saveProbe(name, value) {
  const dir = path.join(path.dirname(outFile), 'probes');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
}

const DAY = 86400000;

async function runMappingStale() {
  const iso = (ms) => new Date(ms).toISOString();
  const oldDays = 30;
  // Un'ora oltre i 30 giorni: il floor dei giorni resta stabile per la run.
  const oldGeneratedAt = iso(Date.now() - oldDays * DAY - 3600000);
  const freshGeneratedAt = iso(Date.now());

  const writeFixture = (name, generatedAt, series = {}) => {
    const file = path.join(tmp, name);
    fs.writeFileSync(file, JSON.stringify({ version: 1, generatedAt, series, movies: {} }));
    return file;
  };
  const oldFile = writeFixture('mapping-old.json', oldGeneratedAt);
  const freshFile = writeFixture('mapping-fresh.json', freshGeneratedAt);
  const invalidFile = writeFixture('mapping-invalid.json', 'non-una-data');
  const futureFile = writeFixture('mapping-future.json', iso(Date.now() + 10 * DAY));
  const malformedFile = writeFixture('mapping-malformed.json', freshGeneratedAt, { 'imdb:tt0000000': null });

  const wantKeys = ['ageMs', 'generatedAt', 'movies', 'schemaVersion', 'series', 'signature', 'stale'];
  const keysOk = (mapping) => Object.keys(mapping || {}).sort().join(',') === wantKeys.join(',');

  // --- AC1: indice assente -> 200, chiavi esatte, stale false ---
  await guard('AC1', async () => {
    const server = await startServer();
    try {
      const first = await fetchStatus(server);
      saveProbe('mapping-stale-status-absent.json', { status: first.res.status, body: first.body });
      const problems = [];
      if (first.res.status !== 200) problems.push(`status ${first.res.status}`);
      if (!first.body) problems.push('body non parsabile');
      if (!keysOk(first.body?.mapping)) problems.push(`chiavi mapping: ${Object.keys(first.body?.mapping || {}).sort().join(',')}`);
      if (first.body?.mapping?.stale !== false) problems.push(`stale ${first.body?.mapping?.stale}`);
      return problems.length
        ? { verdict: 'FAIL', detail: problems.join('; ') }
        : { verdict: 'PASS', detail: 'indice assente: 200, chiavi esatte (stale inclusa), stale false' };
    } finally {
      await stopServer(server);
    }
  });

  // --- AC2: stale solo da generatedAt, mai dalla mtime ---
  await guard('AC2', async () => {
    const problems = [];
    let server = await startServer({ ANIME_MAPPING_FILE: oldFile });
    try {
      const status = (await fetchStatus(server)).body?.mapping;
      saveProbe('mapping-stale-status-old.json', status ?? null);
      if (status?.stale !== true) problems.push(`vecchio: stale ${status?.stale}`);
      if (status?.generatedAt !== oldGeneratedAt) problems.push('vecchio: generatedAt non dalla fixture');
      if (!(typeof status?.ageMs === 'number' && status.ageMs < 60000)) problems.push(`vecchio: ageMs ${status?.ageMs} (mtime recente)`);
    } finally {
      await stopServer(server);
    }

    const backdated = new Date(Date.now() - 40 * DAY);
    fs.utimesSync(freshFile, backdated, backdated);
    server = await startServer({ ANIME_MAPPING_FILE: freshFile });
    try {
      const status = (await fetchStatus(server)).body?.mapping;
      saveProbe('mapping-stale-status-fresh.json', status ?? null);
      if (status?.stale !== false) problems.push(`fresco: stale ${status?.stale}`);
      if (status?.generatedAt !== freshGeneratedAt) problems.push('fresco: generatedAt non dalla fixture');
      if (!(status?.ageMs >= 39 * DAY)) problems.push(`fresco: ageMs ${status?.ageMs} non retrodatata`);
    } finally {
      await stopServer(server);
    }

    return problems.length
      ? { verdict: 'FAIL', detail: problems.join('; ') }
      : { verdict: 'PASS', detail: 'vecchio True (mtime recente), fresco False (mtime 40gg)' };
  });

  // --- AC3: unit deterministico di MAPPING_STALE_MS/isMappingStale ---
  await guard('AC3', async () => {
    const mapping = await import(pathToFileURL(path.join(root, 'dist', 'mapping', 'index.js')).href);
    const { MAPPING_STALE_MS, isMappingStale } = mapping;
    const now = Date.parse('2026-10-29T12:00:00.000Z');
    const cases = [
      ['MAPPING_STALE_MS = 172800000', MAPPING_STALE_MS === 172800000],
      ['48h-1ms false', isMappingStale(iso(now - MAPPING_STALE_MS + 1), now) === false],
      ['48h esatte false', isMappingStale(iso(now - MAPPING_STALE_MS), now) === false],
      ['48h+1ms true', isMappingStale(iso(now - MAPPING_STALE_MS - 1), now) === true],
      ['null false', isMappingStale(null, now) === false],
      ['non parsabile false', isMappingStale('non-una-data', now) === false],
      ['futuro false', isMappingStale(iso(now + DAY), now) === false],
      ['YYYY-MM-DD = mezzanotte UTC', Date.parse('2026-10-01') === Date.parse('2026-10-01T00:00:00.000Z')],
      ['YYYY-MM-DD 24h false', isMappingStale('2026-10-01', Date.parse('2026-10-02T00:00:00.000Z')) === false],
      ['YYYY-MM-DD 72h true', isMappingStale('2026-10-01', Date.parse('2026-10-04T00:00:00.000Z')) === true],
    ];
    const failed = cases.filter(([, ok]) => !ok).map(([label]) => label);
    return failed.length
      ? { verdict: 'FAIL', detail: `casi falliti: ${failed.join(', ')}` }
      : { verdict: 'PASS', detail: `${cases.length} casi deterministici, senza file/env` };
  });

  // --- AC4: banner sul solo indice vecchio ---
  await guard('AC4', async () => {
    const server = await startServer({ ANIME_MAPPING_FILE: oldFile });
    try {
      const res = await fetch(`${server.base}/`, { signal: AbortSignal.timeout(10000) });
      const html = await res.text();
      const problems = [];
      if (res.status !== 200) problems.push(`/ ${res.status}`);
      const nodes = html.match(/data-mapping-stale="true"/g) || [];
      if (nodes.length !== 1) problems.push(`nodi banner ${nodes.length}`);
      const banner = html.match(/<div class="mapping-stale" data-mapping-stale="true" role="status">([^<]*)<\/div>/);
      if (!banner) problems.push('nodo banner assente o attributi errati');
      const bannerStart = html.indexOf('data-mapping-stale="true"');
      if (bannerStart < 0 || bannerStart > html.indexOf('class="hero"')) problems.push('banner non prima della hero');
      if (!/<div class="wrap">\s*<div class="mapping-stale"/.test(html)) problems.push('banner non primo figlio di .wrap');
      const text = banner?.[1] || '';
      if (!text.includes(oldGeneratedAt.slice(0, 10))) problems.push('data YYYY-MM-DD assente nel banner');
      if (!text.includes(`${oldDays} giorni`)) problems.push(`${oldDays} giorni assente nel banner`);
      if (text.includes(oldGeneratedAt)) problems.push('generatedAt grezzo nel banner');
      if (/aria-hidden/.test(html)) problems.push('aria-hidden presente');
      if (!/\.mapping-stale \{/.test(html)) problems.push('stile .mapping-stale assente');
      for (const secret of Object.values(SECRETS)) if (html.includes(secret)) problems.push('segreto finto nella landing');
      saveProbe('mapping-stale-home-old.json', { status: res.status, nodes: nodes.length, banner: text });
      return problems.length
        ? { verdict: 'FAIL', detail: problems.join('; ') }
        : { verdict: 'PASS', detail: `un nodo, testo "${text.trim()}", prima della hero` };
    } finally {
      await stopServer(server);
    }
  });

  // --- AC5: fresco, assente, non parsabile, futuro -> nessun banner ---
  await guard('AC5', async () => {
    const cases = [
      ['fresco', freshFile],
      ['assente', missingIndex],
      ['non parsabile', invalidFile],
      ['futuro', futureFile],
    ];
    const problems = [];
    for (const [label, file] of cases) {
      const server = await startServer({ ANIME_MAPPING_FILE: file });
      try {
        const home = await fetch(`${server.base}/`, { signal: AbortSignal.timeout(10000) });
        const html = await home.text();
        const status = await fetchStatus(server);
        if (home.status !== 200) problems.push(`${label}: / ${home.status}`);
        if (status.res.status !== 200) problems.push(`${label}: /status.json ${status.res.status}`);
        if (status.body?.mapping?.stale !== false) problems.push(`${label}: stale ${status.body?.mapping?.stale}`);
        if (html.includes('data-mapping-stale')) problems.push(`${label}: banner presente`);
      } finally {
        await stopServer(server);
      }
    }
    saveProbe('mapping-stale-ac5.json', { cases: cases.map(([label]) => label), problems });
    return problems.length
      ? { verdict: 'FAIL', detail: problems.join('; ') }
      : { verdict: 'PASS', detail: `4 stati senza banner: ${cases.map(([label]) => label).join(', ')}` };
  });

  // --- AC6: indice JSON valido con entry malformata -> fail-open ---
  await guard('AC6', async () => {
    const server = await startServer({ ANIME_MAPPING_FILE: malformedFile });
    try {
      const problems = [];
      for (let round = 1; round <= 2; round++) {
        const home = await fetch(`${server.base}/`, { signal: AbortSignal.timeout(10000) });
        const html = await home.text();
        const manifest = await fetch(`${server.base}/manifest.json`, { signal: AbortSignal.timeout(10000) });
        await manifest.text();
        const status = await fetchStatus(server);
        if (home.status !== 200) problems.push(`richiesta ${round}: / ${home.status}`);
        if (manifest.status !== 200) problems.push(`richiesta ${round}: /manifest.json ${manifest.status}`);
        if (status.res.status !== 200) problems.push(`richiesta ${round}: /status.json ${status.res.status}`);
        if (html.includes('data-mapping-stale')) problems.push(`richiesta ${round}: banner su indice malformato`);
        if (status.body?.mapping?.stale !== false) problems.push(`richiesta ${round}: stale ${status.body?.mapping?.stale}`);
        if (!keysOk(status.body?.mapping)) problems.push(`richiesta ${round}: chiavi mapping`);
      }
      if (server.child.exitCode !== null) problems.push(`processo uscito (${server.child.exitCode})`);
      saveProbe('mapping-stale-status-malformed.json', { exitCode: server.child.exitCode, problems });
      return problems.length
        ? { verdict: 'FAIL', detail: problems.join('; ') }
        : { verdict: 'PASS', detail: 'entry null: /, /manifest.json, /status.json 200 x2, nessun banner, processo vivo' };
    } finally {
      await stopServer(server);
    }
  });
}

const startedAt = new Date().toISOString();
const commands = [];
let buildLog = '';
let cacheA = { verdict: 'BLOCKED', detail: 'server non avviato' };

try {
  if (!flag('skip-build')) {
    commands.push('pnpm run build');
    const build = spawnSync('pnpm run build', { cwd: root, shell: true, encoding: 'utf8' });
    buildLog = `${build.stdout || ''}${build.stderr || ''}`.trim().slice(-2000);
    if (build.status !== 0) {
      for (const id of IDS) add(id, 'BLOCKED', 'build fallito: ' + buildLog.slice(-500));
      throw Object.assign(new Error('build fallito'), { handled: true });
    }
  }
  if (!fs.existsSync(path.join(root, 'dist', 'addon.js'))) {
    for (const id of IDS) add(id, 'BLOCKED', 'dist/addon.js assente (build non eseguito)');
    throw Object.assign(new Error('dist assente'), { handled: true });
  }

  if (feature === 'mapping-stale') {
    await runMappingStale();
  } else {
  // --- status: blocco storico invariato (indentazione originale) ---
  // --- Server A: cache deterministica, indice assente, segreti finti ---
  let server = await startServer({ PROVIDER_CACHE_MAX_ENTRIES: '42', PROVIDER_CACHE_TTL_MS: '1234' });
  try {
    commands.push(`node dist/addon.js (PORT=${server.port})`);
    const first = await fetchStatus(server);
    saveProbe('status-main.json', { status: first.res.status, headers: Object.fromEntries(first.res.headers), body: first.body });
    saveProbe('status-headers.json', Object.fromEntries(first.res.headers));

    await guard('AC1', async () => {
      const problems = [];
      if (first.res.status !== 200) problems.push(`status ${first.res.status}`);
      if (!/^application\/json/.test(first.res.headers.get('content-type') || '')) problems.push('content-type non JSON');
      if (first.res.headers.get('access-control-allow-origin') !== '*') problems.push('ACAO assente');
      if (first.res.headers.get('cache-control') !== 'no-store') problems.push('Cache-Control non no-store');
      if (!first.body) problems.push('body non parsabile');
      return problems.length ? { verdict: 'FAIL', detail: problems.join('; ') } : { verdict: 'PASS', detail: '200 JSON, ACAO *, no-store' };
    });

    await guard('AC2', async () => {
      const body = first.body;
      const want = { root: ['addon', 'cache', 'mapping'], addon: ['uptimeMs', 'version'], cache: ['disabled', 'entries', 'maxEntries', 'ttlMs'], mapping: ['ageMs', 'generatedAt', 'movies', 'schemaVersion', 'series', 'signature', 'stale'] };
      const problems = [];
      const keys = (o) => Object.keys(o || {}).sort().join(',');
      if (keys(body) !== want.root.join(',')) problems.push(`chiavi top-level: ${keys(body)}`);
      if (keys(body?.addon) !== want.addon.join(',')) problems.push('chiavi addon');
      if (keys(body?.cache) !== want.cache.join(',')) problems.push('chiavi cache');
      if (keys(body?.mapping) !== want.mapping.join(',')) problems.push('chiavi mapping');
      const manifest = await (await fetch(`${server.base}/manifest.json`, { signal: AbortSignal.timeout(10000) })).json();
      if (body?.addon?.version !== manifest.version) problems.push(`version ${body?.addon?.version} != manifest ${manifest.version}`);
      if (!Number.isInteger(body?.addon?.uptimeMs) || body.addon.uptimeMs < 0) problems.push('uptimeMs non intero >= 0');
      if (typeof body?.mapping?.schemaVersion !== 'number') problems.push('schemaVersion non numero');
      if (!/^[0-9a-f]{16}$/.test(body?.mapping?.signature || '')) problems.push('signature non 16 hex');
      if (!(body?.mapping?.generatedAt === null || typeof body.mapping.generatedAt === 'string')) problems.push('generatedAt tipo errato');
      if (body?.mapping?.stale !== false) problems.push(`stale ${body?.mapping?.stale}`);
      return problems.length ? { verdict: 'FAIL', detail: problems.join('; ') } : { verdict: 'PASS', detail: 'forma e tipi esatti; version = manifest; stale false' };
    });

    await guard('AC4', async () => {
      const b = first.body;
      const problems = [];
      if (b?.mapping?.series !== 0) problems.push(`series ${b?.mapping?.series}`);
      if (b?.mapping?.movies !== 0) problems.push(`movies ${b?.mapping?.movies}`);
      if (b?.mapping?.generatedAt !== null) problems.push('generatedAt non null');
      if (b?.mapping?.ageMs !== null) problems.push('ageMs non null');
      if (b?.mapping?.stale !== false) problems.push(`stale ${b?.mapping?.stale}`);
      if (b?.mapping?.schemaVersion !== 1) problems.push(`schemaVersion ${b?.mapping?.schemaVersion}`);
      const again = await fetchStatus(server);
      if (again.body?.mapping?.signature !== b?.mapping?.signature) problems.push('signature non stabile');
      return problems.length ? { verdict: 'FAIL', detail: problems.join('; ') } : { verdict: 'PASS', detail: 'indice assente: 0/0, null, signature stabile, nessun 500' };
    });

    await guard('AC5', async () => {
      const problems = [];
      const manifest = await fetch(`${server.base}/manifest.json`, { signal: AbortSignal.timeout(10000) });
      if (manifest.status !== 200) problems.push(`manifest ${manifest.status}`);
      const m = await manifest.json();
      if (m.id !== 'org.stremio.hanx') problems.push(`manifest id ${m.id}`);
      const home = await fetch(`${server.base}/`, { signal: AbortSignal.timeout(10000) });
      if (home.status !== 200) problems.push(`/ ${home.status}`);
      if (!/text\/html/.test(home.headers.get('content-type') || '')) problems.push('/ non HTML');
      saveProbe('manifest.json', m);
      return problems.length ? { verdict: 'FAIL', detail: problems.join('; ') } : { verdict: 'PASS', detail: '/manifest.json e / invariati; /status.json ora 200' };
    });

    await guard('AC6', async () => {
      const leaked = Object.values(SECRETS).filter((s) => first.text.includes(s));
      return leaked.length ? { verdict: 'FAIL', detail: `segreti nel body: ${leaked.length}` } : { verdict: 'PASS', detail: 'nessun segreto finto nel body' };
    });

    const c = first.body?.cache;
    const problems = [];
    if (c?.entries !== 0) problems.push(`entries ${c?.entries}`);
    if (c?.maxEntries !== 42) problems.push(`maxEntries ${c?.maxEntries}`);
    if (c?.ttlMs !== 1234) problems.push(`ttlMs ${c?.ttlMs}`);
    if (c?.disabled !== false) problems.push(`disabled ${c?.disabled}`);
    cacheA = problems.length ? { verdict: 'FAIL', detail: problems.join('; ') } : { verdict: 'PASS', detail: '42/1234/0/false dalle costanti' };
  } finally {
    await stopServer(server);
  }

  // --- Server B: cache disabilitata ---
  server = await startServer({ PROVIDER_CACHE_MAX_ENTRIES: '42', PROVIDER_CACHE_TTL_MS: '1234', PROVIDER_CACHE_DISABLE: '1' });
  try {
    const disabled = await fetchStatus(server);
    saveProbe('status-disabled.json', { status: disabled.res.status, body: disabled.body });
    const c = disabled.body?.cache;
    const ok = c?.disabled === true && c?.entries === 0 && c?.maxEntries === 42 && c?.ttlMs === 1234;
    const cacheB = ok ? { verdict: 'PASS', detail: 'PROVIDER_CACHE_DISABLE=1 -> disabled true, entries 0' } : { verdict: 'FAIL', detail: `cache disabilitata: ${JSON.stringify(c)}` };
    add('AC3a', cacheA.verdict === 'PASS' && cacheB.verdict === 'PASS' ? 'PASS' : 'FAIL', `${cacheA.detail}; ${cacheB.detail}`);
  } finally {
    await stopServer(server);
  }

  // --- AC3b: rete, solo se autorizzata ---
  if (!network) {
    add('AC3b', 'BLOCKED', 'entries > 0 richiede uno stream reale: --network --stream-id <id> (autorizzazione esplicita)');
  } else if (!streamId) {
    add('AC3b', 'BLOCKED', '--network senza --stream-id');
  } else {
    server = await startServer();
    try {
      const before = (await fetchStatus(server)).body?.cache?.entries;
      const res = await fetch(`${server.base}/stream/series/${encodeURIComponent(streamId)}.json`, { signal: AbortSignal.timeout(90000) });
      const text = await res.text();
      let streams = 0;
      try {
        streams = JSON.parse(text)?.streams?.length || 0;
      } catch {}
      saveProbe('stream.json', { status: res.status, streams, bytes: text.length });
      const after = (await fetchStatus(server)).body?.cache?.entries;
      if (streams === 0) add('AC3b', 'BLOCKED', `nessuno stream da ${streamId} (rete/provider)`);
      else if (after > before) add('AC3b', 'PASS', `entries ${before} -> ${after} dopo ${streams} stream (1 richiesta)`);
      else add('AC3b', 'FAIL', `entries ${before} -> ${after} con ${streams} stream`);
    } finally {
      await stopServer(server);
    }
  }
  } // fine blocco status
} catch (e) {
  if (!e?.handled) console.error(e);
} finally {
  for (const id of IDS) if (!checks.some((c) => c.id === id)) add(id, 'BLOCKED', 'verifica non eseguita');
  fs.rmSync(tmp, { recursive: true, force: true });
  const summary = {
    pass: checks.filter((c) => c.verdict === 'PASS').length,
    fail: checks.filter((c) => c.verdict === 'FAIL').length,
    blocked: checks.filter((c) => c.verdict === 'BLOCKED').length,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({
    feature,
    sourceFingerprint: fingerprint,
    artifact: artifact || null,
    startedAt,
    finishedAt: new Date().toISOString(),
    commands,
    env: { ANIME_MAPPING_URL: '', providers: 'false', secretsRedacted: true },
    checks,
    summary,
    buildLog,
  }, null, 2) + '\n');
  console.log(`\n${feature}: PASS ${summary.pass} - FAIL ${summary.fail} - BLOCKED ${summary.blocked}`);
  for (const c of checks) console.log(`  ${c.id}: ${c.verdict} — ${c.detail}`);
  console.log(`risultati: ${outFile}`);
  process.exitCode = summary.fail ? 1 : 0;
}
