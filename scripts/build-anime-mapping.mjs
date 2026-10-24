#!/usr/bin/env node
/**
 * Builds the anime mapping index incrementally from a local Jikan instance:
 * Jikan catalog (MAL) -> Kitsu id (official myanimelist/anime mapping) ->
 * TMDB (title + year) -> IMDb/TVDB ids -> TVDB episode order.
 *
 * Usage:
 *   node scripts/build-anime-mapping.mjs [--limit=N] [--type=tv|movie] [--publish]
 *                                        [--status] [--reset] [--retry-error] [--check]
 *
 * Each run converts the next N catalog entries (default 200) and merges them
 * into the existing index, so the map grows a little at a time.
 *
 * Env: JIKAN_API_BASE      Jikan v4 base (default http://jikan_rest:8080/v4)
 *      TMDB_API_KEY        required
 *      TVDB_API_KEY        required for series (TVDB_PIN optional)
 *      ANIME_MAPPING_FILE  output index (default src/mapping/data/anime-seasons.json)
 *      ANIME_MAPPING_STATE progress ledger (default data/jikan-progress.json)
 *      GITHUB_TOKEN        only for --publish (contents: write)
 *      GITHUB_REPO         default Dexxtex/HanX
 *      GITHUB_MAPPING_TAG  release used as asset store (default mapping)
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isDirectRun = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const dataFile = path.join(root, 'src', 'mapping', 'data', 'anime-seasons.json');
const overridesFile = path.join(root, 'src', 'mapping', 'overrides.json');

const KITSU = 'https://kitsu.io/api/edge';
const TMDB = 'https://api.themoviedb.org/3';
const TVDB = 'https://api4.thetvdb.com/v4';
const JIKAN_API = String(process.env.JIKAN_API_BASE || 'http://jikan_rest:8080/v4').replace(/\/+$/, '');
const SCHEMA_VERSION = 1;
const JIKAN_PAGE_SIZE = 25;

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const statusOnly = args.includes('--status');
const reset = args.includes('--reset');
const retryError = args.includes('--retry-error');
const publish = args.includes('--publish');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const parsedLimit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : 200;
// 0 (o un valore non numerico) significa "tutto il catalogo in un colpo".
const limit = parsedLimit > 0 ? parsedLimit : Infinity;
const requestedType = (args.find((arg) => arg.startsWith('--type=')) || '').split('=')[1];
// Senza --type si parte dalle serie TV e poi i film; il cursore è per tipo.
const catalogTypes = requestedType === 'tv' || requestedType === 'movie' ? [requestedType] : ['tv', 'movie'];

const outputFile = process.env.ANIME_MAPPING_FILE
  ? path.resolve(process.env.ANIME_MAPPING_FILE)
  : dataFile;
const stateFile = process.env.ANIME_MAPPING_STATE
  ? path.resolve(process.env.ANIME_MAPPING_STATE)
  : path.join(root, 'data', 'jikan-progress.json');
// Next to the ledger: /app/.cache is not writable in the container.
const cacheDir = path.join(path.dirname(stateFile), '.cache', 'anime-mapping');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function cachePath(url, init) {
  const hash = createHash('sha256').update(`${init?.method || 'GET'} ${url} ${init?.body || ''}`).digest('hex');
  return path.join(cacheDir, `${hash}.json`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, init, useCache = true) {
  const file = cachePath(url, init);
  if (useCache) {
    const cachedValue = readJson(file);
    if (cachedValue) return cachedValue;
  }
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    let waitMs = 300 * 2 ** attempt;
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          // Kitsu parla JSON:API e risponde 406 a "application/json".
          accept: new URL(url).host.endsWith('kitsu.io') ? 'application/vnd.api+json' : 'application/json',
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
          ...(init?.headers || {}),
        },
      });
      if (response.ok) {
        const value = await response.json();
        if (useCache) {
          // A read-only cache dir must not break the build.
          try {
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(file, JSON.stringify(value));
          } catch {
            // ignore
          }
        }
        return value;
      }
      lastError = new Error(`HTTP ${response.status} for ${new URL(url).host}${new URL(url).pathname}`);
      if (response.status !== 429 && response.status < 500) throw lastError;
      const retryAfter = Number.parseInt(response.headers?.get?.('retry-after') || '', 10);
      if (Number.isFinite(retryAfter)) waitMs = retryAfter * 1000;
    } catch (error) {
      if (error === lastError) throw error; // non-retryable HTTP status
      lastError = error; // network/parse error: retry
    }
    if (attempt < 3) await sleep(waitMs);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function validateIndex(index) {
  const errors = [];
  if (!index || index.version !== SCHEMA_VERSION) errors.push(`unsupported schema version: ${index?.version}`);
  if (!index?.series || typeof index.series !== 'object') errors.push('series must be an object');
  if (!index?.movies || typeof index.movies !== 'object') errors.push('movies must be an object');

  for (const [key, entry] of Object.entries(index?.series || {})) {
    if (!/^(imdb|tmdb|tvdb|mal):.+/.test(key)) errors.push(`invalid series key: ${key}`);
    if (!entry?.seasons || typeof entry.seasons !== 'object') {
      errors.push(`series ${key} has no seasons`);
      continue;
    }
    for (const [season, ranges] of Object.entries(entry.seasons)) {
      if (!Array.isArray(ranges) || ranges.length === 0) {
        errors.push(`series ${key} season ${season} has no ranges`);
        continue;
      }
      const sorted = [...ranges].sort((a, b) => a.from - b.from);
      let previous = -1;
      for (const range of sorted) {
        if (!Number.isFinite(range.from) || range.from < 1) errors.push(`series ${key} season ${season} invalid from`);
        if (!/^\d+$/.test(String(range.kitsuId || ''))) errors.push(`series ${key} season ${season} invalid kitsuId`);
        if (!Number.isFinite(range.offset)) errors.push(`series ${key} season ${season} invalid offset`);
        if (range.title !== undefined && typeof range.title !== 'string') errors.push(`series ${key} season ${season} invalid title`);
        if (range.episodeCount !== undefined && range.episodeCount !== null && !(Number.isFinite(range.episodeCount) && range.episodeCount > 0)) {
          errors.push(`series ${key} season ${season} invalid episodeCount`);
        }
        if (range.from <= previous) errors.push(`series ${key} season ${season} duplicate/overlapping from ${range.from}`);
        previous = range.from;
      }
    }
  }

  for (const [key, entry] of Object.entries(index?.movies || {})) {
    if (!/^(imdb|tmdb):.+/.test(key)) errors.push(`invalid movie key: ${key}`);
    if (!/^\d+$/.test(String(entry?.kitsuId || ''))) errors.push(`movie ${key} invalid kitsuId`);
  }
  return errors;
}

function applyOverrides(index, overrides) {
  if (!overrides || typeof overrides !== 'object') return index;
  for (const [key, entry] of Object.entries(overrides.series || {})) {
    if (entry && typeof entry === 'object') index.series[key] = entry;
  }
  for (const [key, entry] of Object.entries(overrides.movies || {})) {
    if (entry && typeof entry === 'object') index.movies[key] = entry;
  }
  return index;
}

if (isDirectRun && checkOnly) {
  const index = readJson(outputFile);
  const errors = validateIndex(index);
  if (errors.length > 0) {
    console.error('X ' + outputFile);
    for (const error of errors) console.error('  - ' + error);
    process.exit(1);
  }
  const seriesCount = Object.keys(index.series).length;
  const movieCount = Object.keys(index.movies).length;
  if (seriesCount === 0 && movieCount === 0) {
    console.warn('! mapping index is EMPTY (' + outputFile + ').');
    console.warn('  Only live official resolution works; multi-season/split-cour needs a built index.');
    console.warn('  Run: docker exec HanX node scripts/build-anime-mapping.mjs --limit=200');
    process.exit(0);
  }
  console.log('OK mapping index valid (' + seriesCount + ' series, ' + movieCount + ' movies)');
  process.exit(0);
}

if (isDirectRun && statusOnly) {
  const state = readJson(stateFile) || {};
  state.cursor = state.cursor || {};
  for (const type of ['tv', 'movie']) {
    const total = await jikanTotal(type);
    const cursor = state.cursor[type];
    const consumed = cursor ? (cursor.page - 1) * JIKAN_PAGE_SIZE + cursor.pos : 0;
    const pct = total > 0 ? Math.min(100, Math.round((consumed / total) * 100)) : 0;
    console.log(`${type.padEnd(6)} ${consumed}/${total} (${pct}%)`);
  }
  const records = Object.values(state.done || {});
  const byStatus = {};
  for (const record of records) byStatus[record?.status || '?'] = (byStatus[record?.status || '?'] || 0) + 1;
  console.log(`registro: ${records.length} entry (${Object.entries(byStatus).map(([s, c]) => `${s} ${c}`).join(', ') || 'vuoto'})`);
  process.exit(0);
}

const tmdbKey = String(process.env.TMDB_API_KEY || '').trim();
const tvdbKey = String(process.env.TVDB_API_KEY || '').trim();
const tvdbPin = String(process.env.TVDB_PIN || '').trim();

if (isDirectRun && (!tmdbKey || !tvdbKey)) {
  console.error('✗ Missing TMDB_API_KEY and/or TVDB_API_KEY.');
  console.error('  Set both environment variables, then rerun: pnpm mapping:build');
  console.error('  Existing mapping data was not modified.');
  process.exit(1);
}

let tvdbToken = null;
async function getTvdbToken(force = false) {
  if (tvdbToken && !force) return tvdbToken;
  const body = { apikey: tvdbKey, ...(tvdbPin ? { pin: tvdbPin } : {}) };
  const json = await fetchJson(`${TVDB}/login`, { method: 'POST', body: JSON.stringify(body) }, false);
  tvdbToken = json?.data?.token || null;
  if (!tvdbToken) throw new Error('TVDB login failed: no token');
  return tvdbToken;
}

async function tvdbGet(pathname) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getTvdbToken(attempt > 0);
    try {
      return await fetchJson(`${TVDB}${pathname}`, { headers: { authorization: `Bearer ${token}` } });
    } catch (error) {
      // Expired token: log in again once.
      if (attempt === 0 && /\b(401|403)\b/.test(String(error?.message || ''))) continue;
      throw error;
    }
  }
  return null;
}

function kitsuEntry(resource) {
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

export async function getKitsuRelations(id) {
  const json = await fetchJson(`${KITSU}/anime/${id}?include=mediaRelationships.destination`);
  const entry = kitsuEntry(json?.data);
  const relatedIds = [];
  for (const resource of json?.included || []) {
    if (resource?.type !== 'mediaRelationships') continue;
    const role = resource?.attributes?.role;
    // Both directions: a later-season seed must still reach earlier parts.
    if (role !== 'sequel' && role !== 'prequel') continue;
    const destinationId = resource?.relationships?.destination?.data?.id;
    if (destinationId) relatedIds.push(String(destinationId));
  }
  return { entry, relatedIds };
}

async function collectEntries(seed) {
  const byId = new Map();
  const queue = [seed.id];
  const visited = new Set();
  while (queue.length > 0 && visited.size < 80) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const { entry, relatedIds } = await getKitsuRelations(id);
    if (entry) byId.set(entry.id, entry);
    for (const relatedId of relatedIds) if (!visited.has(relatedId)) queue.push(relatedId);
  }
  return [...byId.values()].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}

function jikanPageUrl(type, page) {
  return `${JIKAN_API}/anime?order_by=mal_id&sort=asc&type=${type}&page=${page}&limit=${JIKAN_PAGE_SIZE}`;
}

async function jikanPage(type, page) {
  const json = await fetchJson(jikanPageUrl(type, page), {}, false);
  return Array.isArray(json?.data) ? json.data : [];
}

async function jikanTotal(type) {
  const json = await fetchJson(`${JIKAN_API}/anime?order_by=mal_id&sort=asc&type=${type}&page=1&limit=1`, {}, false);
  return Number(json?.pagination?.items?.total) || 0;
}

/** Kitsu official myanimelist/anime mapping: one request per MAL id. */
async function kitsuIdForMal(malId) {
  const url =
    `${KITSU}/mappings?filter[externalSite]=myanimelist%2Fanime` +
    `&filter[externalId]=${encodeURIComponent(malId)}&include=item&page[limit]=1`;
  const json = await fetchJson(url);
  const id = json?.data?.[0]?.relationships?.item?.data?.id;
  return id ? String(id) : null;
}

