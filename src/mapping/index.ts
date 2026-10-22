/**
 * Local anime mapping index.
 *
 * Schema v1:
 *   series: { "imdb:tt...": { title, seasons: { "3": [{ from, kitsuId, offset, title, episodeCount }] } } }
 *   movies: { "tmdb:...": { kitsuId, title } }
 *
 * `from` is the external episode number where a Kitsu entry starts in that
 * season; `offset` is subtracted from the external episode. When offset is
 * omitted, from - 1 is used. A missing local match optionally falls back to
 * live official APIs (see live.ts).
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { AnimeMappingIndex, MappingCredentialsInput, MappingProvider, MappingRequest, MappingTarget, SeasonRange, SeriesIndexEntry } from './types.js';
import { MAPPING_SCHEMA_VERSION } from './types.js';
import { getSeasonTitle, resolveLiveTarget } from './live.js';
import { debug } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface IndexSnapshot {
  filePath: string;
  mtimeMs: number;
  overridesPath: string;
  overridesMtimeMs: number;
  index: AnimeMappingIndex;
  signature: string;
}

const EMPTY_INDEX: AnimeMappingIndex = {
  version: 0,
  generatedAt: null,
  series: {},
  movies: {},
};

let snapshot: IndexSnapshot | null = null;

function defaultIndexPath(): string {
  return path.resolve(__dirname, 'data', 'anime-seasons.json');
}

function overridesPath(): string {
  return process.env.ANIME_MAPPING_OVERRIDES
    ? path.resolve(process.env.ANIME_MAPPING_OVERRIDES)
    : path.resolve(__dirname, 'overrides.json');
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeIndex(raw: unknown): AnimeMappingIndex {
  if (!isRecord(raw) || raw.version !== MAPPING_SCHEMA_VERSION) return EMPTY_INDEX;
  return {
    version: raw.version,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
    series: isRecord(raw.series) ? raw.series : {},
    movies: isRecord(raw.movies) ? raw.movies : {},
  };
}

function mergeOverrides(index: AnimeMappingIndex, overrides: unknown): AnimeMappingIndex {
  if (!isRecord(overrides)) return index;
  const merged: AnimeMappingIndex = {
    ...index,
    series: { ...index.series },
    movies: { ...index.movies },
  };
  if (isRecord(overrides.series)) {
    for (const [key, value] of Object.entries(overrides.series)) {
      if (isRecord(value)) merged.series[key] = value as SeriesIndexEntry;
    }
  }
  if (isRecord(overrides.movies)) {
    for (const [key, value] of Object.entries(overrides.movies)) {
      if (isRecord(value)) merged.movies[key] = value as any;
    }
  }
  return merged;
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function statMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return -1;
  }
}

function loadIndex(): AnimeMappingIndex {
  const filePath = process.env.ANIME_MAPPING_FILE ? path.resolve(process.env.ANIME_MAPPING_FILE) : defaultIndexPath();
  const overridesFile = overridesPath();
  const mtimeMs = statMtime(filePath);
  const overridesMtimeMs = statMtime(overridesFile);

  if (
    snapshot?.filePath === filePath &&
    snapshot.mtimeMs === mtimeMs &&
    snapshot.overridesPath === overridesFile &&
    snapshot.overridesMtimeMs === overridesMtimeMs
  ) {
    debug(4, 'Mapping', 'index cache hit');
    return snapshot.index;
  }

  const rawIndex = mtimeMs === -1 ? null : readJson(filePath);
  const rawOverrides = overridesMtimeMs === -1 ? null : readJson(overridesFile);
  let index = mergeOverrides(normalizeIndex(rawIndex), rawOverrides);
  const signature = createHash('sha256')
    .update(
      `${index.version}|${index.generatedAt || ''}|${Object.keys(index.series).length}|${Object.keys(index.movies).length}|` +
        `${JSON.stringify(rawIndex)}|${JSON.stringify(rawOverrides)}`
    )
    .digest('hex')
    .slice(0, 16);
  snapshot = { filePath, mtimeMs, overridesPath: overridesFile, overridesMtimeMs, index, signature };
  debug(2, 'Mapping', 'index loaded', {
    series: Object.keys(index.series).length,
    movies: Object.keys(index.movies).length,
    generatedAt: index.generatedAt,
    signature,
  });
  return index;
}

/**
 * Cache-busting signature: changes with schema, generatedAt, item counts and
 * the actual index/overrides content (not just the schema version).
 */
export function getMappingVersion(): string {
  loadIndex();
  return snapshot ? snapshot.signature : 'empty';
}

export function resetMappingCache(): void {
  snapshot = null;
}

export function hasMappedSeries(provider: MappingProvider, id: string): boolean {
  return Boolean(loadIndex().series[`${provider}:${id}`]);
}

export function hasMappedMovie(provider: MappingProvider, id: string): boolean {
  return Boolean(loadIndex().movies[`${provider}:${id}`]);
}

/** Local series or movie mapping present (authoritative for AnimeGate). */
export function hasMappedEntry(provider: MappingProvider, id: string): boolean {
  return hasMappedSeries(provider, id) || hasMappedMovie(provider, id);
}

function seriesFor(request: MappingRequest): SeriesIndexEntry | undefined {
  return loadIndex().series[`${request.provider}:${request.id}`];
}

