/**
 * Live fallback resolution using official APIs only:
 * Kitsu (public), TMDB (TMDB_API_KEY), TVDB v4 (TVDB_API_KEY, optional TVDB_PIN).
 *
 * TVDB episode lookups always use aired/default order (`/episodes/default`).
 * Movies resolve through TMDB/IMDb external ids, never TVDB.
 * Credentials can be supplied per request; env vars are the fallback.
 */

import { createHash } from 'node:crypto';
import { getTmdbIdFromImdbId } from '../utils/tmdbResolver.js';
import { debug, redactUrl } from '../utils/logger.js';
import type { MappingCredentials, MappingCredentialsInput, MappingRequest, MappingTarget } from './types.js';
import { normalizeMappingCredentials } from './types.js';

const KITSU_API = 'https://kitsu.io/api/edge';
const TMDB_API = 'https://api.themoviedb.org/3';
const TVDB_API = 'https://api4.thetvdb.com/v4';

const LIVE_TTL_MS = 6 * 60 * 60 * 1000;

interface KitsuAnimeEntry {
  id: string;
  title: string;
  startDate: string | null;
  subtype: string | null;
  episodeCount: number | null;
}

interface TvdbEpisode {
  seasonNumber: number | null;
  number: number | null;
  aired: string | null;
}

interface CacheEntry {
  expires: number;
  value: unknown;
}

const liveCache = new Map<string, CacheEntry>();
const LIVE_CACHE_MAX_ENTRIES = 500;

