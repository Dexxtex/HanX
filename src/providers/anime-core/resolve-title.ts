/**
 * Dai cinque tipi di id al titolo da cercare.
 *
 * I cinque `handle*Request` erano scritti a mano in ognuno dei tre provider:
 * ~380 righe in tutto, identiche tranne l'etichetta del log e un flag di
 * AnimeWorld. Una correzione al gate o al ramo "mapping miss" andava fatta tre
 * volte, e dimenticarne una non dava errore.
 *
 * Qui c'è solo la **risoluzione**: id → titolo, stagione, episodio, lingua.
 * Cosa fare del titolo resta al provider (`handleTitleRequest`), che è la parte
 * che diverge davvero fra i tre siti.
 */
import { checkIsAnimeById } from '../../utils/animeGate.js';
import { normalizeBool } from '../../config.js';
import { debug } from '../../utils/logger.js';
import {
  resolveAnimeTarget,
  resolveMappingRequest,
  type MappingRequest,
} from '../../mapping/index.js';
import { getKitsuTitle, getKitsuStartDate, getTvdbTitle } from '../../mapping/live.js';
import { getEnglishTitleFromAnyId } from './english-title.js';
import type { StreamForStremio } from '../../types/animeunity.js';

export interface TitleResolutionContext {
  /** Etichetta del provider, solo per i log. */
  label: string;
  tmdbApiKey?: string;
  /** AnimeWorld: meglio un titolo placeholder che zero stream. */
  allowEmptyTitle?: boolean;
  handleTitleRequest: (
    title: string,
    seasonNumber: number | null,
    episodeNumber: number | null,
    isMovie: boolean,
    titleAlt?: string | null,
    titleIt?: string | null,
    titleItSeason?: number | null,
    malId?: number | null,
    /** Solo AnimeWorld: `startDate` di Kitsu per il ripiego per anno. */
    kitsuStartDate?: string | null
  ) => Promise<{ streams: StreamForStremio[] }>;
  /** Ripiego per le serie non mappate: solo AnimeSaturn lo implementa. */
  handleUnmappedSeries?: (
    request: MappingRequest | null,
    episodeNumber: number | null
  ) => Promise<{ streams: StreamForStremio[] } | null>;
}

const empty = (): { streams: StreamForStremio[] } => ({ streams: [] });

/**
 * Il gate decide *se* un id esterno è anime. Spento da env, si cerca comunque.
 * Un outage TMDB non è "non anime": `checkIsAnimeById` è già permissivo lì.
 */
async function passesAnimeGate(
  type: 'imdb' | 'tmdb' | 'tvdb',
  id: string,
  isMovie: boolean,
  ctx: TitleResolutionContext
): Promise<boolean> {
  if (!(normalizeBool(process.env.ANIME_GATE_ENABLED) ?? true)) return true;
  const gate = await checkIsAnimeById(type, id, ctx.tmdbApiKey, isMovie ? 'movie' : 'tv');
  if (gate.isAnime) return true;
  const what = type === 'tvdb' ? 'Kitsu' : 'MAL/Kitsu';
  debug(2, ctx.label, `[${ctx.label}] Skipping anime search: no ${what} mapping (${gate.reason}) for ${type} ${id}`);
  return false;
}

/** Ramo comune a imdb e tmdb: gate, mapping, target, ripieghi. tvdb ha il suo. */
async function resolveExternalId(
  type: 'imdb' | 'tmdb',
  rawId: string,
  seasonNumber: number | null,
  episodeNumber: number | null,
  isMovie: boolean,
  ctx: TitleResolutionContext
): Promise<{ streams: StreamForStremio[] }> {
  if (!(await passesAnimeGate(type, rawId, isMovie, ctx))) return empty();

  // `resolveMappingRequest` vuole l'id completo (`tmdb:123`), non il numero.
  const request = resolveMappingRequest(type === 'imdb' ? rawId : `${type}:${rawId}`, seasonNumber, episodeNumber, isMovie);
  if (request) {
    const target = await resolveAnimeTarget(request, ctx);
    const title = target ? target.title || (await getKitsuTitle(target.kitsuId)) : '';
    if (target && title) {
      return ctx.handleTitleRequest(
        title,
        target.displaySeason,
        target.kitsuEpisode,
        request.isMovie,
        target.titleAlt,
        target.titleIt,
        target.titleItSeason
      );
    }
  }

  const unmapped = ctx.handleUnmappedSeries ? await ctx.handleUnmappedSeries(request, episodeNumber) : null;
  if (unmapped) return unmapped;

  const englishTitle = await getEnglishTitleFromAnyId(rawId, type, ctx.tmdbApiKey, ctx.allowEmptyTitle);
  debug(2, ctx.label, `[${ctx.label}] Ricerca con titolo inglese: ${englishTitle}`);
  return ctx.handleTitleRequest(englishTitle, seasonNumber, episodeNumber, isMovie);
}

