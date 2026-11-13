// Aggiunge al mapping i range di stagione 0 (specials) per le schede
// OVA/ONA/Special che non hanno un kitsuId: il codice li accetta gia' purche'
// abbiano un `title` diverso da quello della serie madre (resolveSeasonRanges).
//
// Legge il dump della sonda TVDB (`scripts/research/s0-tvdb-*.json`), quindi non
// fa richieste: l'episodio e' gia' stato identificato. Le regole stanno in
// `s0-match.mjs`, condivise col report.
//
//   node scripts/ops/map-s0.mjs --mapping data/anime-seasons.json [--write]
//
// Senza `--write` stampa solo cosa farebbe.
import fs from 'node:fs';
import path from 'node:path';
import { classificaS0, FASCE_PROMUOVIBILI, TIPI_PROMUOVIBILI } from './s0-match.mjs';
import { kitsuUsedElsewhere } from '../../dist/mapping/index.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const mappingFile = arg('--mapping', 'data/anime-seasons.json');
const dumpFile = arg('--dump', 'scripts/research/s0-tvdb-2026-11-12.json');
const catalogoFile = arg('--catalogo', '.tmp/cat.json');
const write = process.argv.includes('--write');
// Solo le fasce con l'episodio identificato: A (nome + anno), B (data esatta),
// C (stesso anno, un solo candidato). D/E/F/G restano fuori.


// Le regole stanno in un punto solo: `s0-match.mjs`, condiviso col report.
const dump = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));
const mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
const catalogo = JSON.parse(fs.readFileSync(catalogoFile, 'utf8'));
const perSlug = new Map();
for (const site of ['saturn', 'world', 'unity']) {
  for (const e of catalogo.sites[site] || []) perSlug.set(`${site}:${e.slug}`, e);
}

let aggiunti = 0;
let serieNuove = 0;
let saltati = 0;
const perFascia = {};
const esempi = [];
// La stessa opera compare su piu' siti e in piu' edizioni ("DanMachi OVA",
// "DanMachi OVA (ITA)"): una sola mappatura per (madre, episodio), col titolo
// piu' corto, che e' quello che i provider trovano su tutti.
const perChiave = new Map();

for (const c of dump) {
  const scheda = perSlug.get(`${c.site}:${c.slug}`);
  const esito = classificaS0(c, scheda);
  const { fascia } = esito;
  const ep = esito.ep;
  perFascia[fascia] = (perFascia[fascia] || 0) + 1;
  // ONA fuori dalla promozione, per scelta: 59% di copertura e 61 casi su 133
  // senza segnale affidabile.
  // from null = piu' range alternativi: il resolver non ne sceglie uno, e
  // scriverne uno a caso nel mapping sarebbe la stessa assunzione di prima.
  if (!FASCE_PROMUOVIBILI.has(fascia) || !ep || esito.from === null) continue;
  if (!TIPI_PROMUOVIBILI.has(scheda?.type || '')) continue;
  const title = String(scheda?.titleSite || c.title || '').trim();
  if (!title) {
    saltati += 1;
    continue;
  }
  const { from, episodeCount: coperti } = esito;
  const key = `tmdb:${c.tmdbId}:${from}`;
  const cur = perChiave.get(key);
  if (!cur || title.length < cur.title.length) {
    perChiave.set(key, { tmdbId: c.tmdbId, tmdbTitle: c.tmdbTitle, from, title, episodeCount: coperti });
  }
}

/**
 * Le chiavi della stessa serie: `tmdb:`, `imdb:`, `tvdb:`. Stremio usa `tt:`,
 * Nuvio `tmdb:`, e il mapping le tiene separate: scrivere solo su `tmdb:`
 * lasciava `imdb:` con il range sbagliato del builder (che punta alla serie).
 */
const TMDB_KEY = String(process.env.TMDB_API_KEY || '').trim();
const GAP_MS = 125;
let slot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const extCache = new Map();

async function externalIds(tmdbId) {
  if (extCache.has(tmdbId)) return extCache.get(tmdbId);
  let value = { imdb_id: null, tvdb_id: null };
  if (TMDB_KEY) {
    const wait = slot - Date.now();
    if (wait > 0) await sleep(wait);
    slot = Date.now() + GAP_MS;
    try {
      const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_KEY}`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const j = await res.json();
        value = { imdb_id: j?.imdb_id || null, tvdb_id: j?.tvdb_id || null };
      }
    } catch {
      /* senza external_ids si scrive solo su tmdb: */
    }
  }
  extCache.set(tmdbId, value);
  return value;
}

/** Toglie i range S0 il cui kitsuId serve anche una stagione vera: il runtime li scarta. */
function pulisciS0(entry) {
  const s0 = Array.isArray(entry.seasons['0']) ? entry.seasons['0'] : [];
  return s0.filter((r) => !kitsuUsedElsewhere(entry, r?.kitsuId, 0));
}

for (const item of perChiave.values()) {
  const ext = await externalIds(item.tmdbId);
  const chiavi = [`tmdb:${item.tmdbId}`];
  if (ext.imdb_id) chiavi.push(`imdb:${ext.imdb_id}`);
  if (ext.tvdb_id) chiavi.push(`tvdb:${ext.tvdb_id}`);

  let scritto = false;
  for (const key of chiavi) {
    let entry = mapping.series[key];
    if (!entry || typeof entry !== 'object') {
      entry = { title: item.tmdbTitle || item.title, seasons: {} };
      mapping.series[key] = entry;
      serieNuove += 1;
    }
    if (!entry.seasons || typeof entry.seasons !== 'object') entry.seasons = {};
    // Prima si tolgono i range che il runtime scarta, poi si aggiunge il buono:
    // con lo stesso `from` il range sbagliato vinceva l'ordinamento.
    const s0 = pulisciS0(entry);
    if (s0.some((r) => Number(r?.from) === Number(item.from))) {
      entry.seasons['0'] = s0.sort((a, b) => Number(a.from) - Number(b.from));
      continue;
    }
    s0.push({ from: item.from, offset: item.from - 1, title: item.title, episodeCount: item.episodeCount });
    entry.seasons['0'] = s0.sort((a, b) => Number(a.from) - Number(b.from));
    scritto = true;
  }
  if (!scritto) {
    saltati += 1;
    continue;
  }
  aggiunti += 1;
  if (esempi.length < 10) {
    esempi.push(`${item.title} -> ${chiavi.join(', ')} S0 ep ${item.from}${item.episodeCount > 1 ? ` (${item.episodeCount} ep)` : ''}`);
  }
}

console.log(`dump: ${dump.length} schede con S0`);
console.log(`fasce: ${JSON.stringify(perFascia)}`);
console.log(`range aggiunti: ${aggiunti} | serie nuove: ${serieNuove} | saltati: ${saltati}`);
for (const e of esempi) console.log(`  ${e}`);

if (write) {
  const backup = `${mappingFile}.before-s0`;
  if (!fs.existsSync(backup)) fs.copyFileSync(mappingFile, backup);
  // Stessa indentazione del builder: il file resta confrontabile.
  fs.writeFileSync(`${mappingFile}.tmp`, `${JSON.stringify(mapping, null, 2)}\n`);
  fs.renameSync(`${mappingFile}.tmp`, mappingFile);
  console.log(`scritto ${path.resolve(mappingFile)} (backup: ${backup})`);
} else {
  console.log('dry-run: nessun file scritto (--write per applicare)');
}
