import { debug } from './logger.js';

// --- TMDB Configuration ---
const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";

// One IMDb click asks for the same /find from the gate, TVDB bridging and every
// provider: keep the answer for an hour. Key includes the API key so two user
// configs never share a result (an invalid key must not poison a valid one).
const TMDB_FIND_CACHE_TTL_MS = 60 * 60 * 1000;
const TMDB_FIND_CACHE_MAX_ENTRIES = 500;

/**
 * Quello che serve davvero di `/find`: l'id, il titolo ufficiale e se è anime.
 * Conservarli evita che il gate e i provider rifacciano `/tv/{id}` per gli
 * stessi dati (due richieste TMDB in più per ogni titolo).
 */
export interface TmdbFindSummary {
  id: string;
  title: string;
  isAnime: boolean;
}

const EMPTY_SUMMARY: TmdbFindSummary = { id: '', title: '', isAnime: false };

const tmdbFindCache = new Map<string, { value: TmdbFindSummary; expires: number }>();
const tmdbInFlight = new Map<string, Promise<TmdbFindSummary>>();

function rememberTmdbId(key: string, value: TmdbFindSummary, ttlMs: number = TMDB_FIND_CACHE_TTL_MS): TmdbFindSummary {
  tmdbFindCache.delete(key);
  tmdbFindCache.set(key, { value, expires: Date.now() + ttlMs });
  if (tmdbFindCache.size > TMDB_FIND_CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [entryKey, entry] of tmdbFindCache) {
      if (entry.expires <= now) tmdbFindCache.delete(entryKey);
    }
    let excess = tmdbFindCache.size - TMDB_FIND_CACHE_MAX_ENTRIES;
    for (const entryKey of tmdbFindCache.keys()) {
      if (excess <= 0) break;
      tmdbFindCache.delete(entryKey);
      excess -= 1;
    }
  }
  return value;
}

// --- Type definitions for TMDB API responses ---
interface TmdbFindResult {
  id: number;
  title?: string;
  name?: string;
  genre_ids?: number[];
  origin_country?: string[];
  original_language?: string;
}

interface TmdbFindResponse {
  movie_results?: TmdbFindResult[];
  tv_results?: TmdbFindResult[];
}

/** Genere 16 = Animation. Origine giapponese: paese o lingua originale. */
function looksAnimeResult(item: TmdbFindResult): boolean {
  const animated = Array.isArray(item.genre_ids) && item.genre_ids.includes(16);
  const japanese =
    (Array.isArray(item.origin_country) && item.origin_country.includes('JP')) ||
    item.original_language === 'ja';
  return animated && japanese;
}

/**
 * Ensures playlist URLs have .m3u8 after numeric id: /playlist/12345 => /playlist/12345.m3u8
 */
export function ensurePlaylistM3u8(raw: string): string {
  try {
    if (!raw.includes('/playlist/')) return raw;
    const u = new URL(raw);
    const parts = u.pathname.split('/');
    const idx = parts.indexOf('playlist');
    if (idx === -1 || idx === parts.length - 1) return raw;
    const leaf = parts[idx + 1];
    if (/\.m3u8$/i.test(leaf) || leaf.includes('.')) return raw;
    parts[idx + 1] = leaf + '.m3u8';
    u.pathname = parts.join('/');
    return u.toString();
  } catch { return raw; }
}

/**
 * Ottieni TMDB ID da IMDB ID usando l'API ufficiale TMDB.
 * @param imdbId - ID IMDB (es. "tt13207736")
 * @param tmdbApiKey - API Key TMDB
 * @param preferredType - Tipo preferito: 'movie' o 'tv'
 * @returns TMDB ID se trovato, altrimenti null
 */
function summaryOf(item: TmdbFindResult, kind: 'movie' | 'tv'): TmdbFindSummary {
  return {
    id: item.id.toString(),
    title: String((kind === 'tv' ? item.name : item.title) || ''),
    isAnime: looksAnimeResult(item),
  };
}

/**
 * `/find` in una sola richiesta: id, titolo ufficiale e se è anime. Il gate e i
 * provider leggono da qui invece di rifare `/tv/{id}` per gli stessi dati.
 */