function yearOf(value) {
  const year = Number.parseInt(String(value || '').slice(0, 4), 10);
  return Number.isFinite(year) && year > 1900 ? year : null;
}

/** TMDB search terms for a Jikan catalog entry (MAL titles are Japanese-first). */
export function tmdbQuery(entry) {
  const kind = String(entry?.type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
  // Romaji come secondo tentativo: sui titoli senza title_english è l'unica chiave.
  const queries = [...new Set([entry?.title_english, entry?.title].map((value) => String(value || '').trim()).filter(Boolean))];
  return {
    kind,
    queries,
    year: yearOf(entry?.aired?.from),
  };
}

/**
 * First Japanese result within one year of the MAL start date. Taking the
 * top hit without these two filters picks live-action remakes and OVAs.
 */
export function pickTmdbResult(results, year) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const japanese = results.filter((item) => item?.original_language === 'ja');
  const pool = japanese.length > 0 ? japanese : results;
  if (!year) return pool[0] || null;
  return (
    pool.find((item) => {
      const resultYear = yearOf(item.first_air_date || item.release_date);
      return resultYear !== null && Math.abs(resultYear - year) <= 1;
    }) || null
  );
}

async function findTmdb({ kind, queries, year }) {
  if (!queries || queries.length === 0) return null;
  const path = kind === 'movie' ? 'search/movie' : 'search/tv';
  const search = async (query, withYear) => {
    const params = new URLSearchParams({ query, api_key: tmdbKey });
    if (withYear && year) params.set(kind === 'movie' ? 'year' : 'first_air_date_year', String(year));
    const json = await fetchJson(`${TMDB}/${path}?${params}`);
    return pickTmdbResult(json?.results, withYear ? year : null);
  };
  for (const query of queries) {
    // A wrong/unknown MAL start year would hide a real match, so retry bare once.
    const hit = (await search(query, true)) || (year ? await search(query, false) : null);
    if (hit) return hit;
  }
  return null;
}