const RETRY_ATTEMPTS = 4;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let lastError: unknown;
  const endpoint = redactUrl(url);
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      debug(4, 'Mapping/HTTP', 'request', { endpoint, attempt: attempt + 1 });
      const accept = new URL(url).hostname.endsWith('kitsu.io')
        ? 'application/vnd.api+json'
        : 'application/json';
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(10_000),
        headers: { accept, ...(init?.body ? { 'content-type': 'application/json' } : {}), ...(init?.headers || {}) },
      });
      if (response.ok) {
        debug(4, 'Mapping/HTTP', 'ok', { endpoint, status: response.status });
        return (await response.json()) as T;
      }
      const error = new HttpError(response.status, `HTTP ${response.status} for ${new URL(url).host}`);
      debug(3, 'Mapping/HTTP', 'failed', { endpoint, status: response.status, attempt: attempt + 1 });
      // Retry only transient failures; a 401 must reach the TVDB refresh path.
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
      const retryAfter = Number.parseInt(response.headers?.get?.('retry-after') || '', 10);
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt;
      debug(3, 'Mapping/HTTP', 'retry', { endpoint, status: response.status, waitMs });
      if (attempt < RETRY_ATTEMPTS - 1) await sleep(waitMs);
    } catch (error) {
      if (error instanceof HttpError && error.status !== 429 && error.status < 500) throw error;
      // Un timeout/abort ha gia' consumato il budget della richiesta: inutile ritentare.
      const name = (error as any)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') throw error;
      lastError = error;
      if (attempt < RETRY_ATTEMPTS - 1) {
        debug(3, 'Mapping/HTTP', 'retry after error', { endpoint, attempt: attempt + 1, error: (error as any)?.message || String(error) });
        await sleep(250 * 2 ** attempt);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function cached<T>(key: string, fn: () => Promise<T>, ttlMs = LIVE_TTL_MS): Promise<T> {
  const hit = liveCache.get(key);
  if (hit && hit.expires > Date.now()) {
    debug(4, 'Mapping/Cache', 'hit', key);
    return hit.value as T;
  }
  debug(4, 'Mapping/Cache', 'miss', key);
  const value = await fn();
  liveCache.set(key, { expires: Date.now() + ttlMs, value });
  // Stesso limite della cache provider: l'eviction evita crescita illimitata
  // in un processo che resta acceso per settimane.
  if (liveCache.size > LIVE_CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [entryKey, entry] of liveCache) {
      if (entry.expires <= now) liveCache.delete(entryKey);
    }
    let excess = liveCache.size - LIVE_CACHE_MAX_ENTRIES;
    for (const entryKey of liveCache.keys()) {
      if (excess <= 0) break;
      liveCache.delete(entryKey);
      excess -= 1;
    }
  }
  return value;
}

function kitsuEntryFromResource(resource: any): KitsuAnimeEntry | null {
  if (!resource || resource.type !== 'anime' || !resource.id) return null;
  const attributes = resource.attributes || {};
  const titles = attributes.titles || {};
  return {
    id: String(resource.id),
    title: titles.en || titles.en_jp || attributes.canonicalTitle || '',
    startDate: attributes.startDate || null,
    subtype: attributes.subtype || null,
    episodeCount: Number.isFinite(attributes.episodeCount) ? Number(attributes.episodeCount) : null,
  };
}

export async function fetchKitsuAnime(kitsuId: string): Promise<KitsuAnimeEntry | null> {
  return cached(`kitsu:anime:${kitsuId}`, async () => {
    const json = await fetchJson<any>(`${KITSU_API}/anime/${encodeURIComponent(kitsuId)}`);
    return kitsuEntryFromResource(json?.data);
  });
}

export async function getKitsuTitle(kitsuId: string): Promise<string> {
  try {
    return (await fetchKitsuAnime(kitsuId))?.title || '';
  } catch {
    return '';
  }
}

function hashTvdbCredentials(apiKey: string, pin: string): string {
  return createHash('sha256').update(`${apiKey}|${pin}`).digest('hex').slice(0, 16);
}

/** TVDB v4 login token, cached per credential set. Never caches a null token. */
async function getTvdbToken(credentials: MappingCredentials = {}, forceRefresh = false): Promise<string | null> {
  const apiKey = String(credentials.tvdbApiKey || process.env.TVDB_API_KEY || '').trim();
  if (!apiKey) return null;
  const pin = String(credentials.tvdbPin || process.env.TVDB_PIN || '').trim();
  // Never log or use the raw key as a cache key: the debug logger prints cache keys at level 4.
  const tokenKey = `tvdb:token:${hashTvdbCredentials(apiKey, pin)}`;
  if (forceRefresh) liveCache.delete(tokenKey);
  try {
    return await cached(tokenKey, async () => {
      const body: Record<string, string> = { apikey: apiKey };
      if (pin) body.pin = pin;
      const json = await fetchJson<any>(`${TVDB_API}/login`, { method: 'POST', body: JSON.stringify(body) });
      const token = json?.data?.token || null;
      // Throwing keeps cached() from storing a null token.
      if (!token) throw new Error('TVDB login returned no token');
      return token;
    });
  } catch {
    return null;
  }
}

async function tvdbGet(pathname: string, credentials: MappingCredentials = {}): Promise<any | null> {
  let token = await getTvdbToken(credentials);
  if (!token) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchJson<any>(`${TVDB_API}${pathname}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (attempt === 0 && error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        token = await getTvdbToken(credentials, true);
        if (token) continue;
      }
      return null;
    }
  }
  return null;
}

/** TVDB episodes in aired/default order, optionally limited to one season. */
async function getTvdbEpisodes(tvdbId: string, season?: number, credentials: MappingCredentials = {}): Promise<TvdbEpisode[]> {
  const apiKey = String(credentials.tvdbApiKey || process.env.TVDB_API_KEY || '').trim();
  const pin = String(credentials.tvdbPin || process.env.TVDB_PIN || '').trim();
  const credentialKey = hashTvdbCredentials(apiKey, pin);
  return cached(`tvdb:episodes:${credentialKey}:${tvdbId}:${season ?? 'all'}`, async () => {
    const episodes: TvdbEpisode[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 50; page++) {
      const query = `page=${page}${season === undefined ? '' : `&season=${season}`}`;
      const json = await tvdbGet(`/series/${encodeURIComponent(tvdbId)}/episodes/default?${query}`, credentials);
      // A missing token/transient failure must not be cached as "no episodes".
      if (json === null) throw new Error('TVDB episodes unavailable');
      const batch = Array.isArray(json?.data?.episodes) ? json.data.episodes : [];
      let added = 0;
      for (const episode of batch) {
        const seasonNumber = Number.isFinite(episode?.seasonNumber) ? Number(episode.seasonNumber) : null;
        const number = Number.isFinite(episode?.number) ? Number(episode.number) : null;
        const key = `${seasonNumber}:${number}`;
        if (seen.has(key)) continue;
        seen.add(key);
        added += 1;
        episodes.push({ seasonNumber, number, aired: episode?.aired || null });
      }
      if (batch.length === 0) break;
      // Prefer the API's next link. If it is absent, keep paging only while the
      // endpoint is still returning new rows (some TVDB responses omit links).
      if (!json?.links?.next && added === 0) break;
    }
    return episodes;
  });
}

export async function getTvdbTitle(tvdbId: string, credentials: MappingCredentialsInput = {}): Promise<string> {
  const json = await tvdbGet(
    `/series/${encodeURIComponent(tvdbId)}/extended?short=true`,
    normalizeMappingCredentials(credentials)
  );
  return json?.data?.name || '';
}

/** Kitsu mappings for one external id, as Kitsu anime entries. Follows pagination. */
async function getKitsuMappings(externalSite: string, externalId: string): Promise<KitsuAnimeEntry[]> {
  const cacheKey = `kitsu:mappings:${externalSite}:${externalId}`;
  return cached(cacheKey, async () => {
    const byId = new Map<string, KitsuAnimeEntry>();
    let url: string | null =
      `${KITSU_API}/mappings?filter[externalSite]=${encodeURIComponent(externalSite)}` +
      `&filter[externalId]=${encodeURIComponent(externalId)}&page[limit]=20&include=item`;
    for (let page = 0; url && page < 20; page++) {
      const json: any = await fetchJson<any>(url);
      for (const resource of Array.isArray(json?.included) ? json.included : []) {
        const entry = kitsuEntryFromResource(resource);
        if (entry) byId.set(entry.id, entry);
      }
      for (const mapping of Array.isArray(json?.data) ? json.data : []) {
        const id = mapping?.relationships?.item?.data?.id;
        if (!id) continue;
        byId.set(String(id), byId.get(String(id)) || ({ id: String(id), title: '', startDate: null, subtype: null, episodeCount: null } as KitsuAnimeEntry));
      }
      url = typeof json?.links?.next === 'string' && json.links.next ? json.links.next : null;
    }
    const seeds: KitsuAnimeEntry[] = [];
    for (const entry of byId.values()) {
      seeds.push(entry.title ? entry : (await fetchKitsuAnime(entry.id)) || entry);
    }
    return seeds;
  });
}

async function fetchRelations(kitsuId: string): Promise<{ entry: KitsuAnimeEntry | null; relatedIds: string[] }> {
  return cached(`kitsu:relations:${kitsuId}`, async () => {
    const json = await fetchJson<any>(`${KITSU_API}/anime/${encodeURIComponent(kitsuId)}?include=mediaRelationships.destination`);
    const entry = kitsuEntryFromResource(json?.data);
    const relatedIds: string[] = [];
    for (const resource of Array.isArray(json?.included) ? json.included : []) {
      if (resource?.type !== 'mediaRelationships') continue;
      const role = resource?.attributes?.role;
      // Walk both directions so a later-season seed still finds earlier parts.
      if (role !== 'sequel' && role !== 'prequel') continue;
      const destinationId = resource?.relationships?.destination?.data?.id;
      if (destinationId) relatedIds.push(String(destinationId));
    }
    return { entry, relatedIds };
  });
}

/** Collect a seed plus all transitive sequel/prequel entries (split cours/parts). */
async function collectKitsuEntries(seeds: KitsuAnimeEntry[]): Promise<KitsuAnimeEntry[]> {
  const byId = new Map<string, KitsuAnimeEntry>();
  const queue = seeds.map((seed) => seed.id);
  const visited = new Set<string>();
  while (queue.length > 0 && visited.size < 80) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (!byId.has(id)) {
      const known = seeds.find((seed) => seed.id === id);
      const entry = known || (await fetchKitsuAnime(id));
      if (entry) byId.set(id, entry);
    }
    try {
      const { relatedIds } = await fetchRelations(id);
      for (const relatedId of relatedIds) if (!visited.has(relatedId)) queue.push(relatedId);
    } catch {
      // A relationship failure must not discard the entries already found.
    }
  }
  return [...byId.values()].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}

async function getKitsuEntriesForTvdb(tvdbId: string): Promise<KitsuAnimeEntry[]> {
  return cached(`kitsu:tvdb:${tvdbId}`, async () => {
    const seeds = await getKitsuMappings('thetvdb/series', tvdbId);
    if (seeds.length === 0) return [];
    return collectKitsuEntries(seeds);
  });
}

export async function tvdbSeriesHasKitsu(tvdbId: string): Promise<boolean> {
  try {
    return (await getKitsuEntriesForTvdb(tvdbId)).length > 0;
  } catch {
    return false;
  }
}

function toDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

function daysClose(a: number | null, b: number | null, tolerance = 1): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= tolerance;
}

function tmdbKeyFor(tmdbApiKey?: string): string {
  return String(tmdbApiKey || process.env.TMDB_API_KEY || '').trim();
}

async function resolveTvdbId(request: MappingRequest, credentials: MappingCredentials = {}): Promise<string | null> {
  if (request.provider === 'tvdb') return request.id;
  const tmdbKey = tmdbKeyFor(credentials.tmdbApiKey);
  if (!tmdbKey) return null;

  let tmdbId: string | null = null;
  if (request.provider === 'tmdb') tmdbId = request.id;
  else if (request.provider === 'imdb') {
    tmdbId = await getTmdbIdFromImdbId(request.id, tmdbKey, 'tv');
  }
  if (!tmdbId || !tmdbKey) return null;

  try {
    const json = await fetchJson<any>(`${TMDB_API}/tv/${encodeURIComponent(tmdbId)}/external_ids?api_key=${tmdbKey}`);
    const tvdbId = json?.tvdb_id;
    return tvdbId ? String(tvdbId) : null;
  } catch {
    return null;
  }
}

function normalizedTitle(value: string | null | undefined): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function searchKitsuMovie(title: string, year?: string): Promise<KitsuAnimeEntry | null> {
  if (!title) return null;
  const json = await fetchJson<any>(
    `${KITSU_API}/anime?filter[text]=${encodeURIComponent(title)}&filter[subtype]=movie&page[limit]=10`
  );
  const candidates: KitsuAnimeEntry[] = (Array.isArray(json?.data) ? json.data : [])
    .map((resource: any) => kitsuEntryFromResource(resource))
    .filter((entry: KitsuAnimeEntry | null): entry is KitsuAnimeEntry => Boolean(entry));
  if (candidates.length === 0) return null;

  const wanted = normalizedTitle(title);
  const exact = candidates.find((entry) => {
    const candidate = normalizedTitle(entry.title);
    return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
  });
  if (exact) return exact;
  if (year) {
    const sameYear = candidates.find((entry) => entry.startDate?.startsWith(year));
    if (sameYear) return sameYear;
  }
  return candidates[0];
}

async function resolveLiveMovie(request: MappingRequest, credentialsInput: MappingCredentialsInput = {}): Promise<MappingTarget | null> {
  const credentials = normalizeMappingCredentials(credentialsInput);
  const tmdbKey = tmdbKeyFor(credentials.tmdbApiKey);
  debug(3, 'Mapping/Live', 'movie lookup', { provider: request.provider, id: request.id });
  // Kitsu has no IMDb/TMDB mappings for anime movies. Resolve the official
  // TMDB movie title/year and use Kitsu's public title search.
  if (!tmdbKey) {
    debug(3, 'Mapping/Live', 'movie lookup skipped: missing TMDB key');
    return null;
  }
  let tmdbId: string | null = null;
  if (request.provider === 'tmdb') {
    tmdbId = request.id;
  } else if (request.provider === 'imdb') {
    try {
      const found = await fetchJson<any>(
        `${TMDB_API}/find/${encodeURIComponent(request.id)}?external_source=imdb_id&api_key=${tmdbKey}`
      );
      tmdbId = found?.movie_results?.[0]?.id ? String(found.movie_results[0].id) : null;
    } catch {
      return null;
    }
  }
  if (!tmdbId) return null;

  try {
    const movie = await fetchJson<any>(`${TMDB_API}/movie/${encodeURIComponent(tmdbId)}?api_key=${tmdbKey}`);
    const entry = await searchKitsuMovie(movie?.title || movie?.original_title, String(movie?.release_date || '').slice(0, 4));
    if (!entry) return null;
    return {
      kitsuId: entry.id,
      kitsuEpisode: 1,
      title: entry.title,
      displaySeason: null,
      source: 'live',
    };
  } catch {
    return null;
  }
}

/**
 * TMDB (and IMDb, via TMDB) episode air date. TMDB often flattens anime into a
 * single season, so its S/E cannot be passed to TVDB directly; the air date is
 * the bridge to the TVDB aired-order episode.
 */
async function getTmdbEpisode(
  request: MappingRequest,
  credentials: MappingCredentials = {}
): Promise<{ aired: string | null } | null> {
  if (request.season === null || request.episode === null) return null;
  const tmdbKey = tmdbKeyFor(credentials.tmdbApiKey);
  if (!tmdbKey) return null;

  let tmdbId: string | null = null;
  if (request.provider === 'tmdb') tmdbId = request.id;
  else if (request.provider === 'imdb') tmdbId = await getTmdbIdFromImdbId(request.id, tmdbKey, 'tv');
  if (!tmdbId) return null;

  const json = await fetchJson<any>(
    `${TMDB_API}/tv/${encodeURIComponent(tmdbId)}/season/${request.season}?api_key=${tmdbKey}`
  );
  const episode = Array.isArray(json?.episodes)
    ? json.episodes.find((item: any) => Number(item?.episode_number) === request.episode)
    : null;
  return episode ? { aired: episode.air_date || null } : null;
}

async function resolveLiveSeries(request: MappingRequest, credentialsInput: MappingCredentialsInput = {}): Promise<MappingTarget | null> {
  if (request.episode === null) return null;
  const credentials = normalizeMappingCredentials(credentialsInput);
  debug(3, 'Mapping/Live', 'series lookup', {
    provider: request.provider,
    id: request.id,
    season: request.season,
    episode: request.episode,
  });
  const tvdbId = await resolveTvdbId(request, credentials);
  if (!tvdbId) {
    debug(3, 'Mapping/Live', 'no TVDB id');
    return null;
  }

  const allEpisodes = await getTvdbEpisodes(tvdbId, undefined, credentials);
  debug(3, 'Mapping/Live', 'TVDB episodes', { tvdbId, count: allEpisodes.length });
  let targetEpisode: TvdbEpisode | undefined;
  if (request.provider === 'tvdb') {
    const season = request.season ?? 1;
    targetEpisode = allEpisodes.find(
      (episode) => episode.seasonNumber === season && episode.number === request.episode
    );
  } else {
    const tmdbEpisode = await getTmdbEpisode(request, credentials);
    if (!tmdbEpisode) return null;
    const targetDay = toDay(tmdbEpisode.aired);
    targetEpisode = allEpisodes.find((episode) => daysClose(targetDay, toDay(episode.aired)));
  }
  if (!targetEpisode) {
    debug(3, 'Mapping/Live', 'no TVDB episode match');
    return null;
  }

  // Movies reached through prequel/sequel traversal must not become series ranges.
  const entries = (await getKitsuEntriesForTvdb(tvdbId)).filter((entry) => entry.subtype !== 'movie');
  if (entries.length === 0) {
    debug(3, 'Mapping/Live', 'no Kitsu entries for TVDB id', { tvdbId });
    return null;
  }
  debug(3, 'Mapping/Live', 'Kitsu entries', {
    tvdbId,
    count: entries.length,
    ids: entries.map((entry) => entry.id),
  });

  const targetDay = toDay(targetEpisode.aired);
  const exactStart = entries.find((entry) => daysClose(targetDay, toDay(entry.startDate)));
  if (exactStart) {
    debug(2, 'Mapping/Live', 'exact start match', { kitsuId: exactStart.id, title: exactStart.title });
    return {
      kitsuId: exactStart.id,
      kitsuEpisode: 1,
      title: exactStart.title,
      displaySeason: request.season,
      source: 'live',
    };
  }

  const targetIndex = allEpisodes.findIndex(
    (episode) => episode.seasonNumber === targetEpisode.seasonNumber && episode.number === targetEpisode.number
  );
  if (targetIndex < 0) {
    debug(3, 'Mapping/Live', 'target episode index not found');
    return null;
  }

  const datedEntries = entries.filter((entry) => entry.startDate);
  let chosen: KitsuAnimeEntry | undefined;
  if (targetDay !== null) {
    for (const entry of datedEntries) {
      const entryDay = toDay(entry.startDate);
      if (entryDay !== null && entryDay <= targetDay + 1) chosen = entry;
    }
  }
  if (!chosen) chosen = datedEntries[0] || entries[0];

  let startIndex = -1;
  const chosenDay = toDay(chosen.startDate);
  if (chosenDay !== null) {
    startIndex = allEpisodes.findIndex((episode) => {
      const day = toDay(episode.aired);
      return day !== null && day >= chosenDay - 1;
    });
  }
  if (startIndex < 0) startIndex = targetIndex;

  const kitsuEpisode = targetIndex - startIndex + 1;
  if (kitsuEpisode <= 0 || (Number.isFinite(chosen.episodeCount) && kitsuEpisode > Number(chosen.episodeCount))) {
    debug(3, 'Mapping/Live', 'Kitsu episode out of range', {
      kitsuId: chosen.id,
      kitsuEpisode,
      episodeCount: chosen.episodeCount,
      targetIndex,
      startIndex,
    });
    return null;
  }

  const target: MappingTarget = {
    kitsuId: chosen.id,
    kitsuEpisode,
    title: chosen.title,
    displaySeason: request.season,
    source: 'live',
  };
  debug(2, 'Mapping/Live', 'series resolved', target);
  return target;
}

/**
 * Season-specific title from the official API (TMDB season name or TVDB season
 * name). Used on a mapping miss so split-cour requests are never searched with
 * the base series title.
 */
export async function getSeasonTitle(
  request: MappingRequest,
  season: number,
  credentialsInput: MappingCredentialsInput = {}
): Promise<string | null> {
  const credentials = normalizeMappingCredentials(credentialsInput);
  try {
    if (request.provider === 'tvdb') {
      const json = await tvdbGet(`/series/${encodeURIComponent(request.id)}/extended?short=true`, credentials);
      const name = seasonName(json?.data?.seasons, season);
      return name || null;
    }
    if (request.provider === 'tmdb' || request.provider === 'imdb') {
      const tmdbKey = tmdbKeyFor(credentials.tmdbApiKey);
      if (!tmdbKey) return null;
      const tmdbId = request.provider === 'tmdb' ? request.id : await getTmdbIdFromImdbId(request.id, tmdbKey, 'tv');
      if (!tmdbId) return null;
      const json = await fetchJson<any>(`${TMDB_API}/tv/${encodeURIComponent(tmdbId)}/season/${season}?api_key=${tmdbKey}`);
      return json?.name || null;
    }
  } catch (error) {
    debug(3, 'Mapping/Live', 'season title lookup failed', { error: (error as any)?.message || String(error) });
    return null;
  }
  return null;
}

function seasonName(seasons: any, season: number): string {
  if (!Array.isArray(seasons)) return '';
  const match = seasons.find((item: any) => Number(item?.number ?? item?.seasonNumber) === season);
  return match?.name || '';
}

/** Official Kitsu MAL id for a TMDB id (replaces the old third-party mapping). */
export async function getKitsuMalIdForTmdb(tmdbId: string, isMovie = false): Promise<string | null> {
  if (!tmdbId) return null;
  const sites = isMovie ? ['themoviedb/movie'] : ['themoviedb/tv', 'themoviedb/movie'];
  for (const site of sites) {
    try {
      const entries = await getKitsuMappings(site, tmdbId);
      for (const entry of entries) {
        const malId = await getKitsuMalId(entry.id);
        if (malId) return malId;
      }
    } catch {
      // try the next official mapping site
    }
  }
  return null;
}

export async function getKitsuMalId(kitsuId: string): Promise<string | null> {
  return cached(`kitsu:mal:${kitsuId}`, async () => {
    const json = await fetchJson<any>(`${KITSU_API}/anime/${encodeURIComponent(kitsuId)}/mappings?page[limit]=20`);
    for (const mapping of Array.isArray(json?.data) ? json.data : []) {
      if (mapping?.attributes?.externalSite === 'myanimelist/anime') {
        return mapping?.attributes?.externalId ? String(mapping.attributes.externalId) : null;
      }
    }
    return null;
  });
}

/**
 * Optional runtime fallback. Returns null when official sources cannot align
 * the request; providers then keep their existing title-search fallback.
 */
export async function resolveLiveTarget(
  request: MappingRequest,
  credentialsInput: MappingCredentialsInput = {}
): Promise<MappingTarget | null> {
  const credentials = normalizeMappingCredentials(credentialsInput);
  debug(3, 'Mapping/Live', 'start', request);
  try {
    if (request.provider === 'kitsu') {
      const anime = await fetchKitsuAnime(request.id);
      return {
        kitsuId: request.id,
        kitsuEpisode: request.episode ?? 1,
        title: anime?.title || '',
        displaySeason: null,
        source: 'live',
      };
    }
    if (request.provider === 'mal') return null;
    if (request.isMovie || request.episode === null) return resolveLiveMovie(request, credentials);
    return resolveLiveSeries(request, credentials);
  } catch (error) {
    debug(3, 'Mapping/Live', 'failed', { error: (error as any)?.message || String(error) });
    return null;
  }
}
