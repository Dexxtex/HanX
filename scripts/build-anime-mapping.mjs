#!/usr/bin/env node
/**
 * Builds the anime mapping index incrementally from a local Jikan instance:
 * Jikan catalog (MAL) -> Kitsu id (official myanimelist/anime mapping) ->
 * TMDB (title + year) -> IMDb/TVDB ids -> TVDB episode order.
 *
 * Usage:
 *   node scripts/build-anime-mapping.mjs [--limit=N] [--type=tv|movie|ova|ona|special|tv_special] [--publish]
 *                                        [--status] [--reset] [--retry=status,...] [--check]
 *                                        [--backfill-titles]
 *
 * Each run converts the next N catalog entries (default 200) and merges them
 * into the existing index, so the map grows a little at a time.
 *
 * `--backfill-titles` non aggiunge mapping: riempie i titoli alternativi delle
 * voci già in indice, `titleAlt` (romaji MAL, una chiamata Jikan per kitsuId) e
 * `titleIt` (italiano TMDB, una chiamata per opera). Senza `--publish` scrive
 * solo l'indice locale.
 *
 * Env: JIKAN_API_BASE      Jikan v4 base (default http://jikan_rest:8080/v4)
 *      TMDB_API_KEY        required
 *      TVDB_API_KEY        required for series (TVDB_PIN optional)
 *      ANIME_MAPPING_FILE  output index (default src/mapping/data/anime-seasons.json)
 *      ANIME_MAPPING_STATE progress ledger (default data/jikan-progress.json)
 *      GITHUB_TOKEN        only for --publish (contents: write)
 *      GITHUB_REPO         default Dexxtex/HanX
 *      GITHUB_MAPPING_BRANCH branch used as asset store (default mapping)
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
// Ponte MAL -> TMDB risolto una volta con MDBList: dato statico, così la build
// non ha bisogno della chiave MDBList. Sta in scripts/ perché l'immagine Docker
// copia scripts/ ma non src/: qui il backfill lo trova anche nel container.
const mdblistTmdbFile = path.join(root, 'scripts', 'mdblist-tmdb.json');
// Ponte MAL -> Kitsu per i titoli che il mapping ufficiale di Kitsu non ha ma
// SimKL conosce (via AniDB). Anche questo è un dato statico: la build non
// chiama SimKL e non ha bisogno della chiave.
const simklKitsuFile = path.join(root, 'scripts', 'simkl-kitsu.json');

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
const retryArg = (args.find((arg) => arg.startsWith('--retry=')) || '').split('=')[1];
// --retry=no-tmdb,no-align riapre le entry finite con quegli esiti.
const retryStatuses = retryArg
  ? retryArg.split(',').map((value) => value.trim()).filter(Boolean)
  : retryError
    ? ['error']
    : [];
const publish = args.includes('--publish');
const backfillTitles = args.includes('--backfill-titles');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const parsedLimit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : 200;
// 0 (o un valore non numerico) significa "tutto il catalogo in un colpo".
const limit = parsedLimit > 0 ? parsedLimit : Infinity;
const requestedType = (args.find((arg) => arg.startsWith('--type=')) || '').split('=')[1];
// Senza --type si parte dalle serie TV e poi i film; il cursore è per tipo.
// Le altre tipologie hanno una scheda TMDB/TVDB quanto le serie: senza di loro
// l'indice ignora OVA, ONA e special. Music/CM/PV restano fuori perché TMDB e
// TVDB non catalogano video promozionali.
const CATALOG_TYPES = ['tv', 'movie', 'ova', 'ona', 'special', 'tv_special'];
const catalogTypes =
  requestedType && CATALOG_TYPES.includes(requestedType) ? [requestedType] : CATALOG_TYPES;

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

export function validateIndex(index) {
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
      if (entry.titleIt !== undefined && typeof entry.titleIt !== 'string') errors.push(`series ${key} invalid titleIt`);
      if (!Array.isArray(ranges) || ranges.length === 0) {
        errors.push(`series ${key} season ${season} has no ranges`);
        continue;
      }
      const sorted = [...ranges].sort((a, b) => a.from - b.from);
      let previous = -1;
      for (const range of sorted) {
        if (!Number.isFinite(range.from) || range.from < 1) errors.push(`series ${key} season ${season} invalid from`);
        // Una entry mappata col solo TMDB (film o serie a stagione unica) non ha
        // kitsuId: il runtime cerca per titolo, quindi il titolo è obbligatorio.
        if (range.kitsuId) {
          if (!/^\d+$/.test(String(range.kitsuId))) errors.push(`series ${key} season ${season} invalid kitsuId`);
        } else if (!String(range.title || '').trim()) {
          errors.push(`series ${key} season ${season} range without kitsuId or title`);
        }
        if (!Number.isFinite(range.offset)) errors.push(`series ${key} season ${season} invalid offset`);
        if (range.title !== undefined && typeof range.title !== 'string') errors.push(`series ${key} season ${season} invalid title`);
        if (range.titleAlt !== undefined && typeof range.titleAlt !== 'string') errors.push(`series ${key} season ${season} invalid titleAlt`);
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
    if (entry?.kitsuId) {
      if (!/^\d+$/.test(String(entry.kitsuId))) errors.push(`movie ${key} invalid kitsuId`);
    } else if (!String(entry?.title || '').trim()) {
      errors.push(`movie ${key} without kitsuId or title`);
    }
    if (entry?.titleAlt !== undefined && typeof entry.titleAlt !== 'string') errors.push(`movie ${key} invalid titleAlt`);
    if (entry?.titleIt !== undefined && typeof entry.titleIt !== 'string') errors.push(`movie ${key} invalid titleIt`);
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
  let catalogue = 0;
  for (const type of catalogTypes) {
    const total = await jikanTotal(type);
    catalogue += total;
    const cursor = state.cursor[type];
    const consumed = cursor ? (cursor.page - 1) * JIKAN_PAGE_SIZE + cursor.pos : 0;
    const pct = total > 0 ? Math.min(100, Math.round((consumed / total) * 100)) : 0;
    console.log(`${type.padEnd(6)} cursore ${consumed}/${total} (${pct}%)`);
  }
  const records = Object.values(state.done || {});
  const byStatus = {};
  for (const record of records) byStatus[record?.status || '?'] = (byStatus[record?.status || '?'] || 0) + 1;
  // Il registro è la misura vera: dopo un --retry il cursore riparte da pagina 1.
  const done = catalogue > 0 ? Math.round((records.length / catalogue) * 100) : 0;
  console.log(`registro: ${records.length}/${catalogue} entry (${done}%)`);
  console.log(`  ${Object.entries(byStatus).map(([s, c]) => `${s} ${c}`).join(', ') || 'vuoto'}`);
  process.exit(0);
}

const tmdbKey = String(process.env.TMDB_API_KEY || '').trim();
const tvdbKey = String(process.env.TVDB_API_KEY || '').trim();
const tvdbPin = String(process.env.TVDB_PIN || '').trim();

// SimKL come ponte per gli id esterni: Kitsu spesso non ha il TVDB di una OVA,
// SimKL sì. /redirect e /anime/{id} accettano la sola client_id e stanno in
// cache Cloudflare, quindi non consumano quota.
const simklClientId = String(process.env.SIMKL_CLIENT_ID || '').trim();
const simklIdCache = new Map();

async function simklIds(malId) {
  if (!simklClientId || !malId) return null;
  const key = String(malId);
  if (simklIdCache.has(key)) return simklIdCache.get(key);
  let ids = null;
  try {
    const query = `client_id=${simklClientId}&app-name=HanX&app-version=0.1.0`;
    const headers = { 'User-Agent': 'HanX/0.1.0' };
    const redirect = await fetch(`https://api.simkl.com/redirect?to=simkl&mal=${key}&${query}`, {
      redirect: 'manual',
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const match = (redirect.headers.get('location') || '').match(/\/(movies|tv|anime)\/(\d+)\//);
    if (match) {
      const detail = await fetch(`https://api.simkl.com/${match[1]}/${match[2]}?${query}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (detail.ok) ids = (await detail.json())?.ids || null;
    }
  } catch {
    ids = null;
  }
  simklIdCache.set(key, ids);
  return ids;
}

if (isDirectRun && (!tmdbKey || !tvdbKey) && !backfillTitles) {
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
  const title = titles.en || titles.en_jp || attributes.canonicalTitle || '';
  // Romaji/giapponese di questa entry: per le OVA e le special è l'unico titolo
  // che i siti italiani listano, perché l'inglese di Kitsu spesso non c'è.
  const alt = [titles.en_jp, titles.ja_jp].find((value) => value && value !== title) || '';
  return {
    id: String(resource.id),
    title,
    titleAlt: alt,
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
    let entry;
    let relatedIds;
    try {
      ({ entry, relatedIds } = await getKitsuRelations(id));
    } catch (error) {
      // Entry Kitsu cancellata tra le relazioni: il resto del franchise resta
      // valido. Se è la entry di partenza, il chiamante decide (fallback).
      if (id === String(seed.id)) throw error;
      continue;
    }
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

/** TVDB series id from the Kitsu mappings of an anime (null when absent). */
export function tvdbSeriesIdFromMappings(data) {
  const found = (data || []).find((item) => item?.attributes?.externalSite === 'thetvdb/series');
  return found?.attributes?.externalId ? String(found.attributes.externalId) : null;
}