async function tmdbExternalIds(kind, id) {
  return await fetchJson(`${TMDB}/${kind}/${id}/external_ids?api_key=${encodeURIComponent(tmdbKey)}`);
}

/** Converts one catalog entry into index keys; returns the ledger record. */
async function convertCatalogEntry(entry, index) {
  const at = new Date().toISOString().slice(0, 10);
  const title = String(entry?.title_english || entry?.title || '');

  const kitsuId = await kitsuIdForMal(entry.mal_id);
  if (!kitsuId) return { at, status: 'no-kitsu' };

  const query = tmdbQuery(entry);
  const tmdb = await findTmdb(query);
  if (!tmdb?.id) return { at, status: 'no-tmdb', kitsuId };

  const external = await tmdbExternalIds(query.kind, tmdb.id);
  const imdbId = external?.imdb_id || '';
  const record = { at, kitsuId, tmdbId: String(tmdb.id), tmdbTitle: tmdb.name || tmdb.title || '' };

  if (query.kind === 'movie') {
    index.movies[`tmdb:${tmdb.id}`] = { kitsuId, title };
    if (imdbId) index.movies[`imdb:${imdbId}`] = { kitsuId, title };
    return { ...record, status: 'ok' };
  }

  // TMDB gives the TVDB id for series; when it is missing we still align on
  // TMDB episodes, so the entry does not fall out of the dataset.
  const tvdbId = external?.tvdb_id ? String(external.tvdb_id) : '';
  // Split-cour entries share the same series: the first one already mapped it.
  if ((tvdbId && index.series[`tvdb:${tvdbId}`]) || index.series[`tmdb:${tmdb.id}`]) {
    return { ...record, status: 'already' };
  }

  const result =
    (tvdbId ? await buildSeriesSeed({ kitsuId, tvdbId, tmdbId: String(tmdb.id) }) : null) ||
    (await buildSeriesSeedFromTmdb({ kitsuId, tmdbId: String(tmdb.id) }));
  if (!result) return { ...record, status: 'no-align' };
  for (const [key, value] of Object.entries(result.series)) {
    mergeSeries(index.series, key, value.title, value.seasons);
  }
  const viaTvdb = Object.keys(result.series).some((key) => key.startsWith('tvdb:'));
  return { ...record, status: 'ok', via: viaTvdb ? 'tvdb' : 'tmdb' };
}

