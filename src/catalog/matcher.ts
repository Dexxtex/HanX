import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { debug } from '../utils/logger.js';
import { titleMatchScoreAny } from '../utils/anime-title-normalization.js';
import type { CatalogSite, TitleIndexEntry, TitleIndexFile } from './sync.js';

/** Sopra questa soglia il match è automatico; sotto 0.5 si ignora. */
const AUTO_SCORE = 0.8;
const REVIEW_SCORE = 0.5;
/** Due schede con punteggi così vicini sono in gara: decide stagione o tipo. */
const TIE_MARGIN = 0.05;
/** Oltre questa soglia il numero non è una stagione ("86 Eighty Six"). */
const MAX_SEASON = 20;
/** Schede che non sono episodi di una serie. */
const FORMAT_ONLY = /\b(?:movie|film|ova|oav|oad|ona|special|specials|recap|pilot)\b/i;
/** Un numero dopo questi token è la parte, non la stagione ("Dr. Stone 3 Part 2"). */
const PART_MARKERS = new Set(['part', 'cour', 'chapter', 'volume', 'vol', 'ep', 'episode']);

export type CatalogLanguage = 'ITA' | 'CR ITA' | 'SUB ITA';

export type CatalogBand = 'auto' | 'review' | 'low' | 'none';

export interface CatalogHit {
  slug: string;
  url: string;
  title: string;
  score: number;
  /** Etichetta di lingua ricavata dalla scheda: le varianti ita/sub sono schede diverse. */
  language: CatalogLanguage;
  /** Solo AnimeUnity: il tipo della scheda (TV/Movie). */
  type?: string;
}

export interface CatalogQueryOptions {
  /** Stagione richiesta dal mapping. Una scheda che dichiara un'altra stagione non si serve. */
  season?: number | null;
  /** Film, OVA o stagione 0. */
  isMovie?: boolean;
  /**
   * Id MAL della richiesta (`mal:1234`). Se il catalogo ha schede con quel
   * `mal_id` si servono quelle, senza fuzzy né tie-break: l'id identifica la
   * scheda, non il titolo che il sito le ha dato.
   */
  malId?: number | null;
}

export interface CatalogLookup {
  /** Schede servibili. Più di una quando sono varianti ita/sub della stessa opera. */
  hits: CatalogHit[];
  generatedAt: string | null;
}

let cached: { file: string; mtimeMs: number; data: TitleIndexFile } | null = null;

/** Cartella del catalogo: data/ del progetto, o CATALOG_DIR (test e deploy). */
export function catalogDir(): string {
  return process.env.CATALOG_DIR || path.join(fileURLToPath(new URL('../..', import.meta.url)), 'data');
}

export function catalogFile(): string {
  return path.join(catalogDir(), 'catalog-titles.json');
}

/** Rilegge il file solo se è cambiato: una stat per chiamata, 15k schede in memoria. */
function loadIndex(): TitleIndexFile | null {
  const file = catalogFile();
  try {
    const { mtimeMs } = fs.statSync(file);
    if (cached && cached.file === file && cached.mtimeMs === mtimeMs) return cached.data;
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as TitleIndexFile;
    if (!data || typeof data !== 'object' || !data.sites) return null;
    cached = { file, mtimeMs, data };
    return data;
  } catch {
    return null;
  }
}

function scoreEntry(queries: string[], entry: TitleIndexEntry): number {
  let best = titleMatchScoreAny(queries, entry.title);
  for (const alias of entry.aliases || []) {
    if (!alias) continue;
    const score = titleMatchScoreAny(queries, alias);
    if (score > best) best = score;
  }
  return best;
}

