import { debug } from './logger.js';

// --- TMDB Configuration ---
const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";

// One IMDb click asks for the same /find from the gate, TVDB bridging and every
// provider: keep the answer for an hour. Key includes the API key so two user
// configs never share a result (an invalid key must not poison a valid one).
const TMDB_FIND_CACHE_TTL_MS = 60 * 60 * 1000;
const TMDB_FIND_CACHE_MAX_ENTRIES = 500;
const tmdbFindCache = new Map<string, { value: string; expires: number }>();

function rememberTmdbId(key: string, value: string): string {
  tmdbFindCache.set(key, { value, expires: Date.now() + TMDB_FIND_CACHE_TTL_MS });
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
interface TmdbFindResponse {
  movie_results?: Array<{ id: number; title: string }>;
  tv_results?: Array<{ id: number; name: string }>;
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
export async function getTmdbIdFromImdbId(imdbId: string, tmdbApiKey?: string, preferredType?: 'movie' | 'tv'): Promise<string | null> {
  if (!tmdbApiKey) {
    console.error("TMDB_API_KEY is not configured.");
    return null;
  }
  const findUrl = `${TMDB_API_BASE_URL}/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`;
  const cacheKey = `${imdbId}|${preferredType || ''}|${tmdbApiKey}`;
  const cachedResult = tmdbFindCache.get(cacheKey);
  if (cachedResult && cachedResult.expires > Date.now()) return cachedResult.value;
  try {
    const response = await fetch(findUrl);
    if (!response.ok) {
      console.error(`Failed to fetch TMDB ID for ${imdbId}: ${response.status}`);
      return null;
    }
    const data = (await response.json()) as TmdbFindResponse;

    // Priorità intelligente: se preferredType è specificato, cerca prima quel tipo
    const movieResults = data.movie_results || [];
    const tvResults = data.tv_results || [];

    if (preferredType === 'tv' && tvResults.length > 0) {
      debug(2, 'TMDB', `[IMDB→TMDB] Preferred TV: ${imdbId} → TMDB ${tvResults[0].id} (${tvResults[0].name})`);
      return rememberTmdbId(cacheKey, tvResults[0].id.toString());
    } else if (preferredType === 'movie' && movieResults.length > 0) {
      debug(2, 'TMDB', `[IMDB→TMDB] Preferred Movie: ${imdbId} → TMDB ${movieResults[0].id} (${movieResults[0].title})`);
      return rememberTmdbId(cacheKey, movieResults[0].id.toString());
    }

    // Fallback: se preferredType non trova nulla, prova l'altro tipo
    if (movieResults.length > 0) {
      debug(3, 'TMDB', `[IMDB→TMDB] Fallback Movie: ${imdbId} → TMDB ${movieResults[0].id} (${movieResults[0].title})`);
      return rememberTmdbId(cacheKey, movieResults[0].id.toString());
    } else if (tvResults.length > 0) {
      debug(3, 'TMDB', `[IMDB→TMDB] Fallback TV: ${imdbId} → TMDB ${tvResults[0].id} (${tvResults[0].name})`);
      return rememberTmdbId(cacheKey, tvResults[0].id.toString());
    }

    console.warn(`No TMDB movie or TV results found for IMDb ID: ${imdbId}`);
    return null;
  } catch (error) {
    console.error(`Error fetching TMDB ID for ${imdbId}:`, error);
    return null;
  }
}