async function getTvdbSeries(tvdbId) {
  const json = await tvdbGet(`/series/${tvdbId}/extended?short=true`);
  return json?.data || null;
}

async function getTvdbEpisodes(tvdbId) {
  const episodes = [];
  const seen = new Set();
  for (let page = 0; page < 50; page++) {
    const json = await tvdbGet(`/series/${tvdbId}/episodes/default?page=${page}`);
    const batch = json?.data?.episodes || [];
    let added = 0;
    for (const episode of batch) {
      const season = Number(episode.seasonNumber);
      const number = Number(episode.number);
      const key = `${season}:${number}`;
      if (!Number.isFinite(season) || !Number.isFinite(number) || seen.has(key)) continue;
      seen.add(key);
      added += 1;
      episodes.push({
        season,
        number,
        aired: episode.aired || null,
      });
    }
    if (batch.length === 0) break;
    if (!json?.links?.next && added === 0) break;
  }
  return episodes;
}

async function getTmdbTvDetails(tmdbId) {
  return fetchJson(`${TMDB}/tv/${tmdbId}?api_key=${tmdbKey}&append_to_response=external_ids`);
}

async function getTmdbEpisodes(tmdbId, details) {
  const episodes = [];
  for (const seasonInfo of details?.seasons || []) {
    if (!seasonInfo?.season_number && seasonInfo?.season_number !== 0) continue;
    if (Number(seasonInfo.season_number) === 0) continue;
    let seasonJson;
    try {
      seasonJson = await getTmdbSeason(tmdbId, seasonInfo.season_number);
    } catch {
      continue;
    }
    for (const episode of seasonJson?.episodes || []) {
      episodes.push({
        season: Number(episode.season_number),
        number: Number(episode.episode_number),
        aired: episode.air_date || null,
      });
    }
  }
  return episodes;
}

