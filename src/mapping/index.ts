/**
 * Local anime mapping index.
 *
 * Schema v1:
 *   series: { "imdb:tt...": { title, seasons: { "3": [{ from, kitsuId, offset, title, titleAlt, episodeCount }] } } }
 *   movies: { "tmdb:...": { kitsuId, title, titleAlt } }
 *
 * `from` is the external episode number where a Kitsu entry starts in that
 * season; `offset` is subtracted from the external episode. When offset is
 * omitted, from - 1 is used. `titleAlt` is the MAL romaji, which is what the
 * Italian sites often list (the English title alone scores 0 on their filter).
 * A missing local match optionally falls back to live official APIs (see live.ts).
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
  /** kitsuId -> titoli alternativi, per le richieste che arrivano da Kitsu. */
  kitsuAlt: Map<string, { titleAlt: string; titleIt: string; season: number | null }>;
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

/** TTL dell'indice scaricato da ANIME_MAPPING_URL: un giorno. */
const REMOTE_TTL_MS = 24 * 60 * 60 * 1000;
/** Un indice corrotto o enorme non deve finire in memoria. */
const REMOTE_MAX_BYTES = 64 * 1024 * 1024;

function remoteCachePath(): string {
  return process.env.ANIME_MAPPING_FILE
    ? path.resolve(process.env.ANIME_MAPPING_FILE)
    : path.resolve('data', 'anime-seasons.json');
}

/**
 * Ordine: file esplicito, indice remoto in cache, indice nell'immagine.
 * Se il download remoto non è mai riuscito si continua col file locale.
 */
function indexFilePath(): string {
  if (process.env.ANIME_MAPPING_FILE) return path.resolve(process.env.ANIME_MAPPING_FILE);
  if (process.env.ANIME_MAPPING_URL) {
    const cached = remoteCachePath();
    if (statMtime(cached) !== -1) return cached;
  }
  return defaultIndexPath();
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

/**
 * Titoli alternativi per kitsuId. Le richieste Kitsu non passano dalle chiavi
 * esterne, quindi senza questa mappa `titleAlt`/`titleIt` non arriverebbero mai
 * ai provider.
 */
function buildKitsuAlt(index: AnimeMappingIndex): Map<string, { titleAlt: string; titleIt: string; season: number | null }> {
  interface Alt { titleAlt: string; titleIt: string; seasons: Set<number> }
  const raw = new Map<string, Alt>();
  const add = (kitsuId: string, season: number | null, titleAlt: string, titleIt: string) => {
    if (!kitsuId) return;
    const current = raw.get(kitsuId) || { titleAlt: '', titleIt: '', seasons: new Set<number>() };
    if (season && season > 0) current.seasons.add(season);
    current.titleAlt = current.titleAlt || titleAlt;
    current.titleIt = current.titleIt || titleIt;
    raw.set(kitsuId, current);
  };
  for (const entry of Object.values(index.series)) {
    const entryTitleIt = entry.titleIt || '';
    for (const [seasonKey, ranges] of Object.entries(entry.seasons || {})) {
      const season = Number(seasonKey);
      for (const range of ranges) add(String(range.kitsuId || ''), Number.isFinite(season) ? season : null, range.titleAlt || '', entryTitleIt);
    }
  }
  for (const entry of Object.values(index.movies)) {
    add(String(entry.kitsuId || ''), null, entry.titleAlt || '', entry.titleIt || '');
  }
  // Stagione utile solo se la entry sta in una sola stagione: split cour con
  // numeri diversi non danno una risposta affidabile.
  const map = new Map<string, { titleAlt: string; titleIt: string; season: number | null }>();
  for (const [kitsuId, value] of raw) {
    map.set(kitsuId, {
      titleAlt: value.titleAlt,
      titleIt: value.titleIt,
      season: value.seasons.size === 1 ? [...value.seasons][0] : null,
    });
  }
  return map;
}

function loadIndex(): AnimeMappingIndex {  const filePath = indexFilePath();
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
  snapshot = { filePath, mtimeMs, overridesPath: overridesFile, overridesMtimeMs, index, kitsuAlt: buildKitsuAlt(index), signature };
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

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, filePath);
}

