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

for (const item of perChiave.values()) {
  const key = `tmdb:${item.tmdbId}`;
  let entry = mapping.series[key];
  if (!entry || typeof entry !== 'object') {
    entry = { title: item.tmdbTitle || item.title, seasons: {} };
    mapping.series[key] = entry;
    serieNuove += 1;
  }
  if (!entry.seasons || typeof entry.seasons !== 'object') entry.seasons = {};
  const s0 = Array.isArray(entry.seasons['0']) ? entry.seasons['0'] : (entry.seasons['0'] = []);
  // Un range gia' presente per lo stesso episodio non si duplica: quelli che
  // arrivano da TVDB hanno anche il kitsuId, e sono piu' precisi.
  if (s0.some((r) => Number(r?.from) === Number(item.from))) {
    saltati += 1;
    continue;
  }
  // `offset` e' obbligatorio per `validateIndex`, anche se il runtime lo
  // ricaverebbe da `from`: senza, il build del mapping esce rosso.
  s0.push({ from: item.from, offset: item.from - 1, title: item.title, episodeCount: item.episodeCount });
  s0.sort((a, b) => Number(a.from) - Number(b.from));
  aggiunti += 1;
  if (esempi.length < 10) esempi.push(`${item.title} -> ${key} S0 ep ${item.from}${item.episodeCount > 1 ? ` (${item.episodeCount} ep)` : ''}`);
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