/**
 * Pure local resolution (no network). Returns null on a miss so callers can
 * decide whether to try live resolution.
 */
export function resolveLocalTarget(request: MappingRequest): MappingTarget | null {
  debug(4, 'Mapping', 'local lookup', request);
  if (request.provider === 'kitsu') {
    const target: MappingTarget = {
      kitsuId: request.id,
      kitsuEpisode: request.episode ?? 1,
      title: '',
      displaySeason: null,
      source: 'kitsu',
    };
    debug(3, 'Mapping', 'local hit', target);
    return target;
  }

  const index = loadIndex();

  if (request.isMovie || request.episode === null) {
    const movieRaw: any = index.movies[`${request.provider}:${request.id}`];
    const movieKitsuId = typeof movieRaw === 'string' ? movieRaw : movieRaw?.kitsuId;
    if (!movieKitsuId) {
      debug(3, 'Mapping', 'local miss', { provider: request.provider, id: request.id, reason: 'movie-not-mapped' });
      return null;
    }
    const target: MappingTarget = {
      kitsuId: String(movieKitsuId),
      kitsuEpisode: 1,
      title: (typeof movieRaw === 'object' && movieRaw?.title) || '',
      displaySeason: null,
      source: 'local',
    };
    debug(2, 'Mapping', 'local hit', target);
    return target;
  }

  const series: any = seriesFor(request);
  if (!series) {
    debug(3, 'Mapping', 'local miss', { provider: request.provider, id: request.id, reason: 'series-not-mapped' });
    return null;
  }

  const season = request.season ?? 1;
  const seasonSource = series.seasons ?? series;
  let ranges: SeasonRange[] | undefined;
  if (Array.isArray(seasonSource)) {
    ranges = seasonSource.filter((item: any) => Number(item.season ?? 1) === season) as SeasonRange[];
  } else if (seasonSource && typeof seasonSource === 'object') {
    const candidate = seasonSource[String(season)] ?? seasonSource[season];
    if (Array.isArray(candidate)) ranges = candidate as SeasonRange[];
  }
  if (!ranges) {
    debug(3, 'Mapping', 'local miss', { provider: request.provider, id: request.id, season: request.season, reason: 'season-not-mapped' });
    return null;
  }

  const episode = request.episode;
  const range = ranges
    .filter((item) => Number.isFinite(item.from) && item.from <= episode && item.kitsuId)
    .sort((a, b) => a.from - b.from)
    .at(-1);
  if (!range) {
    debug(3, 'Mapping', 'local miss', { provider: request.provider, id: request.id, season: request.season, episode, reason: 'range-not-mapped' });
    return null;
  }

  const offset = Number.isFinite(range.offset) ? Number(range.offset) : range.from - 1;
  const kitsuEpisode = episode - offset;
  if (kitsuEpisode <= 0 || (Number.isFinite(range.episodeCount) && kitsuEpisode > Number(range.episodeCount))) {
    debug(3, 'Mapping', 'local miss', {
      provider: request.provider,
      id: request.id,
      season: request.season,
      episode,
      reason: 'episode-out-of-range',
      kitsuEpisode,
      episodeCount: range.episodeCount,
    });
    return null;
  }

  const target: MappingTarget = {
    kitsuId: String(range.kitsuId),
    kitsuEpisode,
    title: range.title || series.title || '',
    displaySeason: request.season,
    source: 'local',
  };
  debug(2, 'Mapping', 'local hit', target);
  return target;
}

/** Local first, then live official APIs. */
export async function resolveAnimeTarget(
  request: MappingRequest,
  credentials?: MappingCredentialsInput
): Promise<MappingTarget | null> {
  const local = resolveLocalTarget(request);
  if (local) return local;
  debug(2, 'Mapping', 'live fallback', request);
  const live = await resolveLiveTarget(request, credentials);
  debug(live ? 2 : 3, 'Mapping', live ? 'live hit' : 'unresolved', {
    provider: request.provider,
    id: request.id,
    season: request.season,
    episode: request.episode,
    target: live,
  });
  return live;
}

/**
 * Season-specific title for a mapping miss (split cours must not be searched
 * with the base series title). Returns null when no distinct season title is
 * available, so providers can prefer no stream over a wrong episode.
 */
export async function resolveSeasonFallbackTitle(
  request: MappingRequest,
  credentials?: MappingCredentialsInput
): Promise<string | null> {
  if (request.isMovie || request.episode === null) return null;
  const season = request.season ?? 1;
  if (season <= 1) return null;
  const title = await getSeasonTitle(request, season, credentials);
  debug(2, 'Mapping', 'season fallback title', { provider: request.provider, id: request.id, season, title });
  return title;
}

export {
  resolveLiveTarget,
  getKitsuTitle,
  getTvdbTitle,
  getSeasonTitle,
  getKitsuMalIdForTmdb,
  tvdbSeriesHasKitsu,
  fetchKitsuAnime,
} from './live.js';
export { resolveMappingRequest, parseRequestId, toNumericId } from './request.js';
export type {
  AnimeMappingIndex,
  MappingCredentials,
  MappingCredentialsInput,
  MappingProvider,
  MappingRequest,
  MappingTarget,
  SeasonRange,
  SeriesIndexEntry,
} from './types.js';
