/**
 * Canonical types for the local/official anime mapping layer.
 * Mapping sources: local build (TMDB + TVDB + Kitsu official APIs) and live APIs.
 */

export type MappingProvider = 'kitsu' | 'imdb' | 'tmdb' | 'tvdb' | 'mal';

export type MappingSource = 'local' | 'live' | 'kitsu';

export interface ParsedRequestId {
  provider: MappingProvider;
  id: string;
  season: number | null;
  episode: number | null;
  isMovie: boolean;
}

export interface MappingCredentials {
  /** Per-request TMDB key (user config wins over the env fallback). */
  tmdbApiKey?: string;
  /** Per-request TVDB key (user config wins over the env fallback). */
  tvdbApiKey?: string;
  /** Per-request TVDB PIN, only needed when the TVDB project requires it. */
  tvdbPin?: string;
}

export type MappingCredentialsInput = MappingCredentials | string;

export function normalizeMappingCredentials(input?: MappingCredentialsInput): MappingCredentials {
  if (typeof input === 'string') return { tmdbApiKey: input };
  return input || {};
}

export interface MappingRequest {
  provider: MappingProvider;
  id: string;
  season: number | null;
  episode: number | null;
  isMovie: boolean;
  /** Per-request TMDB key (user config wins over the env fallback). */
  tmdbApiKey?: string;
}

/** What providers consume: Kitsu entry + episode relative to that Kitsu entry. */
export interface MappingTarget {
  kitsuId: string;
  kitsuEpisode: number;
  title: string;
  /** Titolo MAL (romaji): i siti italiani listano spesso l'opera così. */
  titleAlt?: string;
  /** Titolo italiano (TMDB it-IT): Saturn e AnimeWorld listano spesso questo. */
  titleIt?: string;
  /**
   * Stagione da usare per comporre la query italiana. Serve agli id Kitsu, dove
   * `displaySeason` è null ma l'indice sa in che stagione sta la entry.
   */
  titleItSeason?: number | null;
  /**
   * Season label to show/filter in the provider.
   * null for Kitsu (one ID == one season/entry) and for movies.
   */
  displaySeason: number | null;
  source: MappingSource;
}

/**
 * A step in a single external season. `from` is the external episode number
 * where this Kitsu entry starts; `offset` is subtracted from the external
 * episode to get the Kitsu-relative episode (defaults to from - 1).
 */
export interface SeasonRange {
  from: number;
  kitsuId: string;
  offset?: number;
  /** Kitsu entry title for this range (split cours have different titles). */
  title?: string;
  /** Titolo MAL (romaji) della stessa cour, per la ricerca sui siti. */
  titleAlt?: string;
  /** Kitsu entry episode count, used to reject out-of-range requests. */
  episodeCount?: number | null;
}

export interface SeriesIndexEntry {
  title?: string;
  /** Titolo italiano dell'opera (TMDB it-IT), usato come query di ripiego. */
  titleIt?: string;
  /** External season number -> step ranges, ordered by `from`. */
  seasons?: Record<string, SeasonRange[]>;
}

export interface MovieIndexEntry {
  kitsuId: string;
  title?: string;
  /** Titolo MAL (romaji) della stessa opera, per la ricerca sui siti. */
  titleAlt?: string;
  /** Titolo italiano del film (TMDB it-IT). */
  titleIt?: string;
}

export interface AnimeMappingIndex {
  version: number;
  generatedAt?: string | null;
  series: Record<string, SeriesIndexEntry>;
  movies: Record<string, MovieIndexEntry>;
}

export const MAPPING_SCHEMA_VERSION = 1;
