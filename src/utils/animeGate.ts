// Helper to decide if an external ID refers to an Anime title.
// Strategy:
// 1) The local mapping index is authoritative: a mapped series/movie is anime.
// 2) Soft fallback (ANIME_GATE_TMDB_FALLBACK, default true): TMDB details with
//    Animation genre and Japanese origin for un-mapped ids.
// 3) Upstream failures are permissive (an outage is not "not anime").
// Feature flag: ANIME_GATE_ENABLED (default true). Callers can still import and decide.

export type ExternalIdType = 'imdb' | 'tmdb' | 'tvdb';
import { hasMappedEntry, hasMappedSeries } from '../mapping/index.js';
import { debug } from './logger.js';

export interface AnimeGateResult {
  isAnime: boolean;
  hasMal: boolean;
  hasKitsu: boolean;
  reason: string;
}

// Providers call the gate independently for the same id; cache the in-flight promise to avoid tripling the lookups.
const GATE_CACHE_TTL_MS = 5 * 60 * 1000;
const GATE_CACHE_MAX = 500;
const gateCache = new Map<string, { promise: Promise<AnimeGateResult>; expires: number }>();

export function __resetAnimeGateCache(): void {
  gateCache.clear();
}

// Minimal TMDB response shape (id, name/title)
interface TmdbBasicResponse {
  id?: number;
  name?: string;
  title?: string;
}

async function getTmdbIdFromImdb(imdbId: string, tmdbKey: string): Promise<string | null> {
  try {
    const { getTmdbIdFromImdbId } = await import('./tmdbResolver.js');
    const imdbOnly = imdbId.split(':')[0];
    const tmdbId = await getTmdbIdFromImdbId(imdbOnly, tmdbKey, 'tv');
    return tmdbId || null;
  } catch {
    return null;
  }
}

async function fetchTmdbDetailsAny(tmdbId: string, tmdbKey: string, mediaHint?: 'movie' | 'tv'): Promise<any | null> {
  const tryEndpoints: ('movie' | 'tv')[] = mediaHint ? [mediaHint, mediaHint === 'movie' ? 'tv' : 'movie'] : ['tv', 'movie'];
  for (const kind of tryEndpoints) {
    try {
      const url = `https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${tmdbKey}`;
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const json = (await resp.json()) as TmdbBasicResponse;
      if (json && (json.id || json.name || json.title)) return json;
    } catch {}
  }
  return null;
}

function tmdbLooksAnime(details: any): boolean {
  if (!details) return false;
  const genres = Array.isArray(details.genres) ? details.genres : [];
  const hasAnimation = genres.some((g: any) => g?.name === 'Animation' || g?.id === 16);
  const productionCountries = Array.isArray(details.production_countries) ? details.production_countries : [];
  const originCountry = Array.isArray(details.origin_country) ? details.origin_country : [];
  const originalLanguage = details.original_language || '';
  const isJP =
    productionCountries.some((c: any) => c?.iso_3166_1 === 'JP') ||
    originCountry.includes('JP') ||
    originalLanguage === 'ja';
  return hasAnimation && isJP;
}

export async function checkIsAnimeById(
  type: ExternalIdType,
  id: string,
  tmdbApiKey?: string,
  mediaHint?: 'movie' | 'tv'
): Promise<AnimeGateResult> {
  const cacheKey = `${type}:${id}:${mediaHint || ''}`;
  const cached = gateCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    debug(4, 'AnimeGate', 'cache hit', cacheKey);
    return cached.promise;
  }
  // Store the promise synchronously so concurrent callers share this lookup.
  const promise = resolveAnimeGate(type, id, tmdbApiKey, mediaHint).then((result) => {
    if (
      (result.reason === 'upstream-unavailable' || result.reason === 'no-tmdb-id') &&
      gateCache.get(cacheKey)?.promise === promise
    ) {
      gateCache.delete(cacheKey);
    }
    return result;
  }).catch((e) => {
    if (gateCache.get(cacheKey)?.promise === promise) gateCache.delete(cacheKey);
    throw e;
  });
  if (gateCache.size >= GATE_CACHE_MAX) {
    const oldest = gateCache.keys().next().value;
    if (oldest !== undefined) gateCache.delete(oldest);
  }
  gateCache.set(cacheKey, { promise, expires: Date.now() + GATE_CACHE_TTL_MS });
  return promise;
}