/** Chiave di confronto: NFKC (ｘ = x, ！ = !), senza spazi né punteggiatura. */
function titleKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * TVDB cercato per nome. Il titolo giapponese è incluso perché molte serie
 * esistono solo così ("Patalliro Saiyuuki!" -> "パタリロ西遊記!").
 */
export function tvdbQueries(entry) {
  const queries = [];
  // Come per TMDB: se MAL non riempie title_english, l'inglese può stare in
  // titles[]. I sinonimi restano fuori, sono troppo sporchi per un match stretto.
  const englishInTitles = (entry?.titles || []).find(
    (item) => String(item?.type || '').toLowerCase() === 'english'
  )?.title;
  for (const value of [entry?.title_english, englishInTitles, entry?.title, entry?.title_japanese]) {
    const title = String(value || '').trim();
    if (title && !queries.includes(title)) queries.push(title);
  }
  return { queries, year: yearOf(entry?.aired?.from) };
}

/**
 * Solo titolo identico (o contenuto nella serie madre) e un candidato unico:
 * TVDB risponde anche a ricerche larghe, e un id sbagliato è peggio di un buco.
 */
export function pickTvdbSeries(results, { queries, year }) {
  const wanted = [...new Set(queries.map(titleKey).filter(Boolean))];
  const items = results || [];
  const nameKey = (item) => titleKey(item?.name);

  const exact = items.filter((item) => wanted.includes(nameKey(item)));
  const dated = exact.filter((item) => {
    const resultYear = Number(item?.year);
    return !year || (Number.isFinite(resultYear) && Math.abs(resultYear - year) <= 1);
  });
  if (dated.length === 1) return dated[0];
  // TVDB spesso non ha l'anno: titolo identico + candidato unico bastano.
  if (exact.length === 1) {
    const resultYear = Number(exact[0]?.year);
    if (!year || !Number.isFinite(resultYear)) return exact[0];
  }

  // Serie accorpata nella madre: "超魔神英雄伝ワタル" -> "魔神英雄伝ワタル".
  const loose = items.filter((item) => {
    const key = nameKey(item);
    return key.length >= 4 && wanted.some((value) => value !== key && (value.includes(key) || key.includes(value)));
  });
  return loose.length === 1 ? loose[0] : null;
}

async function searchTvdbSeries(query) {
  const json = await tvdbGet(`/search?query=${encodeURIComponent(query)}&type=series&limit=10`);
  return json?.data || [];
}

