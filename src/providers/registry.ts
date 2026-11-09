/**
 * Dispatch dell'id verso il metodo giusto del provider.
 *
 * Era scritto a mano tre volte in `addon.ts`, con gli stessi cinque
 * `startsWith` e lo stesso `toNumericId`. Un quarto provider significava
 * toccare cinque punti, e dimenticarne uno non dà errore: il provider
 * semplicemente non risponde a quell'id.
 */
import type { StreamForStremio } from '../types/animeunity.js';
import { toNumericId } from '../mapping/request.js';

/**
 * I cinque metodi che ogni provider espone. Il contratto era implicito (stessi
 * nomi, stesse firme, nessuna dichiarazione): qui diventa esplicito, così il
 * compilatore sorveglia le firme quando si aggiunge un provider.
 */
export interface StreamProvider {
  handleKitsuRequest(id: string): Promise<{ streams: StreamForStremio[] }>;
  handleMalRequest(id: string): Promise<{ streams: StreamForStremio[] }>;
  handleImdbRequest(
    id: string,
    seasonNumber: number | null,
    episodeNumber: number | null,
    isMovie?: boolean
  ): Promise<{ streams: StreamForStremio[] }>;
  handleTmdbRequest(
    id: string,
    seasonNumber: number | null,
    episodeNumber: number | null,
    isMovie?: boolean
  ): Promise<{ streams: StreamForStremio[] }>;
  handleTvdbRequest(
    id: string,
    seasonNumber: number | null,
    episodeNumber: number | null,
    isMovie?: boolean
  ): Promise<{ streams: StreamForStremio[] }>;
}

/** Un id che nessun provider riconosce non è un errore: è zero stream. */
export function dispatchRequest(
  provider: StreamProvider,
  id: string,
  seasonNumber: number | null,
  episodeNumber: number | null,
  isMovie: boolean
): Promise<{ streams: StreamForStremio[] }> {
  if (id.startsWith('kitsu:')) return provider.handleKitsuRequest(id);
  if (id.startsWith('mal:')) return provider.handleMalRequest(id);
  if (id.startsWith('tt')) return provider.handleImdbRequest(id, seasonNumber, episodeNumber, isMovie);
  if (id.startsWith('tmdb:')) {
    return provider.handleTmdbRequest(toNumericId(id), seasonNumber, episodeNumber, isMovie);
  }
  if (id.startsWith('tvdb:')) {
    return provider.handleTvdbRequest(toNumericId(id), seasonNumber, episodeNumber, isMovie);
  }
  return Promise.resolve({ streams: [] });
}
