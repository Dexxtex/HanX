// Delta del catalogo di Saturn: la sitemap dichiara `<lastmod>` per ogni scheda,
// quindi si rileggono solo quelle cambiate invece di tutte e 6.181.
//
// Primo giro (`--bootstrap`): le schede gia' in catalogo non hanno `lastmod`,
// quindi si prende quello della sitemap **senza rileggere** — i dati sono quelli
// dell'ultimo crawl completo. Dal giro dopo il confronto e' vero e si legge solo
// il cambiato (94 schede negli ultimi 7 giorni, misurato l'11/11).
//
// La scheda si legge e si aborta a 32 KB: `div.ag-links` finisce fra 28.618 e
// 29.520 byte su 10 schede da 82 KB a 650 KB, quindi il blocco con gli id c'e'
// sempre. Se l'abort lascia un documento senza `ag-links`, si rilegge intera.
//
//   node scripts/ops/delta-saturn.mjs --bootstrap   # 1 richiesta, 0 schede
//   node scripts/ops/delta-saturn.mjs               # solo le cambiate
//   node scripts/ops/delta-saturn.mjs --publish     # e force-pusha su `data`
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseSaturnAnimeSitemap, parseCardDetails } from '../../dist/catalog/sync.js';

const REPO = process.env.GITHUB_REPO || 'Dexxtex/HanX';
const RAW = `https://raw.githubusercontent.com/${REPO}`;
const BASE = 'https://www.animesaturn.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const OUT = path.join('data', 'delta');
const ABORT_AT = 32 * 1024;
const INTERVAL_MS = Number(process.env.CATALOG_INTERVAL_MS) || 1000;
const bootstrap = process.argv.includes('--bootstrap');
// `--since=YYYY-MM-DD`: in bootstrap si seminano solo le schede cambiate PRIMA
// di quella data. Quelle cambiate dopo vanno lette, altrimenti il primo giro
// marchebbe come "visto" un dato che non e' mai stato letto.
const since = (process.argv.find((a) => a.startsWith('--since=')) || '').split('=')[1] || '';
const publish = process.argv.includes('--publish');

let slot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una richiesta alla volta, 1 s. `maxBytes` abortisce la lettura del corpo. */
async function get(url, maxBytes = 0) {
  const wait = slot - Date.now();
  if (wait > 0) await sleep(wait);
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'it-IT,it;q=0.9' }, signal: AbortSignal.timeout(20000) });
  slot = Date.now() + INTERVAL_MS;
  if (res.status === 403 || res.status === 429) {
    console.log(`BLOCCATO ${res.status} su ${url} — stop`);
    process.exit(1);
  }
  if (!res.ok) return { status: res.status, body: '' };
  if (!maxBytes) return { status: res.status, body: await res.text() };
  // Lettura a pezzi: si smette appena il blocco con gli id e' dentro.
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return { status: res.status, body: Buffer.concat(chunks).toString('utf8'), truncated: true };
}

const catalogs = JSON.parse(fs.readFileSync(path.join('data', 'catalogs.json'), 'utf8'));
const stored = new Map((catalogs.sites.saturn || []).map((e) => [e.slug, e]));

// 1. La sitemap: slug, url e lastmod di tutte le schede (1 richiesta).
const index = await get(`${BASE}/sitemap.xml`);
const parts = [...index.body.matchAll(/<loc>([^<]*sitemap-anime-\d+\.xml)<\/loc>/g)].map((m) => m[1]);
if (!parts.length) throw new Error('sitemap index senza parti /sitemap-anime-*.xml');
const sitemap = [];
for (const part of parts) sitemap.push(...parseSaturnAnimeSitemap((await get(part)).body));
console.log(`sitemap: ${sitemap.length} schede, ${new Set(sitemap.map((e) => e.lastmod)).size} date distinte`);