async function resolveAnimeGate(
  type: ExternalIdType,
  id: string,
  tmdbApiKey?: string,
  mediaHint?: 'movie' | 'tv'
): Promise<AnimeGateResult> {
  const cleanId = id.split(':')[0];
  debug(4, 'AnimeGate', 'check', { type, id, mediaHint: mediaHint || 'auto' });
  if (type === 'tvdb') {
    if (hasMappedSeries('tvdb', cleanId)) {
      debug(2, 'AnimeGate', 'anime', { type, id, reason: 'local-mapping' });
      return { isAnime: true, hasMal: false, hasKitsu: true, reason: 'local-mapping' };
    }
    try {
      const { tvdbSeriesHasKitsu } = await import('../mapping/live.js');
      if (await tvdbSeriesHasKitsu(cleanId)) {
        debug(2, 'AnimeGate', 'anime', { type, id, reason: 'tvdb-kitsu-mapping' });
        return { isAnime: true, hasMal: false, hasKitsu: true, reason: 'tvdb-kitsu-mapping' };
      }
    } catch {
      // Be permissive on upstream failure: an outage is not "not anime".
    }
    return { isAnime: true, hasMal: false, hasKitsu: false, reason: 'tvdb-unknown' };
  }

  if (hasMappedEntry(type, cleanId)) {
    debug(2, 'AnimeGate', 'anime', { type, id, reason: 'local-mapping' });
    return { isAnime: true, hasMal: false, hasKitsu: true, reason: 'local-mapping' };
  }

  const tmdbKey = tmdbApiKey || process.env.TMDB_API_KEY || '';
  if (!tmdbKey) {
    // Without TMDB key we can only say "unknown"; be permissive (treat as anime) to avoid blocking
    debug(2, 'AnimeGate', 'anime (unknown)', { type, id, reason: 'no-tmdb-key' });
    return { isAnime: true, hasMal: false, hasKitsu: false, reason: 'no-tmdb-key' };
  }
  let tmdbId: string | null = null;
  if (type === 'imdb') {
    tmdbId = await getTmdbIdFromImdb(id, tmdbKey);
  } else {
    tmdbId = id;
  }
  if (!tmdbId) {
    // A TMDB outage is not "not anime": be permissive, and don't cache this unknown.
    console.warn(`[AnimeGate] TMDB id unavailable for ${type}:${id} — allowing (unknown)`);
    debug(2, 'AnimeGate', 'anime (unknown)', { type, id, reason: 'no-tmdb-id' });
    return { isAnime: true, hasMal: false, hasKitsu: false, reason: 'no-tmdb-id' };
  }
  // Un-mapped: only official TMDB details decide.
  const allowTmdbFallback = (process.env.ANIME_GATE_TMDB_FALLBACK || 'true') !== 'false';
  if (!allowTmdbFallback) {
    return { isAnime: false, hasMal: false, hasKitsu: false, reason: 'no-mapping-and-fallback-disabled' };
  }
  const details = await fetchTmdbDetailsAny(tmdbId, tmdbKey, mediaHint);
  if (!details) {
    // Upstream gave no answer: don't turn an outage into "this is not anime".
    console.warn(`[AnimeGate] TMDB details unavailable for ${type}:${id} — allowing (unknown)`);
    debug(2, 'AnimeGate', 'anime (unknown)', { type, id, reason: 'upstream-unavailable' });
    return { isAnime: true, hasMal: false, hasKitsu: false, reason: 'upstream-unavailable' };
  }
  if (tmdbLooksAnime(details)) {
    debug(2, 'AnimeGate', 'anime', { type, id, reason: 'tmdb-fallback' });
    return { isAnime: true, hasMal: false, hasKitsu: false, reason: 'tmdb-fallback' };
  }
  debug(2, 'AnimeGate', 'not anime', { type, id, reason: 'no-mapping-and-not-animation-jp' });
  return { isAnime: false, hasMal: false, hasKitsu: false, reason: 'no-mapping-and-not-animation-jp' };
}

// =============================================================
// Universal Anime Title Normalization (scoped minimal variant)
// Richiesta: normalizzare SOLO le forme specificate di One Punch Man
//  - One-Punch Man -> One Punch Man
//  - OnePunch Man  -> One Punch Man
//  - OnePunchMan   -> One Punch Man
//  - one punch man (tutto minuscolo) NON deve cambiare
// Case-sensitive: non applichiamo se la capitalizzazione non corrisponde
// =============================================================
export function applyUniversalAnimeTitleNormalization(title: string): string {
  // Season specific mapping requested: "One-Punch Man Season 2" -> "One Punch Man 2" (idem Season 3)
  // Gestiamo varianti: One-Punch / One Punch / OnePunch / OnePunchMan + optional space before Man
  const seasonMatch = title.match(/^One[- ]?Punch ?Man Season (2|3)$/);
  if (!seasonMatch) {
    const seasonMatchCompact = title.match(/^OnePunchMan Season (2|3)$/); // es: OnePunchMan Season 2
    if (seasonMatchCompact) {
      const num = seasonMatchCompact[1];
      const norm = `One Punch Man ${num}`;
      if (title !== norm) debug(3, 'AnimeGate', `[UniversalTitle][Normalize] "${title}" -> "${norm}"`);
      return norm;
    }
  } else {
    const num = seasonMatch[1];
    const norm = `One Punch Man ${num}`;
    if (title !== norm) debug(3, 'AnimeGate', `[UniversalTitle][Normalize] "${title}" -> "${norm}"`);
    return norm;
  }
  // Pattern 1: One-Punch Man oppure OnePunch Man (gestito da optional trattino)
  if (/^One[- ]?Punch Man$/.test(title)) {
    if (title !== 'One Punch Man') {
      const norm = 'One Punch Man';
      debug(3, 'AnimeGate', `[UniversalTitle][Normalize] "${title}" -> "${norm}"`);
      return norm;
    }
    return title; // già corretto
  }
  // Pattern 2: completamente attaccato OnePunchMan
  if (title === 'OnePunchMan') {
    const norm = 'One Punch Man';
    debug(3, 'AnimeGate', `[UniversalTitle][Normalize] "${title}" -> "${norm}"`);
    return norm;
  }
  return title;
}