function readEtag(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Scarica l'indice mapping da ANIME_MAPPING_URL (es. raw di un branch) e lo
 * mette in cache su disco. Best effort: senza URL, o con rete/schema rotti,
 * resta il file precedente o quello nell'immagine. Non blocca l'avvio.
 */
export async function refreshMappingFromUrl(): Promise<void> {
  const url = process.env.ANIME_MAPPING_URL;
  if (!url) return;
  const target = remoteCachePath();
  const mtime = statMtime(target);
  if (mtime !== -1 && Date.now() - mtime < REMOTE_TTL_MS) {
    debug(4, 'Mapping', 'remote index fresh', { ageMs: Date.now() - mtime });
    return;
  }

  const headers: Record<string, string> = {};
  // Repo privato: raw.githubusercontent.com richiede un token (Contents: read).
  const token = String(process.env.ANIME_MAPPING_TOKEN || '').trim();
  if (token) headers.authorization = `Bearer ${token}`;
  const etag = mtime === -1 ? '' : readEtag(`${target}.etag`);
  if (etag) headers['if-none-match'] = etag;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (res.status === 304 && mtime !== -1) {
      // Contenuto identico: rinnova solo la scadenza, senza riscrivere il file.
      const now = new Date();
      fs.utimesSync(target, now, now);
      debug(3, 'Mapping', 'remote index unchanged (304)');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (body.length > REMOTE_MAX_BYTES) throw new Error(`payload troppo grande (${body.length} byte)`);
    const index = normalizeIndex(JSON.parse(body));
    const entries = Object.keys(index.series).length + Object.keys(index.movies).length;
    if (!index.version || entries === 0) throw new Error('indice vuoto o schema non supportato');
    writeAtomic(target, body);
    const nextEtag = res.headers.get('etag');
    if (nextEtag) writeAtomic(`${target}.etag`, nextEtag);
    snapshot = null;
    debug(2, 'Mapping', 'remote index updated', {
      series: Object.keys(index.series).length,
      movies: Object.keys(index.movies).length,
      generatedAt: index.generatedAt,
    });
  } catch (e) {
    debug(2, 'Mapping', 'remote index refresh failed, keeping local', {
      error: (e as any)?.message || String(e),
    });
  }
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
 * Lo stesso kitsuId serve anche un'altra stagione? Allora è la serie madre
 * riusata da un range di stagione 0 costruito male, non una special.
 */
function kitsuUsedElsewhere(series: SeriesIndexEntry, kitsuId: string | undefined, season: number): boolean {
  const id = String(kitsuId || '');
  if (!id) return false;
  const seasons = (series as any)?.seasons;
  if (!seasons || typeof seasons !== 'object') return false;
  return Object.entries(seasons).some(
    ([key, list]) =>
      Number(key) !== season &&
      Array.isArray(list) &&
      list.some((range: any) => String(range?.kitsuId || '') === id)
  );
}

/** Un titolo "italiano" con caratteri CJK non serve a cercare sui siti. */
function latinTitle(value: string | undefined): string {
  const title = String(value || '');
  if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(title)) return '';
  return (title.match(/[A-Za-z]/g) || []).length >= 3 ? title : '';
}

/**
 * Pure local resolution (no network). Returns null on a miss so callers can
 * decide whether to try live resolution.
 */
export function resolveLocalTarget(request: MappingRequest): MappingTarget | null {
  debug(4, 'Mapping', 'local lookup', request);
  if (request.provider === 'kitsu') {
    loadIndex();
    const alt = snapshot?.kitsuAlt.get(String(request.id));
    const target: MappingTarget = {
      kitsuId: request.id,
      kitsuEpisode: request.episode ?? 1,
      title: '',
      // Solo l'italiano: per le richieste Kitsu il romaji non è mai stato usato
      // e anticiperebbe le varianti storiche che oggi trovano la scheda giusta.
      titleAlt: '',
      titleIt: alt?.titleIt || '',
      titleItSeason: alt?.season ?? null,
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
    // I film mappati col solo TMDB non hanno kitsuId: il provider cerca per titolo.
    const movieTitle = (typeof movieRaw === 'object' && movieRaw?.title) || '';
    if (!movieKitsuId && !movieTitle) {
      debug(3, 'Mapping', 'local miss', { provider: request.provider, id: request.id, reason: 'movie-not-mapped' });
      return null;
    }
    const target: MappingTarget = {
      kitsuId: movieKitsuId ? String(movieKitsuId) : '',
      kitsuEpisode: 1,
      title: (typeof movieRaw === 'object' && movieRaw?.title) || '',
      titleAlt: (typeof movieRaw === 'object' && movieRaw?.titleAlt) || '',
      titleIt: (typeof movieRaw === 'object' && movieRaw?.titleIt) || '',
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
    // Un range senza kitsuId (mappato col solo TMDB) è valido se ha un titolo:
    // è quello che i provider cercano.
    .filter((item) => Number.isFinite(item.from) && item.from <= episode && (item.kitsuId || item.title))
    .sort((a, b) => a.from - b.from)
    .at(-1);
  if (!range) {
    debug(3, 'Mapping', 'local miss', { provider: request.provider, id: request.id, season: request.season, episode, reason: 'range-not-mapped' });
    return null;
  }

  const offset = Number.isFinite(range.offset) ? Number(range.offset) : range.from - 1;
  // Offset negativo NON è di per sé un errore: con la numerazione a passi
  // (episodio saltato o inserito) vale kitsu = esterno + 1, ed è la mappatura
  // giusta. L'errore vero era una special di stagione 0 che riusava il kitsuId
  // della madre: quello si riconosce perché lo stesso kitsuId serve anche
  // un'altra stagione della serie.
  if (offset < 0 && season === 0 && kitsuUsedElsewhere(series, range.kitsuId, season)) {
    debug(3, 'Mapping', 'local miss', { provider: request.provider, id: request.id, season: request.season, episode, reason: 'negative-offset-mother', offset });
    return null;
  }
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

  // La stagione 0 è un'opera a sé (OVA/special): il titolo italiano e la
  // stagione della serie madre non c'entrano, e passandoli il provider
  // filtrerebbe i risultati sulla madre e chiederebbe il suo episodio 1.
  const isSpecial = Number(season) === 0;
  // Un range in stagione 0 col titolo della madre porterebbe alla serie e al suo
  // episodio N: meglio il live che un episodio sbagliato. Il titolo della madre
  // può essere quello TVDB (giapponese) o l'italiano di TMDB, e il range porta
  // spesso il secondo.
  const sharesSeriesTitle =
    !!range.title && (range.title === series.title || (!!series.titleIt && range.title === series.titleIt));
  if (isSpecial && sharesSeriesTitle) {
    debug(3, 'Mapping', 'local miss', { provider: request.provider, id: request.id, reason: 'special-shares-series-title' });
    return null;
  }
  const target: MappingTarget = {
    kitsuId: String(range.kitsuId),
    kitsuEpisode,
    title: range.title || series.title || '',
    titleAlt: range.titleAlt || '',
    // TMDB it-IT a volte restituisce il titolo giapponese (es. "ファントム THE
    // ANIMATION"): come query italiana è una richiesta sprecata, quindi si scarta.
    titleIt: isSpecial ? '' : latinTitle(series.titleIt),
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
