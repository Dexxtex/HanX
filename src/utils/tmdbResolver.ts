import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import * as fs from 'fs';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- TMDB Configuration ---
const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";

// --- Type definitions for TMDB API responses ---
interface TmdbFindResponse {
  movie_results?: Array<{ id: number; title: string }>;
  tv_results?: Array<{ id: number; name: string }>;
}

// --- IMDB to TMDB Static Mapping ---
interface ImdbToTmdbMapping {
  imdbSeason: number;
  tmdb_id: string;
}

interface ImdbToTmdbEntry {
  title: string;
  note?: string;
  mappings: ImdbToTmdbMapping[];
}

interface ImdbToTmdbMap {
  [imdbId: string]: ImdbToTmdbEntry;
}

let IMDB_TO_TMDB_MAP: ImdbToTmdbMap = {};

try {
  const mappingPath = path.join(__dirname, '..', 'config', 'imdbToTmdb.json');
  if (fs.existsSync(mappingPath)) {
    IMDB_TO_TMDB_MAP = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
    console.log(`[IMDB→TMDB] Caricato mapping statico: ${Object.keys(IMDB_TO_TMDB_MAP).length} serie`);
  }
} catch (error) {
  console.warn('[IMDB→TMDB] Impossibile caricare mapping statico:', error);
}

/**
 * Cerca un mapping statico IMDB→TMDB per una specifica stagione.
 * Usato per serie con ID TMDB diversi per stagione (es. Monster).
 * Supporta anche entry semplici con solo tmdb_id diretto (senza mappings).
 * @param imdbId - ID IMDB (es. "tt13207736")
 * @param season - Numero stagione (es. 1, 2, 3)
 * @returns TMDB ID per quella stagione se trovato, altrimenti null
 */
export function getStaticTmdbMapping(imdbId: string, season: number): string | null {
  const entry = IMDB_TO_TMDB_MAP[imdbId];
  if (!entry) return null;

  // Entry semplice: solo tmdb_id diretto (senza array mappings)
  if ((entry as any).tmdb_id && !entry.mappings) {
    console.log(`[IMDB→TMDB] Mapping statico semplice trovato: ${imdbId} → TMDB ${(entry as any).tmdb_id} (${entry.title})`);
    return (entry as any).tmdb_id;
  }

  // Entry con mappings per stagione
  const mapping = entry.mappings?.find(m => m.imdbSeason === season);
  if (mapping) {
    console.log(`[IMDB→TMDB] Mapping statico trovato: ${imdbId} S${season} → TMDB ${mapping.tmdb_id} (${entry.title})`);
    return mapping.tmdb_id;
  }

  return null;
}

/**
 * Supports both legacy imdb based ids (imdbId:season:episode) and tmdb based ids (tmdb:tmdbId:season:episode)
 */
export function getObject(id: string) {
  const arr = id.split(':');
  if (arr[0] === 'tmdb') {
    return {
      id: arr[1], // actual TMDB id
      season: arr[2],
      episode: arr[3]
    };
  }
  return {
    id: arr[0], // imdb id
    season: arr[1],
    episode: arr[2]
  };
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
 * Ottieni TMDB ID da IMDB ID.
 * Prima controlla il mapping statico, poi usa l'API TMDB.
 * @param imdbId - ID IMDB (es. "tt13207736")
 * @param tmdbApiKey - API Key TMDB
 * @param preferredType - Tipo preferito: 'movie' o 'tv'
 * @returns TMDB ID se trovato, altrimenti null
 */
export async function getTmdbIdFromImdbId(imdbId: string, tmdbApiKey?: string, preferredType?: 'movie' | 'tv'): Promise<string | null> {
  // Prima controlla il mapping statico (per ID non linkati correttamente in TMDB)
  const entry = IMDB_TO_TMDB_MAP[imdbId];
  if (entry && (entry as any).tmdb_id && !entry.mappings) {
    console.log(`[IMDB→TMDB] Mapping statico semplice usato: ${imdbId} → TMDB ${(entry as any).tmdb_id} (${entry.title})`);
    return (entry as any).tmdb_id;
  }

  if (!tmdbApiKey) {
    console.error("TMDB_API_KEY is not configured.");
    return null;
  }
  const findUrl = `${TMDB_API_BASE_URL}/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`;
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
      console.log(`[IMDB→TMDB] Preferred TV: ${imdbId} → TMDB ${tvResults[0].id} (${tvResults[0].name})`);
      return tvResults[0].id.toString();
    } else if (preferredType === 'movie' && movieResults.length > 0) {
      console.log(`[IMDB→TMDB] Preferred Movie: ${imdbId} → TMDB ${movieResults[0].id} (${movieResults[0].title})`);
      return movieResults[0].id.toString();
    }

    // Fallback: se preferredType non trova nulla, prova l'altro tipo
    if (movieResults.length > 0) {
      console.log(`[IMDB→TMDB] Fallback Movie: ${imdbId} → TMDB ${movieResults[0].id} (${movieResults[0].title})`);
      return movieResults[0].id.toString();
    } else if (tvResults.length > 0) {
      console.log(`[IMDB→TMDB] Fallback TV: ${imdbId} → TMDB ${tvResults[0].id} (${tvResults[0].name})`);
      return tvResults[0].id.toString();
    }

    console.warn(`No TMDB movie or TV results found for IMDb ID: ${imdbId}`);
    return null;
  } catch (error) {
    console.error(`Error fetching TMDB ID for ${imdbId}:`, error);
    return null;
  }
}