/** La ricerca TVDB usa "series-227501", gli endpoint vogliono "227501". */
export function tvdbIdFromSearch(item) {
  const raw = String(item?.objectID || item?.id || '');
  const numeric = raw.match(/\d+/);
  return numeric ? numeric[0] : null;
}

async function tvdbIdBySearch(entry) {
  const wanted = tvdbQueries(entry);
  for (const query of wanted.queries) {
    const found = pickTvdbSeries(await searchTvdbSeries(query), wanted);
    if (found) return tvdbIdFromSearch(found);
  }
  return null;
}

/**
 * TMDB non accorpa per titolo tutti i seguiti ("City Hunter 2" non esiste come
 * serie): Kitsu però ha il mapping TVDB esplicito, quindi si mappa su quello.
 */
async function tvdbIdFromKitsu(kitsuId) {
  try {
    const json = await fetchJson(`${KITSU}/anime/${kitsuId}/mappings?page[limit]=20`);
    return tvdbSeriesIdFromMappings(json?.data);
  } catch (error) {
    // Entry Kitsu cancellata: vale "nessun mapping TVDB", non un errore del record.
    if (/HTTP 404 for kitsu\.io/.test(String(error?.message || ''))) return null;
    throw error;
  }
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Conservative metadata match for entries Kitsu has but never mapped to MAL
 * (~8% of the catalog). Exact normalised title + same subtype + year ±1, and
 * only when a single candidate survives: a wrong id is worse than a miss.
 */
export function pickKitsuResult(results, { titles, year, subtype }) {
  const wanted = new Set(titles.map(normalizeTitle).filter(Boolean));
  if (wanted.size === 0) return null;
  const matches = results.filter((item) => {
    const attributes = item?.attributes || {};
    if (String(attributes.subtype || '').toLowerCase() !== subtype) return false;
    const resultYear = yearOf(attributes.startDate);
    if (year && resultYear && Math.abs(resultYear - year) > 1) return false;
    const names = [attributes.canonicalTitle, ...Object.values(attributes.titles || {})].map(normalizeTitle);
    return names.some((name) => wanted.has(name));
  });
  return matches.length === 1 ? matches[0] : null;
}

async function kitsuIdByMetadata(entry) {
  const titles = [entry?.title, entry?.title_english].map((value) => String(value || '').trim()).filter(Boolean);
  // Kitsu distingue OVA, ONA e special: con "tv" fisso il match stretto non
  // potrebbe mai trovarli, ora che il catalogo li include.
  const subtype =
    { movie: 'movie', ova: 'ova', ona: 'ona', special: 'special', tv_special: 'special' }[
      String(entry?.type || '').toLowerCase()
    ] || 'tv';
  const year = yearOf(entry?.aired?.from);
  for (const query of [...new Set(titles)]) {
    const url = `${KITSU}/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=10`;
    const json = await fetchJson(url);
    const hit = pickKitsuResult(json?.data || [], { titles, year, subtype });
    if (hit?.id) return String(hit.id);
  }
  return null;
}

function yearOf(value) {
  const year = Number.parseInt(String(value || '').slice(0, 4), 10);
  return Number.isFinite(year) && year > 1900 ? year : null;
}

/**
 * Varianti di titolo per la ricerca TMDB, dalla più specifica alla più generica.
 * MAL aggiunge suffissi che TMDB non usa: "Area 88 (TV)", "Rozen Maiden:
 * Träumend", "Yowamushi Pedal 2nd Season".
 */
export function titleVariants(title, stripSequel = false) {
  const variants = [String(title || '').trim()];
  const add = (value) => {
    const clean = String(value || '').trim();
    if (clean.length >= 3 && !variants.includes(clean)) variants.push(clean);
  };
  add(variants[0].replace(/\s*\([^)]*\)\s*$/, ''));
  add(variants[0].replace(/\s+(?:Season\s+\d+|\d+(?:st|nd|rd|th)\s+Season|Part\s+\d+)\s*$/i, ''));
  add(variants[0].split(/\s*[:–—-]\s+/)[0]);
  // Solo per le serie: TMDB accorpa i seguiti nella serie madre ("City Hunter 2"
  // -> "City Hunter"). Per i film la coda è un altro film, non una stagione.
  if (stripSequel) add(variants[0].replace(/\s+(?:\d+|S\d+|[IVX]{1,4})\s*$/i, ''));
  return variants.filter(Boolean);
}