/** `kitsu:<id>`: il titolo viene da Kitsu, la stagione dall'indice. */
export async function resolveKitsuRequest(
  kitsuIdString: string,
  ctx: TitleResolutionContext
): Promise<{ streams: StreamForStremio[] }> {
  const request = resolveMappingRequest(kitsuIdString);
  if (!request) return empty();

  let title = await getKitsuTitle(request.id);
  if (!title) {
    try {
      title = await getEnglishTitleFromAnyId(request.id, 'kitsu', ctx.tmdbApiKey);
    } catch { /* si prova comunque con il mapping */ }
  }
  if (!title) {
    // Nessun titolo = nessuna ricerca possibile. Va detto: senza questa riga
    // l'uscita era indistinguibile da "anime non presente sui siti".
    console.warn(`[${ctx.label}] Nessun titolo recuperabile per l id richiesto: nessuna ricerca`);
    return empty();
  }
  // L'id Kitsu non porta stagione: la fornisce l'indice insieme al titolo italiano.
  const target = await resolveAnimeTarget(request, ctx);
  // `fd2d4ec` perse questo dato passando a resolve-title: il ripiego per anno di
  // AnimeWorld non partiva più. Arriva come parametro, non come stato di istanza
  // (il provider è un singleton: era un leak fra richieste).
  const kitsuStartDate = await getKitsuStartDate(request.id);
  return ctx.handleTitleRequest(
    title,
    null,
    request.episode,
    request.isMovie,
    target?.titleAlt,
    target?.titleIt,
    target?.titleItSeason,
    undefined,
    kitsuStartDate
  );
}

/** `mal:<id>`: il titolo inglese è l'unica sorgente, e l'id MAL va anche al provider. */
export async function resolveMalRequest(
  malIdString: string,
  ctx: TitleResolutionContext
): Promise<{ streams: StreamForStremio[] }> {
  const request = resolveMappingRequest(malIdString);
  if (!request) return empty();
  const englishTitle = await getEnglishTitleFromAnyId(request.id, 'mal', ctx.tmdbApiKey, ctx.allowEmptyTitle);
  debug(2, ctx.label, `[${ctx.label}] Ricerca con titolo inglese: ${englishTitle}`);
  return ctx.handleTitleRequest(
    englishTitle,
    request.season,
    request.episode,
    request.isMovie,
    undefined,
    undefined,
    undefined,
    Number(request.id)
  );
}

export function resolveImdbRequest(
  imdbId: string,
  seasonNumber: number | null,
  episodeNumber: number | null,
  isMovie: boolean,
  ctx: TitleResolutionContext
): Promise<{ streams: StreamForStremio[] }> {
  return resolveExternalId('imdb', imdbId, seasonNumber, episodeNumber, isMovie, ctx);
}

export function resolveTmdbRequest(
  tmdbId: string,
  seasonNumber: number | null,
  episodeNumber: number | null,
  isMovie: boolean,
  ctx: TitleResolutionContext
): Promise<{ streams: StreamForStremio[] }> {
  return resolveExternalId('tmdb', tmdbId, seasonNumber, episodeNumber, isMovie, ctx);
}

/**
 * `tvdb:<id>` ha un ramo suo: il titolo viene da `getTvdbTitle`, e senza titolo
 * si esce invece di lanciare. Non passa da `getEnglishTitleFromAnyId`, che non
 * conosce `tvdb` come tipo.
 */
export async function resolveTvdbRequest(
  tvdbId: string,
  seasonNumber: number | null,
  episodeNumber: number | null,
  isMovie: boolean,
  ctx: TitleResolutionContext
): Promise<{ streams: StreamForStremio[] }> {
  if (!(await passesAnimeGate('tvdb', tvdbId, isMovie, ctx))) return empty();

  const request = resolveMappingRequest(`tvdb:${tvdbId}`, seasonNumber, episodeNumber, isMovie);
  if (request) {
    const target = await resolveAnimeTarget(request, ctx);
    const title = target ? target.title || (await getKitsuTitle(target.kitsuId)) : '';
    if (target && title) {
      return ctx.handleTitleRequest(
        title,
        target.displaySeason,
        target.kitsuEpisode,
        request.isMovie,
        target.titleAlt,
        target.titleIt,
        target.titleItSeason
      );
    }
  }

  const unmapped = ctx.handleUnmappedSeries ? await ctx.handleUnmappedSeries(request, episodeNumber) : null;
  if (unmapped) return unmapped;

  const fallbackTitle = await getTvdbTitle(tvdbId, ctx);
  if (!fallbackTitle) return empty();
  debug(2, ctx.label, `[${ctx.label}] Ricerca con titolo TVDB: ${fallbackTitle}`);
  return ctx.handleTitleRequest(fallbackTitle, seasonNumber, episodeNumber, isMovie);
}