// 2. Chi rileggere.
const toRead = [];
const entries = [];
let kept = 0;
let seeded = 0;
for (const item of sitemap) {
  const old = stored.get(item.slug);
  if (!old) {
    toRead.push(item);
    continue;
  }
  if (old.lastmod && old.lastmod === item.lastmod) {
    entries.push(old);
    kept += 1;
    continue;
  }
  if (!old.lastmod) {
    // Bootstrap: la scheda c'e' gia' e i suoi dati sono dell'ultimo crawl
    // completo. Si prende solo la data, senza pagare la richiesta — ma solo se
    // la scheda non e' cambiata dopo `--since`.
    if (bootstrap && (!since || !item.lastmod || item.lastmod < since)) {
      entries.push({ ...old, ...(item.lastmod ? { lastmod: item.lastmod } : {}) });
      seeded += 1;
      continue;
    }
    toRead.push(item);
    continue;
  }
  toRead.push(item);
}
console.log(`invariate: ${kept} | data presa dalla sitemap senza rileggere: ${seeded} | da rileggere: ${toRead.length}`);

// 3. Le cambiate: una richiesta l'una, abortita a 32 KB.
let read = 0;
let full = 0;
for (const item of toRead) {
  const old = stored.get(item.slug);
  const short = await get(item.url, ABORT_AT);
  let body = short.body;
  // Senza il blocco degli id l'abort ha tagliato troppo: si rilegge intera.
  if (!body.includes('myanimelist.net/anime/')) {
    body = (await get(item.url)).body;
    full += 1;
  }
  const details = parseCardDetails(body, 'saturn');
  const entry = {
    ...(old || {}),
    site: 'saturn',
    slug: item.slug,
    url: item.url,
    titleSite: old?.titleSite || item.titleSite,
    ...(item.lastmod ? { lastmod: item.lastmod } : {}),
  };
  // Il titolo vero sta nel JSON-LD: quello dello slug e' un ripiego.
  const realTitle = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  try {
    const name = String(JSON.parse(realTitle || '{}').name || '').trim();
    if (name) entry.titleSite = name;
  } catch {
    // JSON-LD rotto: resta il titolo che c'era.
  }
  const aliases = new Set(entry.titles || []);
  for (const t of details.titles || []) if (t !== entry.titleSite) aliases.add(t);
  if (aliases.size) entry.titles = [...aliases];
  for (const key of ['year', 'episodes', 'startDate', 'language', 'anilistId', 'malId']) {
    if (details[key] !== undefined && details[key] !== null) entry[key] = details[key];
  }
  entries.push(entry);
  read += 1;
  if (read % 25 === 0) console.log(`  … ${read}/${toRead.length}`);
}

// 4. Le schede sparite dalla sitemap escono dal catalogo.
const seen = new Set(sitemap.map((e) => e.slug));
const removed = (catalogs.sites.saturn || []).filter((e) => !seen.has(e.slug)).length;
// L'ordine resta quello della sitemap (lo stesso del crawl): riordinare
// cambierebbe il diff di tutte le schede per niente.
catalogs.sites.saturn = entries;

const withMal = entries.filter((e) => e.malId).length;
console.log(`schede: ${entries.length} (lette ${read}, di cui intere ${full}) | con malId ${withMal} | rimosse ${removed}`);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'catalogs.json'), JSON.stringify(catalogs));
console.log(`scritto in ${OUT}/`);

if (publish) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-saturn-'));
  for (const file of ['catalogs.json']) fs.copyFileSync(path.join(OUT, file), path.join(work, file));
  const marker = await fetch(`${RAW}/data/last-sync.txt`, { signal: AbortSignal.timeout(30000) });
  if (marker.ok) fs.writeFileSync(path.join(work, 'last-sync.txt'), await marker.text());
  const git = (...args) => execFileSync('git', args, { cwd: work, stdio: 'pipe' });
  git('init', '-q', '-b', 'data');
  // Si pubblica solo il catalogo completo: l'indice (`catalog-titles.json`) lo
  // costruisce l'addon all'avvio, e tenerlo sul branch era un secondo file da
  // 5,6 MB per notte.
  const files = ['catalogs.json'];
  if (fs.existsSync(path.join(work, 'last-sync.txt'))) files.push('last-sync.txt');
  git('add', ...files);
  git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-qm', 'chore(catalog): delta saturn');
  git('remote', 'add', 'origin', `https://github.com/${REPO}.git`);
  git('push', '-q', '-f', 'origin', 'data');
  console.log('pubblicato sul branch data');
}