/** TMDB search terms for a Jikan catalog entry (MAL titles are Japanese-first). */
export function tmdbQuery(entry) {
  const kind = String(entry?.type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
  const queries = [];
  // MAL lascia title_english vuoto su molti OVA, ma Jikan porta l'inglese in
  // titles[] (type "English") o nei sinonimi: senza questi termini la ricerca
  // prova solo il romaji, che TMDB non usa.
  const englishInTitles = (entry?.titles || []).find(
    (item) => String(item?.type || '').toLowerCase() === 'english'
  )?.title;
  const synonyms = Array.isArray(entry?.title_synonyms) ? entry.title_synonyms : [];
  // Al massimo 3 sinonimi: ognuno costa una ricerca in più su TMDB.
  const sources = [entry?.title_english, englishInTitles, entry?.title, ...synonyms.slice(0, 3)];
  for (const value of sources) {
    const title = String(value || '').trim();
    if (!title) continue;
    for (const variant of titleVariants(title, kind === 'tv')) {
      if (!queries.includes(variant)) queries.push(variant);
    }
  }
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
  // La ricerca ora include gli adulti: si usano solo quando non c'è altro, così
  // una scheda normale non perde il posto contro un omonimo per adulti.
  const base = japanese.length > 0 ? japanese : results;
  const clean = base.filter((item) => item?.adult !== true);
  const pool = clean.length > 0 ? clean : base;
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
  const fetchResults = async (query, useApiYear) => {
    const params = new URLSearchParams({ query, api_key: tmdbKey });
    // Senza questo TMDB esclude gli adulti dalla ricerca: le OVA per adulti
    // finivano tutte in no-tmdb pur esistendo.
    params.set('include_adult', 'true');
    if (useApiYear && year) params.set(kind === 'movie' ? 'year' : 'first_air_date_year', String(year));
    const json = await fetchJson(`${TMDB}/${path}?${params}`);
    return json?.results || [];
  };
  for (const [index, query] of queries.entries()) {
    // `first_air_date_year` è esatto lato API, mentre MAL e TMDB divergono
    // spesso di un anno (Vandread: MAL 2001, TMDB 2000): si riprova senza il
    // filtro server e si applica il ±1 in locale.
    for (const useApiYear of year ? [true, false] : [false]) {
      const results = await fetchResults(query, useApiYear);
      const strict = pickTmdbResult(results, year ?? null);
      if (strict) return strict;
      // Solo il titolo originale, e solo al tentativo senza filtro: se l'anno
      // MAL è sbagliato di più di un anno, meglio il primo giapponese che un buco.
      if (index === 0 && !useApiYear) {
        const loose = pickTmdbResult(results, null);
        if (loose) return loose;
      }
    }
  }
  return null;
}

async function tmdbExternalIds(kind, id) {
  return await fetchJson(`${TMDB}/${kind}/${id}/external_ids?api_key=${encodeURIComponent(tmdbKey)}`);
}

/**
 * Titolo italiano TMDB: AnimeSaturn e AnimeWorld listano spesso questo, che il
 * romaji MAL e l'inglese non toccano. Una richiesta per opera, solo per le voci
 * nuove (le già mappate passano dal backfill).
 */
async function getTmdbItalianTitle(kind, id) {
  if (!id) return null;
  try {
    const json = await fetchJson(`${TMDB}/${kind}/${id}?api_key=${encodeURIComponent(tmdbKey)}&language=it-IT`);
    return String(json?.name || json?.title || '').trim();
  } catch {
    // null = richiesta fallita (rete/chiave), '' = nessun titolo italiano.
    return null;
  }
}

/** Stesso titolo a meno di maiuscole, accenti e punteggiatura. */
function samePlainTitle(a, b) {
  const key = (value) =>
    String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const left = key(a);
  return !left || left === key(b);
}

/** Legge una mappa statica { malId: id } una volta sola. */
function staticMap(file) {
  let cache;
  return (malId) => {
    if (!malId) return null;
    if (cache === undefined) cache = readJson(file) || {};
    const value = cache[String(malId)];
    return value ? String(value) : null;
  };
}

/**
 * tmdbId per un MAL id, dal ponte MDBList committato in scripts/.
 * Zero richieste: la build riusa un dato già risolto e verificato.
 */
export const tmdbIdFromMdblistMap = staticMap(mdblistTmdbFile);

/**
 * kitsuId per un MAL id, dal ponte SimKL (AniDB) committato in scripts/.
 * Usato solo quando il mapping ufficiale di Kitsu non risponde.
 */
export const kitsuIdFromSimklMap = staticMap(simklKitsuFile);

/** Converts one catalog entry into index keys; returns the ledger record. */
async function convertCatalogEntry(entry, index) {
  const at = new Date().toISOString().slice(0, 10);
  const title = String(entry?.title_english || entry?.title || '');
  // Romaji MAL: i siti italiani listano spesso l'opera con questo titolo, che
  // il filtro dei provider non ricava dall'inglese (token diversi). Il dato è
  // già in Jikan, quindi costa zero chiamate in più.
  const altTitle = String(entry?.title || '').trim();
  const titleAlt = altTitle && altTitle !== title ? altTitle : '';
  // Titolo e tipo nel registro: senza, i miss non sono più ricostruibili.
  const record = { at, title, type: String(entry?.type || '') };

  const query = tmdbQuery(entry);
  let tmdb = await findTmdb(query);
  if (!tmdb?.id) {
    // TMDB non conosce il titolo (tipico dei seguiti): l'id può arrivare dal
    // ponte MAL -> TMDB. Accettato solo se TMDB conferma lingua giapponese e
    // anno, come nella ricerca per titolo: un id sbagliato è peggio di un buco.
    const mapped = tmdbIdFromMdblistMap(entry?.mal_id);
    if (mapped) {
      let detail = null;
      try {
        detail = await fetchJson(`${TMDB}/${query.kind}/${mapped}?api_key=${encodeURIComponent(tmdbKey)}&language=it-IT`);
      } catch (error) {
        if (!/HTTP 404/.test(String(error?.message || ''))) throw error;
      }
      if (detail?.id && pickTmdbResult([detail], query.year)) tmdb = detail;
    }
  }
  if (!tmdb?.id) {
    // Stesso ponte, ma con SimKL: copre molti più titoli di MDBList e porta
    // anche il TVDB. La verifica resta la stessa (lingua + anno).
    const ids = await simklIds(entry?.mal_id);
    if (ids?.tmdb) {
      // L'id del ponte può essere morto o di un'altra opera: un 404 non è
      // un'eccezione, è "questo id non serve".
      let detail = null;
      try {
        detail = await fetchJson(`${TMDB}/${query.kind}/${ids.tmdb}?api_key=${encodeURIComponent(tmdbKey)}&language=it-IT`);
      } catch (error) {
        if (!/HTTP 404/.test(String(error?.message || ''))) throw error;
      }
      if (detail?.id && pickTmdbResult([detail], query.year)) tmdb = detail;
    }
  }
  if (!tmdb?.id) {
    return query.kind === 'tv'
      ? await convertFromTvdb(entry, index, record, titleAlt)
      : { ...record, status: 'no-tmdb' };
  }

  const external = await tmdbExternalIds(query.kind, tmdb.id);
  const imdbId = external?.imdb_id || '';
  const tvdbId = external?.tvdb_id ? String(external.tvdb_id) : '';
  // TMDB has the TVDB id for series; when it is missing we align on TMDB
  // episodes, so the entry does not fall out of the dataset.
  record.tmdbId = String(tmdb.id);
  record.tmdbTitle = tmdb.name || tmdb.title || '';

  // Split-cour entries share the same series: the first one already mapped it.
  // Checked before Kitsu, so those entries cost no lookup at all.
  if (query.kind === 'movie') {
    if (index.movies[`tmdb:${tmdb.id}`]) return { ...record, status: 'already' };
  } else {
    const existing = (tvdbId && index.series[`tvdb:${tvdbId}`]) || index.series[`tmdb:${tmdb.id}`];
    // `nokitsu` è il ripiego senza Kitsu: una entry completa deve poterlo
    // sostituire, altrimenti un OVA può bloccare la serie madre.
    if (existing && !existing.nokitsu) return { ...record, status: 'already' };
  }

  // A Kitsu mapping can point to a deleted entry (HTTP 404): then fall back to
  // the strict metadata match, exactly like entries with no mapping at all.
  const titleIt = await getTmdbItalianTitle(query.kind, tmdb.id);
  const titleItUseful = titleIt && !samePlainTitle(titleIt, title) ? titleIt : '';
  let kitsuId = (await kitsuIdForMal(entry.mal_id)) || kitsuIdFromSimklMap(entry.mal_id);
  let metadataTried = false;
  // Il TMDB è già stato trovato e verificato: se il kitsu manca, i film e le
  // serie con una stagione sola si mappano lo stesso. Oggi finivano buttati.
  let tmdbOnlyTried = false;
  const tmdbOnly = async () => {
    if (tmdbOnlyTried) return null;
    tmdbOnlyTried = true;
    if (query.kind === 'movie') {
      const mapped = { kitsuId: '', title, ...(titleAlt ? { titleAlt } : {}), ...(titleItUseful ? { titleIt: titleItUseful } : {}) };
      index.movies[`tmdb:${tmdb.id}`] = mapped;
      if (imdbId) index.movies[`imdb:${imdbId}`] = mapped;
      return { ...record, status: 'ok', via: 'tmdb-nokitsu' };
    }
    const seed = await buildSeriesSeedFromTmdbOnly({ tmdbId: String(tmdb.id), title, titleAlt, titleIt: titleItUseful });
    if (!seed) return null;
    const keys = Object.keys(seed.series);
    // Mai sopra una serie mappata con Kitsu: quel dato è più forte del nostro.
    if (keys.some((key) => index.series[key] && !index.series[key].nokitsu)) return null;
    for (const key of keys) {
      mergeSeries(index.series, key, seed.series[key].title, seed.series[key].seasons, seed.series[key].titleIt);
      index.series[key].nokitsu = true;
    }
    return { ...record, status: 'ok', via: 'tmdb-nokitsu' };
  };
  for (;;) {
    if (!kitsuId) {
      if (metadataTried) return (await tmdbOnly()) || { ...record, status: 'no-kitsu' };
      metadataTried = true;
      kitsuId = await kitsuIdByMetadata(entry);
      if (!kitsuId) return (await tmdbOnly()) || { ...record, status: 'no-kitsu' };
    }
    try {
      if (query.kind === 'movie') {
        const mapped = { kitsuId, title, ...(titleAlt ? { titleAlt } : {}), ...(titleItUseful ? { titleIt: titleItUseful } : {}) };
        index.movies[`tmdb:${tmdb.id}`] = mapped;
        if (imdbId) index.movies[`imdb:${imdbId}`] = mapped;
        return { ...record, kitsuId, status: 'ok' };
      }

      let result = null;
      if (tvdbId) {
        try {
          result = await buildSeriesSeed({ kitsuId, tvdbId, tmdbId: String(tmdb.id), titleAlt, titleIt: titleItUseful });
        } catch (error) {
          // Serie cancellata da TVDB: si allinea comunque su TMDB.
          if (!/HTTP 404 for api4\.thetvdb\.com/.test(error.message)) throw error;
        }
      }
      if (!result) result = await buildSeriesSeedFromTmdb({ kitsuId, tmdbId: String(tmdb.id), titleAlt, titleIt: titleItUseful });
      if (!result) return { ...record, kitsuId, status: 'no-align' };
      for (const [key, value] of Object.entries(result.series)) {
        mergeSeries(index.series, key, value.title, value.seasons, value.titleIt);
        // Questa entry è migliore del ripiego senza Kitsu: il flag va tolto,
        // altrimenti la prossima la tratterebbe come sostituibile.
        if (index.series[key].nokitsu) delete index.series[key].nokitsu;
      }
      const viaTvdb = Object.keys(result.series).some((key) => key.startsWith('tvdb:'));
      return { ...record, kitsuId, status: 'ok', via: viaTvdb ? 'tvdb' : 'tmdb' };
    } catch (error) {
      if (!/HTTP 404 for kitsu\.io/.test(error.message)) throw error;
      kitsuId = null;
    }
  }
}

/**
 * Fallback for series TMDB cannot find by title. Due tentativi, in ordine:
 * il mapping TVDB esplicito di Kitsu, poi la ricerca TVDB per nome. L'indice è
 * già keyed su TVDB, quindi non serve inventare un id TMDB.
 */
async function convertFromTvdb(entry, index, record, titleAlt = '') {
  let kitsuId = (await kitsuIdForMal(entry.mal_id)) || kitsuIdFromSimklMap(entry.mal_id);
  if (!kitsuId) kitsuId = await kitsuIdByMetadata(entry);
  if (!kitsuId) return { ...record, status: 'no-kitsu' };

  let tvdbId = (await tvdbIdFromKitsu(kitsuId)) || (await tvdbIdBySearch(entry));
  if (!tvdbId) {
    // Kitsu spesso non ha il TVDB di una OVA: SimKL sì, e con quel TVDB la
    // special si allinea alla stagione 0 della serie madre.
    const ids = await simklIds(entry?.mal_id);
    if (ids?.tvdb) tvdbId = String(ids.tvdb);
  }
  if (!tvdbId) return { ...record, kitsuId, status: 'no-tmdb' };

  let result = null;
  try {
    // Senza tmdbId il seed contiene solo la chiave tvdb.
    result = await buildSeriesSeed({ kitsuId, tvdbId, titleAlt });
  } catch (error) {
    const message = String(error?.message || '');
    // Serie TVDB cancellata o entry Kitsu cancellata: non c'è niente da
    // allineare, ma non è un errore del record (38 casi su 43 erano questo).
    if (!/HTTP 404 for (api4\.thetvdb\.com|kitsu\.io)/.test(message)) throw error;
  }
  if (!result) return { ...record, kitsuId, tvdbId, status: 'no-align' };

  // Niente scorciatoia "already": un seguito è un'altra stagione dello stesso
  // id TVDB, quindi ogni entry deve aggiungere la sua.
  for (const [key, value] of Object.entries(result.series)) {
    mergeSeries(index.series, key, value.title, value.seasons, value.titleIt);
    if (index.series[key].nokitsu) delete index.series[key].nokitsu;
  }
  return { ...record, kitsuId, tvdbId, status: 'ok', via: 'tvdb' };
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
        name: episode.name || '',
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
        // Un episodio di stagione 0 consumerebbe un numero della serie madre e
        // sfaserebbe tutti gli episodi successivi: lo prendono solo le entry che
        // sono davvero OVA/ONA/special. Se non ce n'è una, resta un buco.
        if (episode.season === 0 && !['OVA', 'ONA', 'special'].includes(String(entry.subtype))) return false;
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
      titleAlt: chosen.titleAlt || '',
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
      if (item.titleAlt) range.titleAlt = item.titleAlt;
      if (Number.isFinite(item.episodeCount)) range.episodeCount = item.episodeCount;
      ranges.push(range);
      lastKey = key;
    }
    seasons[String(season)] = ranges;
  }
  return seasons;
}

