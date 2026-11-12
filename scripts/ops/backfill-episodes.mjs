// Riempie `ep` (coppie [numero, id]) nelle schede del catalogo che non ce
// l'hanno. Il provider usa quelle coppie per saltare la pagina della serie:
// ogni hop è un secondo di pacing, quindi è il guadagno più diretto che resta.
//
//   node scripts/ops/backfill-episodes.mjs                  # saturn + unity + world
//   node scripts/ops/backfill-episodes.mjs --site unity --limit 500
//   node scripts/ops/backfill-episodes.mjs --resume         # riprende dal file salvato
//   node scripts/ops/backfill-episodes.mjs --gap 500        # 2 req/s (misurato, vedi sotto)
//   node scripts/ops/backfill-episodes.mjs --publish        # e pusha sul branch data
//
// Un sito alla volta, una richiesta alla volta, 1 s di intervallo, stop sul
// primo 403/429: è lo stesso budget dei probe, e i siti sono protetti da
// Cloudflare.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fetch as undiciFetch } from 'undici';
import { parseCardDetails } from '../../dist/catalog/sync.js';
import { proxyDispatcher } from '../../dist/catalog/proxy.js';

const REPO = process.env.GITHUB_REPO || 'Dexxtex/HanX';
const RAW = `https://raw.githubusercontent.com/${REPO}`;
const OUT = path.join('data', 'backfill');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15_000;
const SAVE_EVERY = 100;
/** `info_api` accetta al massimo 120 episodi per chiamata. */
const UNITY_CHUNK = 120;
/** Oltre questo si smette di chiedere: nessuna serie ha 1200 episodi veri. */
const UNITY_MAX_CHUNKS = 10;

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const sites = arg('--site') ? [arg('--site')] : ['saturn', 'unity', 'world'];
/**
 * 1 s è la tariffa prudente. Il pavimento è 83 ms (12 req/s): l'11/11 la rampa
 * con stop al primo 429 ha misurato Saturn 12 req/s (50/50) e World 12 (200/200)
 * sulle pagine HTML; Unity si ferma a 8. Lo script si ferma comunque al primo
 * blocco e salva ogni 100.
 */
const GAP_MS = Math.max(83, Number(arg('--gap')) || 1000);
/**
 * Stesso IP residenziale del sync: i runner escono da datacenter e i siti sono
 * dietro Cloudflare. Vuoto = diretto.
 */
const PROXY = String(process.env.CATALOG_PROXY || process.env.AU_PROXY || '').trim();
const DISPATCHER = proxyDispatcher(PROXY);
/**
 * Richieste in volo insieme. 4 contemporanee a 500 ms fanno ~8 req/s: provato con
 * 200 richieste consecutive su /play di World, zero 403/429. Con 1 resta la
 * tariffa sicura (1 req/s). Ogni worker ha il proprio intervallo, quindi il gap
 * vale per richiesta e non per il gruppo.
 */
const CONCURRENCY = Math.max(1, Number(arg('--concurrency')) || 1);
const limit = Number(arg('--limit')) || Infinity;
const publish = process.argv.includes('--publish');
const local = process.argv.includes('--local');
/** Riprende dal file salvato: contiene già il lavoro fatto (e non ancora pubblicato). */
const resume = process.argv.includes('--resume');
/** Rilegge tutte le schede Saturn per correggere `type`, che il vecchio listing sbagliava. */
const refreshTypes = process.argv.includes('--types');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Errore del WAF: si smette, insistere prolunga il blocco. */
class Blocked extends Error {}

/** Un pacer per worker: il gap e' per richiesta, non per il gruppo. */
function makePacer(gapMs = GAP_MS) {
  let last = 0;
  return async () => {
    const wait = gapMs - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}

async function get(url, headers = {}, pace = makePacer()) {
  await pace();
  const res = await undiciFetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...(DISPATCHER ? { dispatcher: DISPATCHER } : {}),
  });
  if (res.status === 403 || res.status === 429) throw new Blocked(`${res.status} ${url}`);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