/** Forma della scheda senza id numerico di Unity, lingua e punteggiatura. */
export function cardBase(title: string): string {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\d{1,6}\s+(?=[a-z])/, '')
    .replace(/\b(?:ita|sub|cr|jap)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Lingua dichiarata nella scheda: "X (ITA)" -> ITA, "X (CR)" -> CR ITA. */
export function languageOf(title: string): CatalogLanguage {
  const text = ` ${String(title || '').toLowerCase()} `;
  if (/\bcr\b/.test(text)) return 'CR ITA';
  if (/\bita\b/.test(text)) return 'ITA';
  return 'SUB ITA';
}

/**
 * Stagione dichiarata dalla scheda. Si prende il primo numero che non sia una
 * parte ("Dr. Stone 3 Part 2" è stagione 3, non 2) e non sia l'id di Unity.
 */
export function seasonOf(title: string): number | null {
  const words = String(title || '')
    .toLowerCase()
    .replace(/^\d{1,6}\s+(?=[a-z])/, '')
    .replace(/[-_.]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (let index = 0; index < words.length; index += 1) {
    const match = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(words[index]);
    if (!match) continue;
    if (PART_MARKERS.has(words[index - 1] || '')) continue;
    const season = Number(match[1]);
    if (season > 0 && season <= MAX_SEASON) return season;
  }
  return null;
}

function isFormatEntry(entry: TitleIndexEntry): boolean {
  return FORMAT_ONLY.test(entry.title) || FORMAT_ONLY.test(String(entry.type || ''));
}

type Scored = { entry: TitleIndexEntry; score: number };

/**
 * Sceglie fra basi diverse. Con una stagione nota vince solo se esattamente una
 * base ha quella stagione (o non ne dichiara nessuna): se più basi o nessuna
 * combaciano non si serve niente (DECISIONS #1, un id sbagliato è peggio di un buco).
 */
function resolveTie(groups: Scored[][], context: { season: number | null; isFilm: boolean }): Scored[] | null {
  if (context.season !== null && !context.isFilm) {
    const anyNumbered = groups.some((items) => items.some((item) => seasonOf(item.entry.title) !== null));
    const matching = groups.filter((items) =>
      items.every((item) => (seasonOf(item.entry.title) ?? (anyNumbered ? 1 : null)) === context.season)
    );
    return matching.length === 1 ? matching[0] : null;
  }
  const compatible = groups.filter((items) =>
    context.isFilm ? items.every((item) => isFormatEntry(item.entry)) : !items.some((item) => isFormatEntry(item.entry))
  );
  return compatible.length === 1 ? compatible[0] : null;
}

/**
 * Cerca il titolo nel catalogo locale di un sito. Il punteggio è quello dei
 * provider (`titleMatchScore`: forma grezza senza stopword, quindi "Mission-E"
 * combacia con "MissionE", e 0.9 quando la query chiude il titolo del sito).
 *
 * Restituisce solo i match positivi: il catalogo non è abbastanza completo per
 * dire che un titolo non c'è (vedi README), quindi l'assenza non ferma la rete.
 */
export function lookupTitle(site: CatalogSite, queries: string[], options?: CatalogQueryOptions): CatalogLookup {
  const clean = queries.map((query) => String(query || '').trim()).filter(Boolean);
  const index = loadIndex();
  const entries = index?.sites?.[site] || [];
  const generatedAt = typeof index?.generatedAt === 'string' ? index.generatedAt : null;
  const wantedMal = Number.isInteger(options?.malId) && Number(options?.malId) > 0 ? Number(options?.malId) : null;
  if (wantedMal !== null) {
    const exact = entries.filter((entry) => entry.malId === wantedMal);
    if (exact.length) {
      const hits: CatalogHit[] = exact.map((entry) => ({
        slug: entry.slug,
        url: entry.url,
        title: entry.title,
        score: 1,
        language: languageOf(entry.title),
        ...(entry.type ? { type: entry.type } : {}),
      }));
      // ITA e SUB della stessa opera possono condividere il mal_id: si servono entrambe.
      debug(2, 'Catalog', JSON.stringify({ t: 'catalog-lookup', site, query: `mal:${wantedMal}`, slug: hits[0].slug, score: 1, band: 'auto', served: true, tie: null }));
      return { hits, generatedAt };
    }
  }
  const wantedSeason = Number.isInteger(options?.season) && Number(options?.season) > 0 ? Number(options?.season) : null;
  // `season: null` non è un film: solo 0 esplicito lo è.
  const isFilm = options?.isMovie === true || options?.season === 0;

  const all: Scored[] = [];
  if (clean.length) {
    for (const entry of entries) {
      const score = scoreEntry(clean, entry);
      if (score > 0) all.push({ entry, score });
    }
  }
  const scoreBest = all.reduce((max, item) => Math.max(max, item.score), 0);
  const band: CatalogBand =
    scoreBest >= AUTO_SCORE ? 'auto' : scoreBest >= REVIEW_SCORE ? 'review' : scoreBest > 0 ? 'low' : 'none';

  // Una scheda che dichiara un'altra stagione non è quella richiesta. Le schede
  // senza numero restano: i siti tengono spesso una sola pagina per serie.
  const wanted = all.filter((item) => {
    if (item.score < REVIEW_SCORE) return false;
    if (wantedSeason === null || isFilm) return true;
    const season = seasonOf(item.entry.title);
    return season === null || season === wantedSeason;
  });
  const best = wanted.reduce((max, item) => Math.max(max, item.score), 0);
  let selected = best ? wanted.filter((item) => item.score >= best - TIE_MARGIN) : [];

  // Varianti ita/sub della stessa opera: stesso gruppo, si servono tutte.
  const groups = new Map<string, Scored[]>();
  for (const item of selected) {
    const key = cardBase(item.entry.title) || item.entry.slug;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  let tie: { slug: string; score: number }[] | null = null;
  if (groups.size > 1) {
    tie = selected.slice(0, 5).map((item) => ({ slug: item.entry.slug, score: Number(item.score.toFixed(2)) }));
    selected = resolveTie([...groups.values()], { season: wantedSeason, isFilm }) || [];
  }

  const hits: CatalogHit[] =
    band === 'auto'
      ? selected.map(({ entry, score }) => ({
          slug: entry.slug,
          url: entry.url,
          title: entry.title,
          score,
          language: languageOf(entry.title),
          ...(entry.type ? { type: entry.type } : {}),
        }))
      : [];

  // Una riga sola per lookup da rivedere (ambiguo o fascia 0,5-0,8), mai liste di centinaia di basi.
  if (tie || band === 'review') {
    debug(
      2,
      'Catalog',
      JSON.stringify({
        t: 'catalog-lookup',
        site,
        query: clean[0] || '',
        slug: hits[0]?.slug ?? null,
        score: Number(best.toFixed(2)),
        band,
        served: hits.length > 0,
        tie,
      })
    );
  }
  return { hits, generatedAt };
}

/** Match più stretto, per chi vuole solo la scheda migliore. */
export function matchTitle(site: CatalogSite, queries: string[], options?: CatalogQueryOptions): Omit<CatalogHit, 'title' | 'type' | 'language'> | null {
  const { hits } = lookupTitle(site, queries, options);
  if (!hits.length) return null;
  return { slug: hits[0].slug, url: hits[0].url, score: hits[0].score };
}