function mergeSeries(target, key, title, seasons, titleIt = '') {
  if (!target[key]) target[key] = { title, seasons: {} };
  if (!target[key].title && title) target[key].title = title;
  // Titolo italiano (TMDB it-IT): vale per l'opera, non per la singola cour.
  if (!target[key].titleIt && titleIt) target[key].titleIt = titleIt;
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

  const tvdbRanges = rangesFrom([...assignment.values()].map(({ episode, kitsuId, kitsuEpisode, title, titleAlt, episodeCount }) => ({
    season: episode.season,
    episode: episode.number,
    kitsuId,
    kitsuEpisode,
    title,
    // La cour della entry MAL convertita porta il romaji di MAL (più affidabile
    // per i siti); le altre, OVA e special comprese, il proprio.
    titleAlt: String(kitsuId) === String(seed.kitsuId) ? seed.titleAlt || titleAlt || '' : titleAlt || '',
    episodeCount,
  })));

  const result = {
    title: tvdbSeries.name || entries[0]?.title || '',
    titleIt: seed.titleIt || '',
    series: {},
  };
  mergeSeries(result.series, `tvdb:${tvdbId}`, result.title, tvdbRanges, result.titleIt);

  // IMDb key via TMDB external ids (TMDB already gave us the id).
  const tmdbTv = { id: seed.tmdbId };
  if (!tmdbTv?.id) return result;

  const tmdbDetails = await getTmdbTvDetails(tmdbTv.id);
  const imdbId = tmdbDetails?.external_ids?.imdb_id || null;
  if (imdbId) mergeSeries(result.series, `imdb:${imdbId}`, result.title, tvdbRanges, result.titleIt);

  // TMDB key: match TMDB episodes to TVDB episodes by air date (±1 day).
  const tmdbEpisodes = await getTmdbEpisodes(tmdbTv.id, tmdbDetails);

  const tmdbEntries = alignTmdbEpisodes([...assignment.values()], tmdbEpisodes);
  if (tmdbEntries.length > 0) {
    mergeSeries(result.series, `tmdb:${tmdbTv.id}`, result.title, rangesFrom(tmdbEntries), result.titleIt);
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

  const ranges = rangesFrom([...assignment.values()].map(({ episode, kitsuId, kitsuEpisode, title, titleAlt, episodeCount }) => ({
    season: episode.season,
    episode: episode.number,
    kitsuId,
    kitsuEpisode,
    title,
    titleAlt: String(kitsuId) === String(seed.kitsuId) ? seed.titleAlt || titleAlt || '' : titleAlt || '',
    episodeCount,
  })));

  const result = { title: details?.name || entries[0]?.title || '', titleIt: seed.titleIt || '', series: {} };
  mergeSeries(result.series, `tmdb:${seed.tmdbId}`, result.title, ranges, result.titleIt);
  const imdbId = details?.external_ids?.imdb_id || null;
  if (imdbId) mergeSeries(result.series, `imdb:${imdbId}`, result.title, ranges, result.titleIt);
  return result;
}

/**
 * Range per una serie mappata col solo TMDB. Vale solo con una stagione sola:
 * con più stagioni non c'è offset, quindi la numerazione del sito non è
 * deducibile e un episodio sbagliato sarebbe peggio di un buco.
 */
export function singleSeasonRanges(details, seed = {}) {
  const seasons = (details?.seasons || []).filter(
    (item) => Number(item?.season_number) > 0 && Number(item?.episode_count) > 0
  );
  if (seasons.length !== 1) return null;
  const season = seasons[0];
  const range = { from: 1, kitsuId: '', offset: 0, episodeCount: Number(season.episode_count) };
  if (seed.title) range.title = String(seed.title);
  if (seed.titleAlt) range.titleAlt = String(seed.titleAlt);
  return { [String(season.season_number)]: [range] };
}

/** Serie senza kitsu, con i soli dati TMDB. */
async function buildSeriesSeedFromTmdbOnly(seed) {
  const details = await getTmdbTvDetails(seed.tmdbId);
  const ranges = singleSeasonRanges(details, seed);
  if (!ranges) return null;
  const result = { title: details?.name || seed.title || '', titleIt: seed.titleIt || '', series: {} };
  mergeSeries(result.series, `tmdb:${seed.tmdbId}`, result.title, ranges, result.titleIt);
  const imdbId = details?.external_ids?.imdb_id || null;
  if (imdbId) mergeSeries(result.series, `imdb:${imdbId}`, result.title, ranges, result.titleIt);
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
  if (retryStatuses.length > 0) {
    let retried = 0;
    for (const [malId, record] of Object.entries(state.done)) {
      if (!retryStatuses.includes(record?.status)) continue;
      delete state.done[malId];
      retried += 1;
    }
    // Riavvolgi: le entry riaperte sono sparse nel catalogo.
    state.cursor = {};
    console.log(`  riaperte ${retried} entry con esito ${retryStatuses.join('/')}`);
    if (retried === 0) {
      console.log('  attenzione: nessuna entry con quegli esiti (battitura?). Validi: ok, already, no-kitsu, no-tmdb, no-align, error');
    }
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
          // Titolo e tipo restano: senza, un errore non è più ricostruibile dal
          // registro (era il caso dei 151 errori, tutti senza contesto).
          state.done[malId] = {
            at: new Date().toISOString().slice(0, 10),
            title: String(entry?.title || ''),
            type: String(entry?.type || ''),
            status: 'error',
            error: error.message,
          };
          stats.error = (stats.error || 0) + 1;
          console.error(`  ! ${type} ${malId}: ${error.message}`);
        }
        // Log ogni 25 (feedback), salvataggio su disco ogni 100 (il file cresce a MB).
        if (processed % 25 === 0) {
          const consumed = (cursor.page - 1) * JIKAN_PAGE_SIZE + cursor.pos;
          console.log(`  … ${type} ${consumed}/${total}`);
        }
        if (processed % 100 === 0) persist();
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
    `  cursore: ${catalogTypes
      .map((type) => `${type} ${state.cursor[type]?.page ?? 1}:${state.cursor[type]?.pos ?? 0}`)
      .join(', ')}`,
  );

  if (publish) await publishIndex();
}

