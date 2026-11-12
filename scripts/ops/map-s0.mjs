// Aggiunge al mapping i range di stagione 0 (specials) per le schede
// OVA/ONA/Special che non hanno un kitsuId: il codice li accetta gia' purche'
// abbiano un `title` diverso da quello della serie madre (resolveSeasonRanges).
//
// Legge il dump della sonda (`scripts/research/s0-full-*.json`), quindi non fa
// richieste: l'episodio e' gia' stato identificato e classificato.
//
//   node scripts/ops/map-s0.mjs --mapping data/anime-seasons.json [--write]
//
// Senza `--write` stampa solo cosa farebbe.
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const mappingFile = arg('--mapping', 'data/anime-seasons.json');
const dumpFile = arg('--dump', 'scripts/research/s0-full-2026-11-12.json');
const catalogoFile = arg('--catalogo', '.tmp/cat.json');
const write = process.argv.includes('--write');
// Solo le fasce con l'episodio identificato: A (nome + anno), B (data esatta),
// C (stesso anno, un solo candidato). D/E/F/G restano fuori.
const FASCE = new Set(['A', 'B', 'C']);

const stop = new Set(['ita', 'sub', 'the', 'and', 'of', 'a', 'to', 'in', 'wa', 'ga', 'no', 'ni', 'wo', 'de', 'x']);
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\(ita\)|\(sub ita\)|\bova\b|\bona\b|\bspecial\b|\bspecials\b|\bmovie\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const toks = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !stop.has(w)));
const ov = (a, b) => {
  const A = toks(a);
  const B = toks(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n += 1;
  return n / Math.min(A.size, B.size);
};
const anno = (x) => String(x || '').match(/(\d{4})/)?.[1] || null;

const dump = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));
const mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
const catalogo = JSON.parse(fs.readFileSync(catalogoFile, 'utf8'));
const perSlug = new Map();
for (const site of ['saturn', 'world', 'unity']) {
  for (const e of catalogo.sites[site] || []) perSlug.set(`${site}:${e.slug}`, e);
}

/** Stessa classificazione di `s0-campione.mjs`: le due devono restare allineate. */
function classifica(c) {
  const y = anno(c.startDate) || anno(c.year);
  const nomeOk = (e) => ov(e.name, c.title) >= 0.5 || (c.titles || []).some((x) => ov(e.name, x) >= 0.5);
  const punteggio = (e) => {
    const nome = Math.max(ov(e.name, c.title), ...(c.titles || []).map((x) => ov(e.name, x)));
    const ey = Number(anno(e.air));
    return { nome, distanza: y && Number.isFinite(ey) ? Math.abs(ey - Number(y)) : 99 };
  };
  const perNome = c.s0
    .filter((e) => {
      if (!nomeOk(e)) return false;
      const ey = anno(e.air);
      return !y || !ey || Math.abs(Number(ey) - Number(y)) <= 1;
    })
    .sort((a, b) => punteggio(b).nome - punteggio(a).nome || punteggio(a).distanza - punteggio(b).distanza);
  if (perNome.length) return { fascia: 'A', ep: perNome[0] };
  const madreOk = ov(c.tmdbTitle, c.title) > 0 || (c.titles || []).some((t) => ov(c.tmdbTitle, t) > 0);
  if (!madreOk) return { fascia: 'E', ep: null };
  const esatta = c.s0.filter((e) => c.startDate && e.air === c.startDate);
  if (esatta.length === 1) return { fascia: 'B', ep: esatta[0] };
  const stessoAnno = c.s0.filter((e) => e.air && anno(e.air) === y);
  if (stessoAnno.length === 1) return { fascia: 'C', ep: stessoAnno[0] };
  if (stessoAnno.length > 1) return { fascia: 'D', ep: null };
  return { fascia: 'F', ep: null };
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
  const { fascia, ep } = classifica(c);
  perFascia[fascia] = (perFascia[fascia] || 0) + 1;
  if (!FASCE.has(fascia) || !ep) continue;

  const scheda = perSlug.get(`${c.site}:${c.slug}`);
  const title = String(scheda?.titleSite || c.title || '').trim();
  if (!title) {
    saltati += 1;
    continue;
  }
  const episodes = Number(scheda?.episodes) || 1;
  // Se la scheda ha tanti episodi quanti ne ha S0, e' tutta la stagione 0
  // ("Freezing Specials": 6 ep, S0 6 ep): parte da 1, non dall'episodio che
  // ha fatto combaciare il nome.
  const from = episodes === c.s0.length ? 1 : Number(ep.n);
  // Solo l'episodio identificato: il match dice che la scheda e' QUELL'episodio,
  // non che gli altri della scheda siano quelli adiacenti di S0 ("Freezing
  // Specials" ha 6 episodi, S0 ne ha 12, il nome combacia sull'ultimo).
  const coperti = 1;
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
