#!/usr/bin/env node
/**
 * Builds src/mapping/data/anime-seasons.json using official APIs only:
 * Kitsu mapping/resources, TVDB v4 (aired/default order) and TMDB.
 *
 * Usage:
 *   node scripts/build-anime-mapping.mjs [--limit=N] [--check]
 *
 * Requires TMDB_API_KEY and TVDB_API_KEY in the environment for a full build.
 * Raw API responses are cached under .cache/anime-mapping/ (gitignored).
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
const cacheDir = path.join(root, '.cache', 'anime-mapping');

const KITSU = 'https://kitsu.io/api/edge';
const TMDB = 'https://api.themoviedb.org/3';
const TVDB = 'https://api4.thetvdb.com/v4';
const SCHEMA_VERSION = 1;

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : Infinity;

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
          fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(file, JSON.stringify(value));
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

async function runPool(items, concurrency, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
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
  const index = readJson(dataFile);
  const errors = validateIndex(index);
  if (errors.length > 0) {
    console.error('X ' + dataFile);
    for (const error of errors) console.error('  - ' + error);
    process.exit(1);
  }
  const seriesCount = Object.keys(index.series).length;
  const movieCount = Object.keys(index.movies).length;
  if (seriesCount === 0 && movieCount === 0) {
    console.warn('! mapping index is EMPTY (' + dataFile + ').');
    console.warn('  Only live official resolution works; multi-season/split-cour needs a built index.');
    console.warn('  Set TMDB_API_KEY and TVDB_API_KEY then run: pnpm mapping:build');
    process.exit(0);
  }
  console.log('OK mapping index valid (' + seriesCount + ' series, ' + movieCount + ' movies)');
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

async function getKitsuAnime(id) {
  const json = await fetchJson(`${KITSU}/anime/${id}`);
  return kitsuEntry(json?.data);
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

async function* kitsuMappingsPage(externalSite, pageLimit = 20) {
  let offset = 0;
  while (offset < limit * pageLimit || limit === Infinity) {
    const url =
      `${KITSU}/mappings?filter[externalSite]=${encodeURIComponent(externalSite)}` +
      `&page[limit]=${pageLimit}&page[offset]=${offset}&include=item`;
    const json = await fetchJson(url);
    const data = Array.isArray(json?.data) ? json.data : [];
    if (data.length === 0) return;
    const included = new Map();
    for (const resource of json?.included || []) {
      const entry = kitsuEntry(resource);
      if (entry) included.set(entry.id, entry);
    }
    for (const mapping of data) {
      const tvdbId = mapping?.attributes?.externalId;
      const itemId = mapping?.relationships?.item?.data?.id;
      if (!tvdbId || !itemId) continue;
      yield { externalId: String(tvdbId), itemId: String(itemId), included: included.get(String(itemId)) || null };
    }
    if (data.length < pageLimit) return;
    offset += pageLimit;
  }
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

async function findTmdbTv(tvdbId) {
  const json = await fetchJson(`${TMDB}/find/${tvdbId}?api_key=${tmdbKey}&external_source=tvdb_id`);
  return json?.tv_results?.[0] || null;
}

async function getTmdbTvDetails(tmdbId) {
  return fetchJson(`${TMDB}/tv/${tmdbId}?api_key=${tmdbKey}&append_to_response=external_ids`);
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
  const tvdbId = seed.externalId;
  const tvdbSeries = await getTvdbSeries(tvdbId);
  if (!tvdbSeries) return null;

  const seedAnime = seed.included || (await getKitsuAnime(seed.itemId));
  if (!seedAnime) return null;

  const entries = await collectEntries(seedAnime);
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
    movies: {},
  };
  mergeSeries(result.series, `tvdb:${tvdbId}`, result.title, tvdbRanges);

  // IMDb key via TMDB external ids.
  const tmdbTv = await findTmdbTv(tvdbId);
  if (!tmdbTv?.id) return result;

  const tmdbDetails = await getTmdbTvDetails(tmdbTv.id);
  const imdbId = tmdbDetails?.external_ids?.imdb_id || null;
  if (imdbId) mergeSeries(result.series, `imdb:${imdbId}`, result.title, tvdbRanges);

  // TMDB key: match TMDB episodes to TVDB episodes by air date (±1 day).
  const tmdbEpisodes = [];
  for (const seasonInfo of tmdbDetails?.seasons || []) {
    if (!seasonInfo?.season_number && seasonInfo?.season_number !== 0) continue;
    if (Number(seasonInfo.season_number) === 0) continue;
    let seasonJson;
    try {
      seasonJson = await getTmdbSeason(tmdbTv.id, seasonInfo.season_number);
    } catch {
      continue;
    }
    for (const episode of seasonJson?.episodes || []) {
      tmdbEpisodes.push({
        season: Number(episode.season_number),
        number: Number(episode.episode_number),
        aired: episode.air_date || null,
      });
    }
  }

  const tmdbEntries = alignTmdbEpisodes([...assignment.values()], tmdbEpisodes);
  if (tmdbEntries.length > 0) {
    mergeSeries(result.series, `tmdb:${tmdbTv.id}`, result.title, rangesFrom(tmdbEntries));
  }

  // Movies found while traversing split-cour relationships.
  for (const entry of entries.filter((item) => item.subtype === 'movie')) {
    const mappings = await fetchJson(`${KITSU}/anime/${entry.id}/mappings`);
    for (const mapping of mappings?.data || []) {
      const site = mapping?.attributes?.externalSite;
      const externalId = mapping?.attributes?.externalId;
      if (!externalId) continue;
      if (site === 'themoviedb/movie') result.movies[`tmdb:${externalId}`] = { kitsuId: entry.id, title: entry.title };
      if (site === 'imdb/movie') result.movies[`imdb:${externalId}`] = { kitsuId: entry.id, title: entry.title };
    }
  }

  return result;
}

async function main() {
  const index = {
    version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    series: {},
    movies: {},
  };

  const seriesSeeds = [];
  for await (const seed of kitsuMappingsPage('thetvdb/series')) {
    if (seriesSeeds.length >= limit) break;
    seriesSeeds.push(seed);
  }
  console.log(`Kitsu TVDB series seeds: ${seriesSeeds.length}${limit === Infinity ? '' : ` (limit ${limit})`}`);

  const seriesResults = await runPool(seriesSeeds, 4, async (seed) => {
    try {
      return await buildSeriesSeed(seed);
    } catch (error) {
      console.error(`  ! series seed ${seed.externalId}: ${error.message}`);
      return null;
    }
  });
  for (const result of seriesResults) {
    if (!result) continue;
    for (const [key, value] of Object.entries(result.series)) mergeSeries(index.series, key, value.title, value.seasons);
    Object.assign(index.movies, result.movies);
  }

  // Kitsu has no TMDB/IMDb movie mappings. Movies are resolved live at request
  // time via TMDB/IMDb + Kitsu search (see src/mapping/live.ts).
  applyOverrides(index, readJson(overridesFile));
  const errors = validateIndex(index);
  if (errors.length > 0) {
    console.error('✗ Generated index is invalid; existing data was not overwritten.');
    for (const error of errors.slice(0, 50)) console.error(`  - ${error}`);
    process.exit(1);
  }

  writeJsonAtomic(dataFile, index);
  console.log(`✓ wrote ${dataFile}`);
  console.log(`  series: ${Object.keys(index.series).length}, movies: ${Object.keys(index.movies).length}`);
}

if (isDirectRun) {
  main().catch((error) => {
    console.error('✗ mapping build failed:', error.message);
    process.exit(1);
  });
}
