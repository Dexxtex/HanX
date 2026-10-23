/**
 * anime-core/english-title.ts
 * Unica implementazione di getEnglishTitleFromAnyId per i tre provider.
 * Riusa le funzioni di mapping già cache-ate (Kitsu/Tenrai) e applica un
 * timeout alle chiamate TMDB, che nelle vecchie copie non ne avevano.
 */

import { debug } from '../../utils/logger.js';
import { fetchKitsuAnime, getKitsuMalId, getKitsuMalIdForTmdb } from '../../mapping/live.js';
import { getTmdbIdFromImdbId } from '../../utils/tmdbResolver.js';
import { getMalAnimeMetadata, getPreferredMalTitle } from './tenrai-metadata.js';
import { DEFAULT_FETCH_TIMEOUT } from './fetch-resource.js';

export type TitleIdType = 'imdb' | 'tmdb' | 'kitsu' | 'mal';

interface TmdbTitleResponse {
  name?: string;
  title?: string;
}

async function fetchTmdbTitle(tmdbId: string, tmdbKey: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT);
  try {
    for (const kind of ['tv', 'movie'] as const) {
      const response = await fetch(
        `https://api.themoviedb.org/3/${kind}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(tmdbKey)}`,
        { signal: controller.signal }
      );
      if (!response.ok) continue;
      const json = (await response.json()) as TmdbTitleResponse;
      const title = kind === 'tv' ? json.name : json.title;
      if (title) return title;
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Titolo inglese da kitsu/mal/imdb/tmdb. Lancia se nessuna fonte risponde:
 * i chiamanti gestiscono già l'errore e restituiscono zero stream.
 */
export async function getEnglishTitleFromAnyId(
  id: string,
  type: TitleIdType,
  tmdbApiKey?: string,
  allowEmptyTitle = false
): Promise<string> {
  const tmdbKey = tmdbApiKey || process.env.TMDB_API_KEY || '';
  let malId: string | null = null;
  let tmdbId: string | null = null;

  if (type === 'imdb') {
    if (!tmdbKey) throw new Error('TMDB_API_KEY non configurata');
    tmdbId = await getTmdbIdFromImdbId(id.split(':')[0], tmdbKey, 'tv');
    if (!tmdbId) throw new Error('TMDB ID non trovato per IMDB: ' + id);
  } else if (type === 'tmdb') {
    tmdbId = id;
  } else if (type === 'mal') {
    malId = id;
  } else {
    try {
      malId = await getKitsuMalId(id);
    } catch {
      // senza mapping MAL si prova direttamente il titolo Kitsu
    }
  }
  if (!malId && tmdbId) {
    try {
      malId = await getKitsuMalIdForTmdb(tmdbId);
    } catch { }
  }

  if (malId) {
    try {
      const metadata = await getMalAnimeMetadata(malId);
      const englishTitle = getPreferredMalTitle(metadata) || '';
      if (englishTitle) {
        debug(3, 'AnimeCore', '[UniversalTitle] titolo da Tenrai', { type, id, englishTitle });
        return englishTitle;
      }
    } catch { }
  }

  if (type === 'kitsu') {
    try {
      const kitsuTitle = (await fetchKitsuAnime(id))?.title || '';
      if (kitsuTitle) {
        debug(3, 'AnimeCore', '[UniversalTitle] titolo da Kitsu', { type, id, kitsuTitle });
        return kitsuTitle;
      }
    } catch { }
  }

  if (tmdbId && tmdbKey) {
    try {
      const tmdbTitle = await fetchTmdbTitle(tmdbId, tmdbKey);
      if (tmdbTitle) return tmdbTitle;
    } catch { }
  }
  // Opt-in documentato in .env.example (solo AnimeWorld): meglio un titolo
  // placeholder che zero stream.
  if (allowEmptyTitle) {
    console.warn('[UniversalTitle] Fallback placeholder title for id', id);
    return 'Anime';
  }
  throw new Error('Impossibile ottenere titolo inglese da nessuna fonte per ' + id);
}