async function getTmdbSeason(tmdbId, seasonNumber) {
  return fetchJson(`${TMDB}/tv/${tmdbId}/season/${seasonNumber}?api_key=${tmdbKey}`);
}

function day(value) {
  if (!value) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

function daysClose(a, b) {
  return a !== null && b !== null && Math.abs(a - b) <= 1;
}

/**
 * Assign every TVDB episode to a Kitsu entry by air date, then walk seasons in
 * aired order and emit step ranges ({from, kitsuId, offset}).
 * Movies are never aligned as series episodes.
 */
export function alignEntries(episodes, entries) {
  const dated = entries.filter((entry) => entry.startDate && entry.subtype !== 'movie');
  const assignment = new Map();
  const kitsuCounters = new Map();
  const ordered = [...episodes].sort((a, b) => {
    const dayA = day(a.aired) ?? 0;
    const dayB = day(b.aired) ?? 0;
    if (dayA !== dayB) return dayA - dayB;
    if (a.season !== b.season) return a.season - b.season;
    return a.number - b.number;
  });

  for (const episode of ordered) {
    const airedDay = day(episode.aired);
    let chosen = null;
    if (airedDay !== null) {
      // Pick the latest entry that has started and still has episode capacity.
      // This is what advances from a finished cour to its sequel.
      const candidates = dated.filter((entry) => {
        const startDay = day(entry.startDate);
        return startDay !== null && startDay <= airedDay + 1;
      });
      for (const entry of candidates) {
        const next = (kitsuCounters.get(entry.id) || 0) + 1;
        if (Number.isFinite(entry.episodeCount) && next > Number(entry.episodeCount)) continue;
        chosen = entry;
      }
    }
    if (!chosen) continue;
    const next = (kitsuCounters.get(chosen.id) || 0) + 1;
    kitsuCounters.set(chosen.id, next);
    assignment.set(`${episode.season}:${episode.number}`, {
      episode,
      kitsuId: chosen.id,
      kitsuEpisode: next,
      title: chosen.title,
      episodeCount: chosen.episodeCount ?? null,
    });
  }
  return assignment;
}

/**
 * One-to-one TVDB -> TMDB episode matching by air date. A single TMDB episode
 * can never be used twice (double air dates used to create duplicate `from`).
 */
export function alignTmdbEpisodes(assignments, tmdbEpisodes) {
  const used = new Set();
  const result = [];
  const ordered = [...assignments].sort((a, b) => {
    const dayA = day(a.episode.aired) ?? 0;
    const dayB = day(b.episode.aired) ?? 0;
    if (dayA !== dayB) return dayA - dayB;
    return (a.episode.season - b.episode.season) || (a.episode.number - b.episode.number);
  });
  for (const item of ordered) {
    const tvdbDay = day(item.episode.aired);
    const match = tmdbEpisodes.find(
      (episode, index) => !used.has(index) && daysClose(tvdbDay, day(episode.aired))
    );
    if (!match) continue;
    used.add(tmdbEpisodes.indexOf(match));
    result.push({
      season: match.season,
      episode: match.number,
      kitsuId: item.kitsuId,
      kitsuEpisode: item.kitsuEpisode,
      title: item.title,
      episodeCount: item.episodeCount ?? null,
    });
  }
  return result;
}

export function rangesFrom(entries) {
  // entries: [{ season, episode, kitsuId, kitsuEpisode, title?, episodeCount? }]
  const bySeason = new Map();
  const sorted = [...entries].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  for (const item of sorted) {
    if (!bySeason.has(item.season)) bySeason.set(item.season, []);
    bySeason.get(item.season).push(item);
  }
  const seasons = {};
  for (const [season, items] of bySeason) {
    const ranges = [];
    let lastKey = null;
    let lastFrom = 0;
    for (const item of items) {
      // Duplicate `from` (double air dates, imperfect matching) must not abort
      // the build: keep the first range only.
      if (item.episode <= lastFrom) continue;
      const offset = item.episode - item.kitsuEpisode;
      const key = `${item.kitsuId}:${offset}`;
      lastFrom = item.episode;
      if (key === lastKey) continue;
      const range = { from: item.episode, kitsuId: item.kitsuId, offset };
      if (item.title) range.title = item.title;
      if (Number.isFinite(item.episodeCount)) range.episodeCount = item.episodeCount;
      ranges.push(range);
      lastKey = key;
    }
    seasons[String(season)] = ranges;
  }
  return seasons;
}

function mergeSeries(target, key, title, seasons) {
  if (!target[key]) target[key] = { title, seasons: {} };
  if (!target[key].title && title) target[key].title = title;
  for (const [season, ranges] of Object.entries(seasons)) {
    target[key].seasons[season] = ranges;
  }
}

async function buildSeriesSeed(seed) {
  const tvdbId = seed.tvdbId;
  const tvdbSeries = await getTvdbSeries(tvdbId);
  if (!tvdbSeries) return null;

  // collectEntries fetches the seed entry itself, so no separate lookup.
  const entries = await collectEntries({ id: seed.kitsuId });
  if (entries.length === 0) return null;
  const tvdbEpisodes = await getTvdbEpisodes(tvdbId);
  if (tvdbEpisodes.length === 0) return null;
  const assignment = alignEntries(tvdbEpisodes, entries);
  if (assignment.size === 0) return null;

  const tvdbRanges = rangesFrom([...assignment.values()].map(({ episode, kitsuId, kitsuEpisode, title, episodeCount }) => ({
    season: episode.season,
    episode: episode.number,
    kitsuId,
    kitsuEpisode,
    title,
    episodeCount,
  })));

  const result = {
    title: tvdbSeries.name || entries[0]?.title || '',
    series: {},
  };
  mergeSeries(result.series, `tvdb:${tvdbId}`, result.title, tvdbRanges);

  // IMDb key via TMDB external ids (TMDB already gave us the id).
  const tmdbTv = { id: seed.tmdbId };
  if (!tmdbTv?.id) return result;

  const tmdbDetails = await getTmdbTvDetails(tmdbTv.id);
  const imdbId = tmdbDetails?.external_ids?.imdb_id || null;
  if (imdbId) mergeSeries(result.series, `imdb:${imdbId}`, result.title, tvdbRanges);

  // TMDB key: match TMDB episodes to TVDB episodes by air date (±1 day).
  const tmdbEpisodes = await getTmdbEpisodes(tmdbTv.id, tmdbDetails);

  const tmdbEntries = alignTmdbEpisodes([...assignment.values()], tmdbEpisodes);
  if (tmdbEntries.length > 0) {
    mergeSeries(result.series, `tmdb:${tmdbTv.id}`, result.title, rangesFrom(tmdbEntries));
  }

  return result;
}

/**
 * Fallback for series without a TVDB id (or where TVDB alignment failed):
 * align the Kitsu franchise directly on TMDB episodes, which carry the same
 * season/number/air_date shape.
 */
async function buildSeriesSeedFromTmdb(seed) {
  const entries = await collectEntries({ id: seed.kitsuId });
  if (entries.length === 0) return null;
  const details = await getTmdbTvDetails(seed.tmdbId);
  const episodes = await getTmdbEpisodes(seed.tmdbId, details);
  if (episodes.length === 0) return null;
  const assignment = alignEntries(episodes, entries);
  if (assignment.size === 0) return null;

  const ranges = rangesFrom([...assignment.values()].map(({ episode, kitsuId, kitsuEpisode, title, episodeCount }) => ({
    season: episode.season,
    episode: episode.number,
    kitsuId,
    kitsuEpisode,
    title,
    episodeCount,
  })));

  const result = { title: details?.name || entries[0]?.title || '', series: {} };
  mergeSeries(result.series, `tmdb:${seed.tmdbId}`, result.title, ranges);
  const imdbId = details?.external_ids?.imdb_id || null;
  if (imdbId) mergeSeries(result.series, `imdb:${imdbId}`, result.title, ranges);
  return result;
}

async function main() {
  const existing = reset ? null : readJson(outputFile);
  const index = {
    version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    series: { ...(existing?.series || {}) },
    movies: { ...(existing?.movies || {}) },
  };

  const state = reset ? {} : readJson(stateFile) || {};
  state.done = state.done || {};
  state.cursor = state.cursor || {};
  if (retryError) {
    for (const [malId, record] of Object.entries(state.done)) {
      if (record?.status === 'error') delete state.done[malId];
    }
    // Rewind: the cursor has already moved past the failed entries.
    state.cursor = {};
  }

  const persist = () => {
    index.generatedAt = new Date().toISOString();
    writeJsonAtomic(outputFile, index);
    writeJsonAtomic(stateFile, state);
  };

  const stats = {};
  let processed = 0;

  outer: for (const type of catalogTypes) {
    const cursor = state.cursor[type] || { page: 1, pos: 0 };
    state.cursor[type] = cursor;
    const total = await jikanTotal(type);
    console.log(`  ${type}: ${total} entry nel catalogo`);
    for (;;) {
      const entries = await jikanPage(type, cursor.page);
      if (entries.length === 0) {
        // Riavvolgi di una pagina: le entry nuove riempiono l'ultima pagina
        // parziale, che altrimenti resterebbe dietro al cursore. `done` le salta.
        cursor.page = Math.max(1, cursor.page - 1);
        cursor.pos = 0;
        console.log(`  catalogo ${type} completato (riparte da pagina ${cursor.page})`);
        break;
      }
      for (; cursor.pos < entries.length; cursor.pos += 1) {
        if (processed >= limit) break outer;
        const entry = entries[cursor.pos];
        const malId = String(entry?.mal_id || '');
        if (!malId || state.done[malId]) continue;
        processed += 1;
        try {
          const record = await convertCatalogEntry(entry, index);
          state.done[malId] = record;
          stats[record.status] = (stats[record.status] || 0) + 1;
          if (record.status !== 'ok' && record.status !== 'already') {
            console.log(`  · ${type} ${malId} ${entry.title || ''} -> ${record.status}`);
          }
        } catch (error) {
          state.done[malId] = { at: new Date().toISOString().slice(0, 10), status: 'error', error: error.message };
          stats.error = (stats.error || 0) + 1;
          console.error(`  ! ${type} ${malId}: ${error.message}`);
        }
        // Il file indice cresce (MB): salvare ogni 100 entry, non ogni 25.
        if (processed % 100 === 0) {
          persist();
          const consumed = (cursor.page - 1) * JIKAN_PAGE_SIZE + cursor.pos;
          console.log(`  … ${type} ${consumed}/${total}`);
        }
      }
      cursor.page += 1;
      cursor.pos = 0;
    }
  }

  applyOverrides(index, readJson(overridesFile));
  const errors = validateIndex(index);
  if (errors.length > 0) {
    console.error('✗ Indice non valido (batch scritto comunque nel file).');
    for (const error of errors.slice(0, 50)) console.error(`  - ${error}`);
    process.exit(1);
  }

  persist();
  const summary = Object.entries(stats).map(([status, count]) => `${status} ${count}`).join(', ') || 'nessuna';
  console.log(`✓ ${outputFile}`);
  console.log(`  serie: ${Object.keys(index.series).length}, film: ${Object.keys(index.movies).length}`);
  console.log(`  batch: ${processed} entry (${summary})`);
  console.log(
    `  cursore: tv ${state.cursor.tv?.page ?? 1}:${state.cursor.tv?.pos ?? 0}, movie ${state.cursor.movie?.page ?? 1}:${state.cursor.movie?.pos ?? 0}`,
  );

  if (publish) await publishIndex();
}

const GH_TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const GH_REPO = String(process.env.GITHUB_REPO || 'Dexxtex/HanX').trim();
const GH_TAG = String(process.env.GITHUB_MAPPING_TAG || 'mapping').trim();
const GH_ASSET = 'anime-seasons.json';

function ghHeaders(extra = {}) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${GH_TOKEN}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'HanX-mapping',
    ...extra,
  };
}