const GH_TOKEN = String(process.env.GITHUB_TOKEN || '').trim();
const GH_REPO = String(process.env.GITHUB_REPO || 'Dexxtex/HanX').trim();
const GH_BRANCH = String(process.env.GITHUB_MAPPING_BRANCH || 'mapping').trim();
const GH_ASSET = 'anime-seasons.json';
/** Cursore pubblicato accanto all'indice: è il seed delle run successive. */
const GH_STATE_ASSET = 'jikan-progress.json';

function ghHeaders(extra = {}) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${GH_TOKEN}`,
    'content-type': 'application/json',
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

/** Accoda un file locale alla tree del commit di pubblicazione. */
async function publishFile(tree, name, file) {
  if (!fs.existsSync(file)) return;
  const blob = await ghApi(`/repos/${GH_REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({
      content: fs.readFileSync(file).toString('base64'),
      encoding: 'base64',
    }),
  });
  tree.push({ path: name, mode: '100644', type: 'blob', sha: blob.sha });
}

/**
 * Pubblica indice e cursore su un branch orfano a commit singolo.
 * Niente release e niente storia: il repo non cresce di ~5 MB al giorno.
 */
export async function publishIndex() {
  if (!GH_TOKEN) throw new Error('--publish richiede GITHUB_TOKEN (contents: write)');
  if (!fs.existsSync(outputFile)) throw new Error(`indice assente: ${outputFile}`);

  const tree = [];
  await publishFile(tree, GH_ASSET, outputFile);
  // Il cursore viaggia con l'indice: senza, la run successiva riparte da zero.
  await publishFile(tree, GH_STATE_ASSET, stateFile);
  if (tree.length === 0) throw new Error('niente da pubblicare');

  const createdTree = await ghApi(`/repos/${GH_REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree }),
  });
  const commit = await ghApi(`/repos/${GH_REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `mapping: indice ${new Date().toISOString().slice(0, 10)}`,
      tree: createdTree.sha,
      parents: [],
    }),
  });

  try {
    await ghApi(`/repos/${GH_REPO}/git/refs/heads/${GH_BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: true }),
    });
  } catch (error) {
    if (!/GitHub (404|422) /.test(error.message)) throw error;
    await ghApi(`/repos/${GH_REPO}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${GH_BRANCH}`, sha: commit.sha }),
    });
  }

  for (const entry of tree) {
    console.log(`  pubblicato: https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${entry.path}`);
  }
}

/**
 * Aggiunge `titleAlt` (romaji MAL, da Jikan locale) e `titleIt` (italiano TMDB)
 * alle entry già in indice: senza, i provider confrontano i siti solo col titolo
 * inglese. Nessun match nuovo, nessuna riscrittura delle stagioni.
 */
async function backfillTitleAlt() {
  const index = readJson(outputFile);
  if (!index?.series || !index?.movies) throw new Error(`indice assente o senza serie/film: ${outputFile}`);
  const state = readJson(stateFile) || {};
  const altByKitsu = new Map();
  let asked = 0;
  for (const [malId, record] of Object.entries(state.done || {})) {
    if (!record?.kitsuId) continue;
    asked += 1;
    try {
      const json = await fetchJson(`${JIKAN_API}/anime/${malId}`, {}, false);
      const romaji = String(json?.data?.title || '').trim();
      if (romaji) altByKitsu.set(String(record.kitsuId), romaji);
    } catch {
      // Un titolo mancante non ferma il backfill: resta senza titleAlt.
    }
    if (asked % 500 === 0) console.log(`  … ${asked} entry interrogate (${altByKitsu.size} titoli)`);
  }

  let touched = 0;
  if (asked > 0 && altByKitsu.size === 0) {
    throw new Error(`Jikan non ha risposto per nessuna delle ${asked} entry: controllo JIKAN_API_BASE (${JIKAN_API})`);
  }

  // I kitsuId che il registro non copre — le OVA e le special spesso non hanno
  // una entry MAL propria — prendono il romaji da Kitsu, che lo ha sempre.
  const needed = new Set();
  const consider = (holder) => {
    if (holder?.kitsuId && !altByKitsu.has(String(holder.kitsuId))) needed.add(String(holder.kitsuId));
  };
  for (const entry of Object.values(index.series)) {
    for (const ranges of Object.values(entry.seasons || {})) for (const range of ranges) consider(range);
  }
  for (const entry of Object.values(index.movies)) consider(entry);

  let kitsuAsked = 0;
  for (const kitsuId of needed) {
    try {
      const json = await fetchJson(`${KITSU}/anime/${kitsuId}`);
      const titles = json?.data?.attributes?.titles || {};
      const alt = String(titles.en_jp || titles.ja_jp || '').trim();
      if (alt) altByKitsu.set(kitsuId, alt);
    } catch {
      // Un id senza risposta resta senza titleAlt, come prima.
    }
    kitsuAsked += 1;
    if (kitsuAsked % 200 === 0) console.log(`  … ${kitsuAsked}/${needed.size} kitsuId interrogati su Kitsu`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (kitsuAsked > 0) console.log(`  Kitsu: ${kitsuAsked} kitsuId interrogati, ${altByKitsu.size} titoli in mappa`);
  const apply = (holder, title) => {
    const alt = altByKitsu.get(String(holder.kitsuId)) || '';
    if (!alt || alt === title || holder.titleAlt === alt) return;
    holder.titleAlt = alt;
    touched += 1;
  };
  for (const entry of Object.values(index.series)) {
    for (const ranges of Object.values(entry.seasons || {})) {
      for (const range of ranges) apply(range, range.title || entry.title || '');
    }
  }
  for (const entry of Object.values(index.movies)) apply(entry, entry.title || '');

  // Titoli italiani: le voci già in indice non ripassano dal build, quindi si
  // completano qui. Costo: una richiesta TMDB per opera (`tmdb:` key), non per
  // entry; il titolo viene propagato alle altre chiavi della stessa opera.
  let itAsked = 0;
  let itFailed = 0;
  let itTouched = 0;
  let moviesTouched = 0;
  if (!tmdbKey) {
    // Senza chiave il passaggio sarebbe un no-op silenzioso.
    console.error('  ⚠ titleIt saltato: TMDB_API_KEY non impostata nel container.');
  } else {
    const byKitsu = new Map();
    for (const entry of Object.values(index.series)) {
      for (const ranges of Object.values(entry.seasons || {})) {
        for (const range of ranges) {
          const kitsuId = String(range.kitsuId || '');
          if (!kitsuId) continue;
          if (!byKitsu.has(kitsuId)) byKitsu.set(kitsuId, new Set());
          byKitsu.get(kitsuId).add(entry);
        }
      }
    }
    for (const [key, entry] of Object.entries(index.series)) {
      if (!key.startsWith('tmdb:') || entry.titleIt) continue;
      const titleIt = await getTmdbItalianTitle('tv', key.slice('tmdb:'.length));
      itAsked += 1;
      if (itAsked % 500 === 0) console.log(`  … ${itAsked} serie TMDB interrogate (${itTouched} entry con titolo italiano)`);
      if (titleIt === null) {
        itFailed += 1;
        continue;
      }
      if (!titleIt || samePlainTitle(titleIt, entry.title)) continue;
      const targets = new Set([entry]);
      for (const ranges of Object.values(entry.seasons || {})) {
        for (const range of ranges) {
          for (const other of byKitsu.get(String(range.kitsuId || '')) || []) targets.add(other);
        }
      }
      for (const target of targets) {
        if (target.titleIt) continue;
        target.titleIt = titleIt;
        itTouched += 1;
      }
    }
    if (itAsked > 0 && itFailed === itAsked) {
      throw new Error(`TMDB non ha risposto per nessuna delle ${itAsked} serie: controllo TMDB_API_KEY`);
    }
    let moviesAsked = 0;
    let moviesFailed = 0;
    for (const [key, entry] of Object.entries(index.movies)) {
      // Le chiavi tmdb/imdb dello stesso film condividono l'oggetto.
      if (!key.startsWith('tmdb:') || entry.titleIt) continue;
      const titleIt = await getTmdbItalianTitle('movie', key.slice('tmdb:'.length));
      moviesAsked += 1;
      if (titleIt === null) {
        moviesFailed += 1;
        continue;
      }
      if (!titleIt || samePlainTitle(titleIt, entry.title)) continue;
      entry.titleIt = titleIt;
      moviesTouched += 1;
    }
    if (moviesAsked > 0 && moviesFailed === moviesAsked) {
      throw new Error(`TMDB non ha risposto per nessuno dei ${moviesAsked} film: controllo TMDB_API_KEY`);
    }
  }

  index.generatedAt = new Date().toISOString();
  const errors = validateIndex(index);
  if (errors.length > 0) {
    console.error('✗ Indice non valido, non scrivo.');
    for (const error of errors.slice(0, 50)) console.error(`  - ${error}`);
    process.exit(1);
  }
  writeJsonAtomic(outputFile, index);
  console.log(`✓ ${outputFile}`);
  console.log(`  titleAlt su ${touched} entry (${altByKitsu.size} kitsuId interrogati)`);
  console.log(`  titleIt su ${itTouched} entry serie (${itAsked} serie TMDB, ${itFailed} fallite) e ${moviesTouched} film`);
  if (publish) await publishIndex();
  process.exit(0);
}

if (isDirectRun && backfillTitles) {
  backfillTitleAlt().catch((error) => {
    console.error('✗ backfill titoli fallito:', error.message);
    process.exit(1);
  });
} else if (isDirectRun) {
  main().catch((error) => {
    console.error('✗ mapping build failed:', error.message);
    process.exit(1);
  });
}