async function loadCatalog() {
  if (resume && fs.existsSync(path.join(OUT, 'catalogs.json'))) {
    console.log('[ep] riprendo da', path.join(OUT, 'catalogs.json'));
    return JSON.parse(fs.readFileSync(path.join(OUT, 'catalogs.json'), 'utf8'));
  }
  if (local && fs.existsSync(path.join('data', 'catalogs.json'))) {
    return JSON.parse(fs.readFileSync(path.join('data', 'catalogs.json'), 'utf8'));
  }
  if (process.env.CATALOG_FILE) {
    return JSON.parse(fs.readFileSync(process.env.CATALOG_FILE, 'utf8'));
  }
  const res = await fetch(`${RAW}/data/catalogs.json`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} catalogo dal branch data`);
  return res.json();
}

/** `4354-ippon-again` -> 4354. */
const unityId = (slug) => Number(String(slug || '').split('-')[0]) || 0;

/** Tutti gli episodi di una scheda Unity in blocchi da 120 (3,8 KB l'uno). */
async function unityEpisodes(entry, pace) {
  const animeId = unityId(entry.slug);
  if (!animeId) return null;
  const total = Number(entry.episodes) || 0;
  const chunks = Math.min(UNITY_MAX_CHUNKS, Math.max(1, Math.ceil(total / UNITY_CHUNK)));
  const pairs = [];
  const seen = new Set();
  for (let chunk = 0; chunk < chunks; chunk += 1) {
    const start = chunk * UNITY_CHUNK + 1;
    const res = await get(
      `https://www.animeunity.co/info_api/${animeId}/1?start_range=${start}&end_range=${start + UNITY_CHUNK - 1}`,
      { Referer: 'https://www.animeunity.co/', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, */*' },
      pace
    );
    const payload = await res.json().catch(() => null);
    const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];
    if (!episodes.length) break;
    for (const item of episodes) {
      const id = Number(item?.id);
      const num = Number(String(item?.number ?? '').match(/(\d{1,4})/)?.[1]);
      if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(num) || num <= 0 || seen.has(num)) continue;
      seen.add(num);
      pairs.push([num, id]);
    }
  }
  return { ep: pairs.length ? pairs.sort((a, b) => a[0] - b[0]) : null };
}

/** La pagina serie di World porta le coppie [numero, token] nelle anchor. */
async function worldEpisodes(entry, pace) {
  const res = await get(entry.url, {}, pace);
  const html = await res.text();
  return { ep: parseCardDetails(html, 'world').ep || null };
}

/**
 * La pagina serie di Saturn porta le anchor `/episode/<slug>/ep-<n>`. Il token è
 * derivabile da `episodes`, ma non sempre: `dies-irae` ha `ep-0` (prologo) e
 * `numberOfEpisodes` null, quindi 1..N salterebbe un episodio.
 */
async function saturnEpisodes(entry, pace) {
  const res = await get(entry.url, {}, pace);
  const html = await res.text();
  // Il tipo sta nella stessa pagina: leggerlo qui evita una seconda passata.
  const type = html.match(/Tipo<\/span>[\s\S]{0,300}?>(TV|Movie|OVA|ONA|Special)</)?.[1];
  const pairs = [];
  const seen = new Set();
  for (const match of html.matchAll(/\/episode\/[^"']*?\/(ep-\d+)/g)) {
    const num = Number(match[1].slice(3));
    if (!Number.isFinite(num) || seen.has(num)) continue;
    seen.add(num);
    pairs.push([num, match[1]]);
  }
  return { ep: pairs.length ? pairs.sort((a, b) => a[0] - b[0]) : null, type };
}

const FETCHERS = { saturn: saturnEpisodes, unity: unityEpisodes, world: worldEpisodes };

function save(catalog) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'catalogs.json');
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(catalog)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

const catalog = await loadCatalog();
const startedAt = Date.now();
let done = 0;
let filled = 0;
let retyped = 0;
let blocked = null;

// Coda unica su tutti i siti: i worker la svuotano in ordine, ognuno col proprio
// intervallo. Con `--concurrency 1` è il vecchio ciclo sequenziale.
const queue = [];
for (const site of sites) {
  const entries = catalog.sites?.[site] || [];
  // `ep: []` è la marca di "già controllata, non ha episodi": senza, ogni run
  // riproverebbe le stesse serie annunciate.
  // Saturn ha anche il tipo da riempire: la pagina va letta finché manca uno dei due.
  const pending = entries.filter((entry) => {
    if (!entry.slug || !entry.url) return false;
    if (refreshTypes) return site === 'saturn';
    return entry.ep === undefined || (site === 'saturn' && !entry.type);
  });
  console.log(`[ep] ${site}: ${pending.length} schede senza ep (su ${entries.length})`);
  for (const entry of pending) queue.push({ site, entry });
}

let cursor = 0;
async function worker() {
  const pace = makePacer();
  while (!blocked && done < limit) {
    const item = queue[cursor++];
    if (!item) break;
    const { site, entry } = item;
    try {
      const got = await FETCHERS[site](entry, pace);
      // Una scheda che aveva già `ep` non si azzera: la pagina può rispondere
      // senza anchor per un guasto transitorio.
      if (got.ep?.length) entry.ep = got.ep;
      else if (entry.ep === undefined) entry.ep = [];
      if (got.type && got.type !== entry.type) {
        entry.type = got.type;
        retyped += 1;
      }
      if (entry.ep.length) filled += 1;
      done += 1;
    } catch (error) {
      if (error instanceof Blocked) {
        blocked = error.message;
        break;
      }
      done += 1;
      console.warn(`[ep] ${site} ${entry.slug}: ${error.message}`);
    }
    if (done % SAVE_EVERY === 0) {
      save(catalog);
      const rate = done / ((Date.now() - startedAt) / 1000);
      console.log(`[ep] ${done} lette, ${filled} riempite, ${rate.toFixed(2)}/s`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

save(catalog);
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
console.log(`[ep] ${done} schede lette, ${filled} riempite, ${retyped} tipi corretti in ${elapsed}s -> ${path.join(OUT, 'catalogs.json')}`);
if (blocked) {
  console.error(`[ep] BLOCCATO (${blocked}): stop immediato, il file salvato è valido`);
  process.exit(1);
}
if (publish) {
  // La pubblicazione è la stessa del backfill dei malId: un solo pezzo di git
  // plumbing, già usato, invece di un secondo che può divergere.
  execFileSync('node', ['scripts/ops/backfill-malids.mjs', '--publish-only'], { stdio: 'inherit' });
}