export async function getTmdbSummaryFromImdbId(
  imdbId: string,
  tmdbApiKey?: string,
  preferredType?: 'movie' | 'tv'
): Promise<TmdbFindSummary | null> {
  if (!tmdbApiKey) return null;
  const findUrl = `${TMDB_API_BASE_URL}/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`;
  const cacheKey = `${imdbId}|${preferredType || ''}|${tmdbApiKey}`;
  const cachedResult = tmdbFindCache.get(cacheKey);
  if (cachedResult) {
    if (cachedResult.expires > Date.now()) {
      tmdbFindCache.delete(cacheKey);
      tmdbFindCache.set(cacheKey, cachedResult);
      return cachedResult.value.id ? cachedResult.value : null;
    }
    tmdbFindCache.delete(cacheKey);
  }

  const running = tmdbInFlight.get(cacheKey);
  if (running) {
    const shared = await running;
    return shared.id ? shared : null;
  }

  const promise = (async (): Promise<TmdbFindSummary> => {
    try {
      const response = await fetch(findUrl, { signal: (AbortSignal as any).timeout(10_000) });
      if (!response.ok) {
        console.error(`Failed to fetch TMDB ID for ${imdbId}: ${response.status}`);
        return EMPTY_SUMMARY;
      }
      const data = (await response.json()) as TmdbFindResponse;

      // Priorità intelligente: se preferredType è specificato, cerca prima quel tipo
      const movieResults = data.movie_results || [];
      const tvResults = data.tv_results || [];

      if (preferredType === 'tv' && tvResults.length > 0) {
        debug(2, 'TMDB', `[IMDB→TMDB] Preferred TV: ${imdbId} → TMDB ${tvResults[0].id} (${tvResults[0].name})`);
        return rememberTmdbId(cacheKey, summaryOf(tvResults[0], 'tv'));
      } else if (preferredType === 'movie' && movieResults.length > 0) {
        debug(2, 'TMDB', `[IMDB→TMDB] Preferred Movie: ${imdbId} → TMDB ${movieResults[0].id} (${movieResults[0].title})`);
        return rememberTmdbId(cacheKey, summaryOf(movieResults[0], 'movie'));
      }

      // Fallback: se preferredType non trova nulla, prova l'altro tipo
      if (movieResults.length > 0) {
        debug(3, 'TMDB', `[IMDB→TMDB] Fallback Movie: ${imdbId} → TMDB ${movieResults[0].id} (${movieResults[0].title})`);
        return rememberTmdbId(cacheKey, summaryOf(movieResults[0], 'movie'));
      } else if (tvResults.length > 0) {
        debug(3, 'TMDB', `[IMDB→TMDB] Fallback TV: ${imdbId} → TMDB ${tvResults[0].id} (${tvResults[0].name})`);
        return rememberTmdbId(cacheKey, summaryOf(tvResults[0], 'tv'));
      }

      console.warn(`No TMDB movie or TV results found for IMDb ID: ${imdbId}`);
      return rememberTmdbId(cacheKey, EMPTY_SUMMARY, 5 * 60 * 1000);
    } catch (error) {
      console.error(`Error fetching TMDB ID for ${imdbId}:`, error);
      return EMPTY_SUMMARY;
    }
  })();

  tmdbInFlight.set(cacheKey, promise);
  promise.finally(() => tmdbInFlight.delete(cacheKey));
  const summary = await promise;
  return summary.id ? summary : null;
}

/**
 * Ottieni TMDB ID da IMDB ID usando l'API ufficiale TMDB.
 * @param imdbId - ID IMDB (es. "tt13207736")
 * @param tmdbApiKey - API Key TMDB
 * @param preferredType - Tipo preferito: 'movie' o 'tv'
 * @returns TMDB ID se trovato, altrimenti null
 */
export async function getTmdbIdFromImdbId(imdbId: string, tmdbApiKey?: string, preferredType?: 'movie' | 'tv'): Promise<string | null> {
  if (!tmdbApiKey) {
    console.error("TMDB_API_KEY is not configured.");
    return null;
  }
  const summary = await getTmdbSummaryFromImdbId(imdbId, tmdbApiKey, preferredType);
  return summary?.id || null;
}