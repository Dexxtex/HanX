// Riempie `malId` nelle schede del catalogo che non ce l'hanno, senza toccare i
// siti: il ponte sono i titoli del mapping (indice + ledger), che già conoscono
// malId -> kitsuId -> titoli. Solo i titoli che puntano a **un solo** malId:
// un titolo ambiguo (2+ malId) si scarta, perché un malId sbagliato serve
// l'anime sbagliato.
//
// Il risultato persiste: `carryOverProgress` riporta `malId` dal catalogo
// pubblicato ieri, quindi il sync notturno non lo perde.
//
//   node scripts/ops/backfill-malids.mjs            # scrive in data/backfill/
//   node scripts/ops/backfill-malids.mjs --publish  # e force-pusha sul branch data
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = process.env.GITHUB_REPO || 'Dexxtex/HanX';
const RAW = `https://raw.githubusercontent.com/${REPO}`;
const OUT = path.join('data', 'backfill');
const publish = process.argv.includes('--publish');

const norm = (v) =>
  String(v || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** "Nome (ITA)" e "Nome" sono la stessa scheda. */
const stripLang = (v) => norm(String(v || '').replace(/\s*\((ITA|SUB ITA|ITA\/SUB ITA|SUB)\)\s*$/i, ''));

// Sempre dal branch: `data/` locale è il catalogo di giorni fa e riempirebbe
// malId su schede che nel frattempo sono cambiate. `--local` per provare offline.
const local = process.argv.includes('--local');
async function load(url, file) {
  if (local && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// `--publish-only`: pubblica quello che c'è in `data/backfill/` e basta. Serve
// quando il catalogo arriva da un'altra macchina (il backfill dalla pagina gira
// sul server): rifare il fill partirebbe dal branch e perderebbe quel lavoro.
if (process.argv.includes('--publish-only')) {
  await publishFiles();
  process.exit(0);
}

const [index, ledger, catalogs, titles] = await Promise.all([
  load(`${RAW}/mapping/anime-seasons.json`, 'data/anime-seasons.json'),
  load(`${RAW}/mapping/jikan-progress.json`, 'data/jikan-progress.json'),
  // `CATALOG_FILE` serve quando il catalogo arriva da un'altra macchina (il
  // backfill dalla pagina gira sul server): non è ancora pubblicato.
  process.env.CATALOG_FILE
    ? JSON.parse(fs.readFileSync(process.env.CATALOG_FILE, 'utf8'))
    : load(`${RAW}/data/catalogs.json`, 'data/catalogs.json'),
  load(`${RAW}/data/catalog-titles.json`, 'data/catalog-titles.json'),
]);

// kitsuId -> malId, dai record del ledger.
const malByKitsu = new Map();
for (const [malId, record] of Object.entries(ledger.done || {})) {
  if (record?.kitsuId) malByKitsu.set(String(record.kitsuId), String(malId));
}

// titolo normalizzato -> Set(malId)
const byTitle = new Map();
const add = (title, malId) => {
  const key = stripLang(title);
  if (!key || !malId) return;
  if (!byTitle.has(key)) byTitle.set(key, new Set());
  byTitle.get(key).add(String(malId));
};
// `title` (inglese MAL) e `tmdbTitle` sono entrambi verificati sul malId:
// controllati su Tenrai, mal 59791 = "Ruri no Houseki"/"Ruri Rocks", ecc.
// `titleIt` no: è un titolo italiano che può esistere per più opere.
for (const [malId, record] of Object.entries(ledger.done || {})) {
  add(record?.title, malId);
  add(record?.tmdbTitle, malId);
}
for (const entry of Object.values(index.movies || {})) {
  const malId = entry?.kitsuId ? malByKitsu.get(String(entry.kitsuId)) : null;
  for (const t of [entry.title, entry.titleAlt]) add(t, malId);
}
for (const entry of Object.values(index.series || {})) {
  for (const ranges of Object.values(entry.seasons || {})) {
    for (const range of ranges) {
      const malId = range?.kitsuId ? malByKitsu.get(String(range.kitsuId)) : null;
      add(range.title, malId);
      add(range.titleAlt, malId);
    }
  }
}

/** Il malId della scheda, solo se esattamente un titolo porta a uno solo. */
function resolve(candidates, map) {
  const found = new Set();
  for (const title of candidates) {
    for (const malId of map.get(stripLang(title)) || []) found.add(malId);
  }
  if (found.size !== 1) return { malId: null, ambiguous: found.size > 1 };
  const [malId] = found;
  return { malId: Number(malId), ambiguous: false };
}

const stats = {};
const written = new Set();
const fill = (label, list, pickTitles, map = byTitle, requireLedger = true) => {
  const s = (stats[label] ||= { filled: 0, ambiguous: 0, unmatched: 0 });
  for (const entry of list) {
    if (entry.malId) continue;
    const { malId, ambiguous } = resolve(pickTitles(entry), map);
    if (malId && (!requireLedger || ledger.done[String(malId)])) {
      entry.malId = malId;
      if (requireLedger) written.add(String(malId));
      s.filled += 1;
    } else if (ambiguous) s.ambiguous += 1;
    else s.unmatched += 1;
  }
};

for (const [site, list] of Object.entries(catalogs.sites || {})) {
  fill(`catalogs ${site}`, list, (e) => [e.titleSite, ...(Array.isArray(e.titles) ? e.titles : [])]);
}

// Secondo passo: **il catalogo è il suo dizionario**. Una scheda che ha il malId
// lo insegna alle altre che hanno lo stesso titolo — i tre siti chiamano la
// stessa opera allo stesso modo, e il titolo di un sito è più vicino a quello
// di un altro sito che al titolo MAL in inglese. Zero richieste: i dati sono
// già qui. Si ricostruisce la mappa dopo il primo passo, che ha aggiunto voci.
const byCatalogTitle = new Map();
for (const list of Object.values(catalogs.sites || {})) {
  for (const entry of list) {
    if (!entry.malId) continue;
    for (const title of [entry.titleSite, ...(Array.isArray(entry.titles) ? entry.titles : [])]) {
      const key = stripLang(title);
      if (!key) continue;
      if (!byCatalogTitle.has(key)) byCatalogTitle.set(key, new Set());
      byCatalogTitle.get(key).add(String(entry.malId));
    }
  }
}
for (const [site, list] of Object.entries(catalogs.sites || {})) {
  fill(`catalogo ${site}`, list, (e) => [e.titleSite, ...(Array.isArray(e.titles) ? e.titles : [])], byCatalogTitle, false);
}
// `catalog-titles.json` è lo stesso catalogo in forma ridotta: prima si copia
// per slug quello che il file completo ha già risolto, poi si prova il resto.
const malBySlug = new Map();
for (const list of Object.values(catalogs.sites || {})) {
  for (const entry of list) if (entry.malId) malBySlug.set(entry.slug, entry.malId);
}
for (const list of Object.values(titles.sites || {})) {
  for (const entry of list) {
    const malId = malBySlug.get(entry.slug);
    if (!entry.malId && malId) entry.malId = malId;
  }
}
for (const [site, list] of Object.entries(titles.sites || {})) {
  fill(`titles   ${site}`, list, (e) => [e.title, ...(Array.isArray(e.aliases) ? e.aliases : [])]);
}

// Autocontrollo: ogni malId che ho scritto io esiste nel ledger. (Non si
// controllano quelli già presenti: arrivano dalle schede dei siti e il ledger
// non li conosce tutti.)
for (const malId of written) {
  if (!ledger.done[malId]) throw new Error(`malId ${malId} scritto ma non nel ledger`);
}

for (const [label, s] of Object.entries(stats)) {
  console.log(`${label.padEnd(16)} riempiti ${String(s.filled).padStart(5)} | ambigui ${String(s.ambiguous).padStart(4)} | senza match ${String(s.unmatched).padStart(4)}`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'catalogs.json'), JSON.stringify(catalogs));
fs.writeFileSync(path.join(OUT, 'catalog-titles.json'), JSON.stringify(titles));
console.log(`scritto in ${OUT}/`);

async function publishFiles() {
  const files = ['catalogs.json', 'catalog-titles.json'];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'data-backfill-'));
  for (const file of files) fs.copyFileSync(path.join(OUT, file), path.join(work, file));
  // Il marcatore del sync vive sullo stesso branch: senza, la run notturna
  // rifarebbe il crawl credendo di non aver mai sincronizzato.
  const marker = await fetch(`${RAW}/data/last-sync.txt`, { signal: AbortSignal.timeout(30_000) });
  if (marker.ok) fs.writeFileSync(path.join(work, 'last-sync.txt'), await marker.text());
  const git = (...args) => execFileSync('git', args, { cwd: work, stdio: 'pipe' });
  git('init', '-q', '-b', 'data');
  git('add', ...files, ...(fs.existsSync(path.join(work, 'last-sync.txt')) ? ['last-sync.txt'] : []));
  git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-qm', 'chore(catalog): malId dal mapping');
  git('remote', 'add', 'origin', `https://github.com/${REPO}.git`);
  git('push', '-q', '-f', 'origin', 'data');
  console.log('pubblicato sul branch data');
}

if (publish) await publishFiles();