async function ghApi(url, init = {}) {
  const response = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
    ...init,
    headers: ghHeaders(init.headers),
  });
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} ${url}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

/** Pubblica l'indice come asset della release: URL stabile, nessun bloat git. */
async function publishIndex() {
  if (!GH_TOKEN) throw new Error('--publish richiede GITHUB_TOKEN (contents: write)');
  if (!fs.existsSync(outputFile)) throw new Error(`indice assente: ${outputFile}`);

  let release;
  try {
    release = await ghApi(`/repos/${GH_REPO}/releases/tags/${GH_TAG}`);
  } catch (error) {
    if (!/GitHub 404 /.test(error.message)) throw error;
    release = await ghApi(`/repos/${GH_REPO}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: GH_TAG,
        name: 'Anime mapping',
        body: 'Indice anime-seasons.json generato dal converter Jikan di HanX.',
      }),
    });
  }

  // Un asset si sostituisce solo eliminandolo: l'URL download resta lo stesso.
  for (const asset of release.assets || []) {
    if (asset.name !== GH_ASSET) continue;
    await fetch(`https://api.github.com/repos/${GH_REPO}/releases/assets/${asset.id}`, {
      method: 'DELETE',
      headers: ghHeaders(),
    });
  }

  const body = fs.readFileSync(outputFile);
  const upload = await fetch(
    `https://uploads.github.com/repos/${GH_REPO}/releases/${release.id}/assets?name=${GH_ASSET}`,
    { method: 'POST', headers: ghHeaders({ 'content-type': 'application/json' }), body },
  );
  if (!upload.ok) throw new Error(`upload fallito: HTTP ${upload.status} ${(await upload.text()).slice(0, 200)}`);

  console.log(`  pubblicato: https://github.com/${GH_REPO}/releases/download/${GH_TAG}/${GH_ASSET}`);
}

if (isDirectRun) {
  main().catch((error) => {
    console.error('✗ mapping build failed:', error.message);
    process.exit(1);
  });
}
