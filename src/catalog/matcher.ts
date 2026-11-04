import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { debug } from '../utils/logger.js';
import { titleMatchScoreAny } from '../utils/anime-title-normalization.js';
import type { CatalogSite, TitleIndexEntry, TitleIndexFile } from './sync.js';

/** Sopra questa soglia il match è automatico; sotto 0.5 si ignora. */
const AUTO_SCORE = 0.8;
const REVIEW_SCORE = 0.5;
/** Oltre 48 ore il catalogo non è più affidabile per dire "questo titolo non c'è". */
const STALE_MS = 48 * 60 * 60 * 1000;

export interface CatalogHit {
  slug: string;
  url: string;
  title: string;
  score: number;
  /** Solo AnimeUnity: il tipo della scheda (TV/Movie) decide se è riproducibile. */
  type?: string;
}

export interface CatalogLookup {
  /** Schede col punteggio migliore, se almeno 0.8. Più di una: ITA e SUB sono schede diverse. */
  hits: CatalogHit[];
  /**
   * true solo se il catalogo è fresco e completo e il titolo non c'è: la rete
   * non serve. false = catalogo assente/vecchio/troncato, oppure titolo
   * presente (match usato, o ambiguo tra 0.5 e 0.8).
   */
  authoritative: boolean;
  generatedAt: string | null;
}

let cached: { file: string; mtimeMs: number; data: TitleIndexFile } | null = null;

function indexPath(): string {
  const dir = process.env.CATALOG_DIR || path.join(fileURLToPath(new URL('../..', import.meta.url)), 'data');
  return path.join(dir, 'catalog-titles.json');
}

/** Rilegge il file solo se è cambiato: una stat per chiamata, 15k schede in memoria. */
function loadIndex(): TitleIndexFile | null {
  const file = indexPath();
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

/**
 * Cerca il titolo nel catalogo locale di un sito. Il punteggio è quello dei
 * provider (`titleMatchScore`: forma grezza senza stopword, quindi "Mission-E"
 * combacia con "MissionE", e 0.9 quando la query chiude il titolo del sito).
 */
export function lookupTitle(site: CatalogSite, queries: string[]): CatalogLookup {
  const clean = queries.map((query) => String(query || '').trim()).filter(Boolean);
  const index = loadIndex();
  const entries = index?.sites?.[site] || [];
  const generatedAt = typeof index?.generatedAt === 'string' ? index.generatedAt : null;
  const age = generatedAt ? Date.now() - Date.parse(generatedAt) : Number.POSITIVE_INFINITY;
  const fresh = Number.isFinite(age) && age <= STALE_MS;
  const complete = !index?.truncated?.[site];

  let best = 0;
  const scored: { entry: TitleIndexEntry; score: number }[] = [];
  if (clean.length) {
    for (const entry of entries) {
      const score = scoreEntry(clean, entry);
      if (score <= best) continue;
      if (score < REVIEW_SCORE) continue;
      best = score;
      scored.length = 0;
      scored.push({ entry, score });
    }
  }
  // Solo le schede col punteggio migliore, come fa il filtro dei provider:
  // altrimenti una query corta ("One Piece") porta dietro anche i film.
  const hits: CatalogHit[] = scored.map(({ entry, score }) => ({
    slug: entry.slug,
    url: entry.url,
    title: entry.title,
    score,
    ...(entry.type ? { type: entry.type } : {}),
  }));

  if (best >= REVIEW_SCORE && best < AUTO_SCORE) {
    debug(2, 'Catalog', `[catalog] ${site}: "${scored[0].entry.title}" vale ${best.toFixed(2)} per "${clean.join('" / "')}", non usato`);
  }
  const authoritative = fresh && complete && entries.length > 0 && best < REVIEW_SCORE;
  return { hits: best >= AUTO_SCORE ? hits : [], authoritative, generatedAt };
}

/** Match più stretto, per chi vuole solo la scheda migliore. */
export function matchTitle(site: CatalogSite, queries: string[]): Omit<CatalogHit, 'title' | 'type'> | null {
  const { hits } = lookupTitle(site, queries);
  if (!hits.length) return null;
  return { slug: hits[0].slug, url: hits[0].url, score: hits[0].score };
}
