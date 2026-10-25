import { getDomain } from '../utils/domains.js';
import { debug, redactUrl } from '../utils/logger.js';
import { buildEasyProxyHlsUrl, buildEasyProxyStreamUrl } from '../utils/easyproxy.js';
import {
  decodeHtmlAttribute,
  parseEpisodesFromAnimeHtml,
  parseEpisodeServers,
  parseSearchResultsHtml,
  parseUnityCoEpisodes,
  parseVixcloudHls,
  selectHighestHlsVariant,
} from './animeunity-parsers.js';
import type { AnimeUnityPageEpisode } from './animeunity-parsers.js';
import { AnimeUnityConfig, StreamForStremio } from '../types/animeunity.js';
import * as cheerio from 'cheerio';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ProxyAgent as UndiciProxyAgent } from 'undici';
import { checkIsAnimeById, applyUniversalAnimeTitleNormalization } from '../utils/animeGate.js';
import {
  buildTitleFallbackQueries,
  normalizeTitleForSearch as normalizeAnimeTitleForSearch,
  titleMatchScoreAny,
  type TitleNormalizationOptions,
} from '../utils/anime-title-normalization.js';
import {
  createCaches,
  fetchResource,
  getProviderUrl,
  isSearchProxyEnabled,
  normalizeEpisodesList,
  normalizeRequestedEpisode,
  parseEpisodeNumber,
  parsePositiveInt,
  pickEpisodeEntry,
  toAbsoluteUrl,
  collectMediaLinksFromEmbedHtml,
  sanitizeAnimeTitle,
  getEnglishTitleFromAnyId,
  episodeTag,
} from './anime-core/index.js';
import {
  resolveMappingRequest,
  resolveAnimeTarget,
  resolveSeasonFallbackTitle,
  getKitsuTitle,
  getTvdbTitle,
  type MappingRequest,
} from '../mapping/index.js';

// --- Type definitions for external API responses ---

const USER_AGENT =
  process.env.AU_USER_AGENT ||
  process.env.AS_USER_AGENT ||
  process.env.AW_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

const FETCH_TIMEOUT = Number.parseInt(process.env.ANIMEUNITY_FETCH_TIMEOUT_MS || '10000', 10) || 10000;
const TTL = {
  http: 5 * 60 * 1000,
  animePage: 15 * 60 * 1000,
  streamPage: 5 * 60 * 1000,
  mapping: 2 * 60 * 1000,
};

const caches = createCaches();

const DIRECT_TIMEOUT = 3000; // timeout breve per tentativo diretto (senza proxy)
const PROXY_CONFIGS = (isSearchProxyEnabled() ? [
  { label: 'AU_PROXY', url: String(process.env.AU_PROXY || '').trim() },
  { label: 'globale', url: String(process.env.PROXY || '').trim() },
] : [])
  .filter((entry, index, all) => entry.url && all.findIndex((other) => other.url === entry.url) === index)
  .flatMap((entry) => {
    try {
      const isSocks = entry.url.startsWith('socks');
      return [{
        ...entry,
        type: isSocks ? 'SOCKS' : 'HTTP/HTTPS',
        // fetchResource usa undici per HTTP(S), node-fetch per SOCKS.
        nodeAgent: isSocks ? new SocksProxyAgent(entry.url) : undefined,
        fetchAgent: isSocks ? undefined : new UndiciProxyAgent(entry.url),
      }];
    } catch (error: any) {
      console.warn(`[AnimeUnity][Proxy] Configurazione ${entry.label} ignorata: ${error?.message || error}`);
      return [];
    }
  });

// --- Proxy diagnostic helpers ---
function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch { return url.replace(/:([^@:]+)@/, ':***@'); }
}

if (PROXY_CONFIGS.length) {
  for (const proxy of PROXY_CONFIGS) {
    debug(4, 'AnimeUnity', `[AnimeUnity][Proxy] Proxy ${proxy.label} configurato: tipo=${proxy.type} url=${maskProxyUrl(proxy.url)}`);
  }
} else {
  debug(3, 'AnimeUnity', '[AnimeUnity][Proxy] Nessun proxy configurato (PROXY e AU_PROXY non impostati)');
}

/**
 * fetchResource wrapper: con SEARCH_VIA_PROXY=true usa AU_PROXY, poi PROXY
 * globale, poi il diretto. Senza la variabile (default) va sempre diretto.
 */
export async function auFetchResource(url: string, providerCaches: any, options: any = {}): Promise<any> {
  const attempts = [
    ...PROXY_CONFIGS.map((proxy) => ({
      label: `proxy ${proxy.label} ${proxy.type}`,
      agent: proxy.fetchAgent || proxy.nodeAgent,
      timeoutMs: options.timeoutMs || FETCH_TIMEOUT,
    })),
    // Senza proxy il diretto non è un fallback: deve usare il timeout normale.
    { label: 'diretto', agent: null, timeoutMs: PROXY_CONFIGS.length ? DIRECT_TIMEOUT : (options.timeoutMs || FETCH_TIMEOUT) },
  ];

  // Cache separata per hop: un fallback diretto non deve "vincere" sul proxy
  // nei successivi fetch dello stesso URL.
  const baseCacheKey = options.cacheKey || url;
  let lastError: any;
  for (const attempt of attempts) {
    debug(4, 'AnimeUnity', `[AnimeUnity][Proxy] fetchResource ${attempt.label} (${attempt.timeoutMs}ms) -> ${redactUrl(url)}`);
    try {
      const result = await fetchResource(url, providerCaches, {
        ...options,
        cacheKey: `${baseCacheKey}#${attempt.agent ? attempt.label : 'diretto'}`,
        agent: attempt.agent,
        timeoutMs: attempt.timeoutMs,
      });
      debug(4, 'AnimeUnity', `[AnimeUnity][Proxy] fetchResource ${attempt.label} OK <- ${redactUrl(url)}`);
      return result;
    } catch (error: any) {
      lastError = error;
      console.warn(`[AnimeUnity][Proxy] fetchResource ${attempt.label} FALLITO: ${error?.message || error} <- ${url}`);
    }
  }
  throw lastError;
}

interface AnimeUnitySearchResult {
  id: number;
  slug: string;
  name: string;
  name_it?: string; // Titolo italiano (opzionale)
  name_eng?: string; // Titolo inglese (opzionale)
  episodes_count: number;
  type?: string; // Solo .co: TV / Movie / Special
}

interface AnimeUnityStreamData {
  episode_page: string | null;
  embed_url: string | null;
  hls_url: string | null;
  mp4_url: string | null;
}

function getUnityBaseUrl(): string {
  const configured = getProviderUrl('animeunity', ['ANIMEUNITY_BASE_URL', 'AU_BASE_URL']);
  const raw = String(configured || getDomain('animeunity') || 'animeunity.at').trim().replace(/\/+$/, '');
  // Il canonical è senza www: www risponde 301 verso l'apex, quindi tenerlo
  // costerebbe un redirect (e un cookie perso) su ogni singola richiesta.
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (/^www\./i.test(u.hostname)) u.hostname = u.hostname.slice(4);
    return u.origin;
  } catch {
    const host = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    return `https://${host || 'animeunity.at'}`;
  }
}

/**
 * AnimeUnity.co è un backend diverso (server-rendered, senza /ajax): ricerca su
 * /archivio?title=, episodi nell'attributo `episodes`, embed per episodio su
 * /anime/<id>-<slug>/<episodeId>. Tutto il resto del provider resta uguale.
 */
function isUnityCoBase(): boolean {
  try {
    return /(^|\.)animeunity\.co$/i.test(new URL(getUnityBaseUrl()).hostname);
  } catch {
    return false;
  }
}

function normalizeAnimePath(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  let value = String(pathOrUrl).trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      return null;
    }
  }

  if (!value.startsWith('/')) value = `/${value}`;
  value = value.replace(/\/+$/, '');

  const match = value.match(/^\/(?:anime\/\d+(?:-[^/?#]+)?|play\/[^/?#]+)/i);
  return match ? match[0] : null;
}

function buildUnityUrl(pathOrUrl: string | null | undefined): string | null {
  const text = String(pathOrUrl || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('/')) return `${getUnityBaseUrl()}${text}`;
  return `${getUnityBaseUrl()}/${text}`;
}

function extractAnimeIdSlugFromPath(animePath: string): { animeId: number | null; animeSlug: string | null } {
  const match = String(animePath || '').match(/^\/anime\/(\d+)(?:-([^/?#]+))?/i);
  return {
    animeId: parsePositiveInt(match?.[1]),
    animeSlug: match?.[2] ? String(match[2]).trim() : null,
  };
}

let searchCooldownUntil = 0;

async function searchEndpoint(query: string, _dubbed = false): Promise<AnimeUnitySearchResult[]> {
  if (isUnityCoBase()) return searchUnityCo(query);
  if (searchCooldownUntil > Date.now()) return [];

  let payload: any;
  try {
    payload = await auFetchResource(
      `${getUnityBaseUrl()}/ajax/anime/search?keyword=${encodeURIComponent(query)}`,
      caches,
      {
        as: 'json',
        ttlMs: TTL.http,
        cacheKey: `au-search:${query}`,
        timeoutMs: FETCH_TIMEOUT,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Referer': `${getUnityBaseUrl()}/`,
        },
      }
    );
  } catch (error: any) {
    // Il sito throttla aggressivamente: evita la catena di fallback per un minuto.
    if (/\b429\b/.test(String(error?.message || error))) {
      searchCooldownUntil = Date.now() + 60_000;
      console.warn('[AnimeUnity] Ricerca in rate limit (429): pausa 60s');
    }
    return [];
  }

  const hits = parseSearchResultsHtml(String(payload?.result?.html || ''));
  return hits.map((hit) => ({
    ...hit,
    name_it: hit.name,
    name_eng: '',
  }));
}

async function searchUnityCo(query: string): Promise<AnimeUnitySearchResult[]> {
  try {
    const html = String(await auFetchResource(
      `${getUnityBaseUrl()}/archivio?title=${encodeURIComponent(query)}`,
      caches,
      {
        ttlMs: TTL.http,
        cacheKey: `au-co-search:${query}`,
        timeoutMs: FETCH_TIMEOUT,
        headers: { 'Referer': `${getUnityBaseUrl()}/` },
      }
    ) || '');

    const raw = html.match(/\brecords="([^"]+)"/)?.[1];
    if (!raw) return [];

    const records = JSON.parse(decodeHtmlAttribute(raw)) as any[];
    return records
      .filter((record) => record && record.id && record.slug)
      .map((record) => ({
        id: Number(record.id),
        slug: String(record.slug),
        name: String(record.title || record.title_it || record.title_eng || '').trim(),
        name_it: record.title_it ? String(record.title_it) : undefined,
        name_eng: record.title_eng ? String(record.title_eng) : undefined,
        episodes_count: Number(record.episodes_count) || 0,
        type: record.type ? String(record.type) : undefined,
      }))
      .filter((record) => record.name);
  } catch (error: any) {
    console.warn('[AnimeUnity][co] ricerca fallita:', error?.message || error);
    return [];
  }
}

/** Le serie lunghe hanno solo 120 episodi nella pagina: il resto arriva da /info_api. */
async function fetchUnityCoEpisodeWindow(animeId: number, episode: number): Promise<AnimeUnityPageEpisode[]> {
  try {
    const payload = await auFetchResource(
      `${getUnityBaseUrl()}/info_api/${animeId}/${episode}?start_range=${Math.max(1, episode - 30)}&end_range=${episode + 30}`,
      caches,
      {
        as: 'json',
        ttlMs: TTL.animePage,
        cacheKey: `au-co-episodes:${animeId}:${episode}`,
        timeoutMs: FETCH_TIMEOUT,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Referer': `${getUnityBaseUrl()}/`,
        },
      }
    ) as any;

    return (payload?.episodes || []).map((entry: any) => ({
      id: Number(entry?.id) || 0,
      number: parseEpisodeNumber(entry?.number, 0),
    })).filter((entry: AnimeUnityPageEpisode) => entry.id > 0);
  } catch (error: any) {
    console.warn('[AnimeUnity][co] info_api episodi fallita:', error?.message || error);
    return [];
  }
}

/** Su .co ogni scheda è una sola lingua: il flag `dub` dell'anime dice quale. */
function isUnityCoDubPage(html: string): boolean {
  const raw = String(html || '').match(/\banime="([^"]+)"/)?.[1];
  if (!raw) return false;
  try {
    // Il JSON contiene anche `related[]`, ognuno col proprio `dub`: serve il campo top-level.
    return JSON.parse(decodeHtmlAttribute(raw))?.dub === 1;
  } catch {
    return false;
  }
}

/**
 * .co tiene la versione ITA della stessa serie su una scheda separata
 * ("<slug>-ita"), che l'archivio a volte non restituisce (es. One Piece):
 * il link sta nella pagina della versione SUB.
 */
function findUnityCoItaSibling(html: string, currentPath: string): string | null {
  const current = String(currentPath || '').match(/^\/anime\/(\d+)-([a-z0-9-]+)$/i);
  if (!current) return null;
  const baseSlug = current[2].toLowerCase();
  if (/-ita$/i.test(baseSlug)) return null;
  const target = `${baseSlug}-ita`;
  for (const link of String(html || '').matchAll(/\/anime\/(\d+)-([a-z0-9-]+)/gi)) {
    if (link[2].toLowerCase() === target) return `/anime/${link[1]}-${link[2]}`;
  }
  return null;
}

async function resolveServerEmbedUrl(linkId: string, referer: string): Promise<string | null> {
  try {
    const payload = await auFetchResource(
      `${getUnityBaseUrl()}/ajax/server?get=${encodeURIComponent(linkId)}`,
      caches,
      {
        as: 'json',
        ttlMs: TTL.streamPage,
        cacheKey: `au-server:${linkId}`,
        timeoutMs: FETCH_TIMEOUT,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Referer: referer,
        },
      }
    );
    return toAbsoluteUrl(payload?.result?.url || null, getUnityBaseUrl());
  } catch (error: any) {
    console.warn('[AnimeUnity] ajax/server failed:', error?.message || error);
    return null;
  }
}

async function resolveEmbedMedia(
  embedUrl: string,
  episodePage: string
): Promise<{ hls_url: string | null; mp4_url: string | null }> {
  let hlsUrl: string | null = null;
  let mp4Url: string | null = null;

  const fetchPage = (url: string) => auFetchResource(url, caches, {
    ttlMs: TTL.streamPage,
    cacheKey: `au-embed:${url}`,
    timeoutMs: FETCH_TIMEOUT,
    headers: { referer: episodePage, 'user-agent': USER_AGENT },
  });

  try {
    const html = String(await fetchPage(embedUrl) || '');
    hlsUrl = parseVixcloudHls(html, embedUrl);
    mp4Url = collectMediaLinksFromEmbedHtml(html, embedUrl)
      .find((entry) => /\.mp4(?:[?#].*)?$/i.test(entry.href))?.href || null;

    // Alcuni embed sono un wrapper: il player vixcloud sta in un iframe.
    if (!hlsUrl) {
      const iframeSrc = toAbsoluteUrl(
        cheerio.load(html)('iframe[src*="vixcloud"], iframe[src*="vixsrc"]').first().attr('src') || null,
        embedUrl
      );
      if (iframeSrc) {
        // vixcloud.co non risolve più ovunque: lo specchio attivo è vixsrc.to.
        const mirrorUrl = iframeSrc.replace(/\/\/(?:www\.)?vixcloud\.co\//i, '//vixsrc.to/');
        let playerHtml = '';
        try {
          playerHtml = String(await fetchPage(iframeSrc) || '');
        } catch (error: any) {
          if (mirrorUrl === iframeSrc) throw error;
          console.warn('[AnimeUnity] iframe vixcloud non raggiungibile, provo vixsrc.to');
          playerHtml = String(await fetchPage(mirrorUrl) || '');
        }
        hlsUrl = parseVixcloudHls(playerHtml, iframeSrc);
        mp4Url = mp4Url || collectMediaLinksFromEmbedHtml(playerHtml, iframeSrc)
          .find((entry) => /\.mp4(?:[?#].*)?$/i.test(entry.href))?.href || null;
      }
    }

    if (hlsUrl) {
      try {
        const manifest = String(await fetchPage(hlsUrl) || '');
        const highest = selectHighestHlsVariant(manifest, hlsUrl);
        if (highest) {
          hlsUrl = highest;
          debug(4, 'AnimeUnity', '[AnimeUnity] Variante HLS massima selezionata');
        }
      } catch (error: any) {
        console.warn('[AnimeUnity] Selezione variante HLS fallita:', error?.message || error);
      }
    }
  } catch (error: any) {
    console.warn('[AnimeUnity] embed media failed:', error?.message || error);
  }

  return { hls_url: hlsUrl, mp4_url: mp4Url };
}

async function getStreamData(
  animeId: number,
  animeSlug: string,
  episodeId: number,
  language: 'sub' | 'dub'
): Promise<AnimeUnityStreamData> {
  if (isUnityCoBase()) return getUnityCoStreamData(animeId, animeSlug, episodeId);
  const episodePage = `${getUnityBaseUrl()}/anime/${animeId}-${animeSlug}/ep-${episodeId}`;
  const empty: AnimeUnityStreamData = { episode_page: episodePage, embed_url: null, hls_url: null, mp4_url: null };

  try {
    const html = await auFetchResource(episodePage, caches, {
      ttlMs: TTL.streamPage,
      cacheKey: `au-ep:${animeId}:${episodeId}`,
      timeoutMs: FETCH_TIMEOUT,
    }).catch(() => '');

    const candidates = parseEpisodeServers(String(html || ''), episodeId)
      .filter((server) => server.type === language);
    const server = candidates.find((entry) => entry.host === 'vixcloud') || candidates[0];
    if (!server) return empty;

    const embedUrl = await resolveServerEmbedUrl(server.linkId, episodePage);
    if (!embedUrl) return empty;

    const media = await resolveEmbedMedia(embedUrl, episodePage);
    return { ...empty, embed_url: embedUrl, ...media };
  } catch (error: any) {
    console.warn('[AnimeUnity] getStreamData failed:', error?.message || error);
    return empty;
  }
}

async function getUnityCoStreamData(
  animeId: number,
  animeSlug: string,
  episodeId: number
): Promise<AnimeUnityStreamData> {
  const episodePage = `${getUnityBaseUrl()}/anime/${animeId}-${animeSlug}/${episodeId}`;
  const empty: AnimeUnityStreamData = { episode_page: episodePage, embed_url: null, hls_url: null, mp4_url: null };

  try {
    const html = String(await auFetchResource(episodePage, caches, {
      ttlMs: TTL.streamPage,
      cacheKey: `au-co-ep:${animeId}:${episodeId}`,
      timeoutMs: FETCH_TIMEOUT,
    }).catch(() => '') || '');

    const raw = html.match(/\bembed_url="([^"]+)"/)?.[1];
    if (!raw) return empty;

    const embedUrl = decodeHtmlAttribute(raw);
    const media = await resolveEmbedMedia(embedUrl, episodePage);
    return { ...empty, embed_url: embedUrl, ...media };
  } catch (error: any) {
    console.warn('[AnimeUnity][co] getStreamData failed:', error?.message || error);
    return empty;
  }
}

function filterAnimeResults(results: { version: AnimeUnitySearchResult; language_type: string }[], queryTitles: string[]) {
  const scored = results.map((result) => {
    const titles = [result.version.name_eng || '', result.version.name_it || '', result.version.name || ''].filter(Boolean);
    const score = Math.max(0, ...titles.map((title) => titleMatchScoreAny(queryTitles, title)));
    return { result, score };
  }).filter((entry) => entry.score > 0);
  const best = scored.reduce((max, entry) => Math.max(max, entry.score), 0);
  const filtered = best >= 0.5 ? scored.filter((entry) => entry.score === best).map((entry) => entry.result) : [];

  debug(4, 'AnimeUnity', `[UniversalTitle][Filter][Legacy] Query ricerca: "${queryTitles.join(' | ')}"`);
  debug(4, 'AnimeUnity', `[UniversalTitle][Filter][Legacy] Risultati prima del filtro:`, results.map(r => `${r.version.name} [it:"${r.version.name_it || 'N/A'}" eng:"${r.version.name_eng || 'N/A'}"]`));
  debug(4, 'AnimeUnity', `[UniversalTitle][Filter][Legacy] Risultati dopo il filtro:`, filtered.map(r => r.version.name));
  return filtered;
}

// ==== AUTO-NORMALIZATION-EXACT-MAP-START ====
const exactMap: Record<string, string> = {

  "Attack on Titan: Final Season - The Final Chapters": "Attack on Titan Final Season THE FINAL CHAPTERS Special 1",
  "Attack on Titan: The Final Season - Final Chapters Part 2": "Attack on Titan Final Season THE FINAL CHAPTERS Special 2",

  "Attack on Titan OAD": "Attack on Titan OVA",


  "Cat's\u2665Eye": "Occhi di gatto (2025)",
  "Attack on Titan: Final Season": "Attack on Titan: The Final Season",
  "Attack on Titan: Final Season Part 2": "Attack on Titan: The Final Season Part 2",


  "Ranma \u00bd (2024) Season 2": "Ranma \u00bd (2024) 2",
  "Ranma1/2 (2024) Season 2": "Ranma \u00bd (2024) 2",


  "Link Click Season 2": "Link Click 2",



  "K: SEVEN STORIES Lost Small World - Outside the Cage - ": "K: Seven Stories Movie 4 - Lost Small World - Ori no Mukou ni",




  "Nichijou - My Ordinary Life": "Nichijou",





  "Case Closed Movie 01: The Time Bombed Skyscraper": "Detective Conan Movie 1: Fino alla fine del tempo",


  "Jujutsu Kaisen: The Culling Game Part 1": "Jujutsu Kaisen 3: The Culling Game Part 1",

  "My Hero Academia Final Season": "My Hero Academia Final Season",








  "[Oshi No Ko] Season 3": "Oshi No Ko 3",









  // << AUTO-INSERT-EXACT >> (non rimuovere questo commento)
};
// ==== AUTO-NORMALIZATION-EXACT-MAP-END ====

const animeUnityTitleNormalization: TitleNormalizationOptions = {
  exactMap,
  replacements: [
    ['Season', ''],
    ['Shippuuden', 'Shippuden'],
    ['-', ''],
    ['Ore dake Level Up na Ken', 'Solo Leveling'],
  ],
  stripColonAfter: 'Naruto:',
};

function normalizeTitleForSearch(title: string): string {
  if (Object.prototype.hasOwnProperty.call(exactMap, title)) {
    debug(3, 'AnimeUnity', `[AnimeUnity][ExactMap] Hit: "${title}" -> "${exactMap[title]}"`);
  }
  return normalizeAnimeTitleForSearch(title, animeUnityTitleNormalization);
}

/** Esportata per i test: la query deve arrivare al sito senza spazi doppi. */
export { normalizeTitleForSearch };

export class AnimeUnityProvider {
  constructor(private config: AnimeUnityConfig) { }

  private async extractStreamsFromAnimePath(
    animePath: string,
    requestedEpisodeInput: number | null,
    seasonNumber: number | null,
    isMovie: boolean,
    titleOverride?: string
  ): Promise<StreamForStremio[]> {
    const normalizedPath = normalizeAnimePath(animePath);
    if (!normalizedPath) return [];

    const animeUrl = buildUnityUrl(normalizedPath);
    if (!animeUrl) return [];

    const html = await auFetchResource(animeUrl, caches, {
      ttlMs: TTL.animePage,
      cacheKey: `au-anime:${normalizedPath}`,
      timeoutMs: FETCH_TIMEOUT,
    }).catch(() => '');

    if (!html) return [];

    const $ = cheerio.load(String(html));
    const pageTitle =
      $('meta[property="og:title"]').attr('content') ||
      $('title').first().text().trim() ||
      null;
    const displayTitle = titleOverride || sanitizeAnimeTitle(pageTitle) || 'Unknown Title';
    const requestedEpisode = normalizeRequestedEpisode(requestedEpisodeInput);

    const { animeId, animeSlug } = extractAnimeIdSlugFromPath(normalizedPath);
    if (!animeId || !animeSlug) return [];

    // .co mette solo i primi 120 episodi nella pagina: per le serie lunghe
    // chiediamo la finestra che contiene l'episodio richiesto a /info_api.
    let pageEpisodes = isUnityCoBase()
      ? parseUnityCoEpisodes(String(html))
      : parseEpisodesFromAnimeHtml(String(html));
    if (isUnityCoBase() && requestedEpisode
      && !pageEpisodes.some((entry) => parseEpisodeNumber(entry.number, 0) === requestedEpisode)) {
      pageEpisodes = [...pageEpisodes, ...(await fetchUnityCoEpisodeWindow(animeId, requestedEpisode))];
    }

    const normalizedEpisodes = normalizeEpisodesList(
      pageEpisodes.map((entry, index) => ({
        num: parseEpisodeNumber(entry.number, index + 1),
        episodeId: entry.id,
        link: null,
        fileName: entry.name || null,
        embedUrl: null,
      })),
      getUnityBaseUrl()
    );

    const selected = pickEpisodeEntry(normalizedEpisodes, requestedEpisode, isMovie ? 'movie' : 'tv');
    if (!selected?.episodeId) return [];

    const resolvedEpisodeNum = parsePositiveInt(selected.num) || requestedEpisode;
    const preferMp4 = /^(1|true|on)$/i.test(String(process.env.ANIMEUNITY_PREFER_MP4 || process.env.ANIME_MP4_FALLBACK || '0'));

    // --- 2 modalità (come StreamingCommunity) ---
    // animeunityDirect = Direct (solo locale, IP-bound)
    // animeunityProxy  = Proxy (cross-IP, tutto via EasyProxy)
    // Default (nessuna selezione) = Proxy se EasyProxy configurato, altrimenti Direct
    const wantsDirect = this.config.animeunityDirect === true;
    const wantsProxy = this.config.animeunityProxy === true;
    const noneSelected = !wantsDirect && !wantsProxy;
    const directWanted = noneSelected ? !this.config.proxyUrl : wantsDirect;
    const proxyWanted = noneSelected ? !!this.config.proxyUrl : wantsProxy;

    const streams: StreamForStremio[] = [];
    const seenLinks = new Set<string>();
    const pushStream = (url: string, title: string) => {
      if (!url || seenLinks.has(url)) return;
      seenLinks.add(url);
      streams.push({ title, url, behaviorHints: { notWebReady: true } });
    };

    // .at espone SUB e ITA nello stesso episodio; .co ha schede separate per lingua.
    const languages: ('sub' | 'dub')[] = isUnityCoBase()
      ? [isUnityCoDubPage(String(html)) ? 'dub' : 'sub']
      : ['sub', 'dub'];
    for (const language of languages) {
      const streamResult = await getStreamData(animeId, animeSlug, selected.episodeId, language);
      if (!streamResult.hls_url && !streamResult.mp4_url && !streamResult.embed_url) continue;

      const langLabel = language === 'dub' ? 'ITA' : 'SUB';
      let baseTitle = `${capitalize(displayTitle)} ▪ ${langLabel} ▪ ${episodeTag(seasonNumber, resolvedEpisodeNum)}`;

      if (directWanted) {
        if (streamResult.hls_url) pushStream(streamResult.hls_url, baseTitle + ' (HLS)');
        // MP4 solo se manca l'HLS o se richiesto esplicitamente: di default una
        // stream per lingua, in HLS (l'MP4 era un doppione dello stesso episodio).
        if (streamResult.mp4_url && (!streamResult.hls_url || preferMp4)) {
          try {
            pushStream(
              buildEasyProxyStreamUrl(streamResult.mp4_url, this.config.proxyUrl, this.config.proxyPassword),
              baseTitle + (preferMp4 ? ' (MP4 Preferred)' : ' (MP4)')
            );
          } catch (e: any) {
            console.warn('[AnimeUnity] Errore fallback MP4:', e?.message || e);
          }
        }
      }

      if (proxyWanted && this.config.proxyUrl.trim()) {
        const target = streamResult.hls_url || streamResult.embed_url;
        if (!target) continue;
        let origin = '';
        try {
          origin = new URL(target).origin;
        } catch {
          origin = getUnityBaseUrl();
        }
        const proxyPlaylistUrl = new URL(buildEasyProxyHlsUrl(
          target,
          this.config.proxyUrl,
          this.config.proxyPassword,
          {
            Origin: origin,
            Referer: streamResult.episode_page || animeUrl,
          }
        ));
        // Se la selezione della variante fallisce, EasyProxy sceglie comunque la più alta.
        proxyPlaylistUrl.searchParams.set('max_res', 'true');
        debug(4, 'AnimeUnity', '[AnimeUnity][EasyProxy] Built HLS proxy URL for:', redactUrl(target));
        pushStream(proxyPlaylistUrl.toString(), baseTitle);
      }
    }

    return streams;
  }

  // Made public for catalog search
  async searchAllVersions(title: string): Promise<{ version: AnimeUnitySearchResult; language_type: string }[]> {
    try {
      const subPromise = searchEndpoint(title, false).catch(() => []);
      const dubPromise = searchEndpoint(title, true).catch(() => []);

      const [subResults, dubResults]: [AnimeUnitySearchResult[], AnimeUnitySearchResult[]] = await Promise.all([subPromise, dubPromise]);
      const results: { version: AnimeUnitySearchResult; language_type: string }[] = [];

      debug(2, 'AnimeUnity', `[AnimeUnity] Risultati SUB per "${title}":`, subResults?.length || 0);
      debug(2, 'AnimeUnity', `[AnimeUnity] Risultati DUB per "${title}":`, dubResults?.length || 0);

      // Unisci tutti i risultati (SUB e DUB), ma assegna ITA o CR se il nome contiene
      const allResults = [...(subResults || []), ...(dubResults || [])];
      // Filtra duplicati per nome e id
      const seen = new Set();
      for (const r of allResults) {
        if (!r || !r.name || !r.id) continue;
        const key = r.name + '|' + r.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const nameLower = r.name.toLowerCase();
        let language_type = 'SUB ITA';
        if (nameLower.includes('cr')) {
          language_type = 'CR ITA';
        } else if (nameLower.includes('ita')) {
          language_type = 'ITA';
        }
        results.push({ version: r, language_type });
      }
      debug(2, 'AnimeUnity', `[AnimeUnity] Risultati totali dopo filtro duplicati:`, results.length);
      return results;
    } catch (error) {
      console.error(`[AnimeUnity] Errore in searchAllVersions per "${title}":`, error);
      return [];
    }
  }

  async handleKitsuRequest(kitsuIdString: string): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) {
      return { streams: [] };
    }
    try {
      const request = resolveMappingRequest(kitsuIdString);
      if (!request) return { streams: [] };
      let title = await getKitsuTitle(request.id);
      if (!title) {
        try {
          title = await getEnglishTitleFromAnyId(request.id, 'kitsu', this.config.tmdbApiKey);
        } catch { }
      }
      if (!title) return { streams: [] };
      return this.handleTitleRequest(title, null, request.episode, request.isMovie);
    } catch (error) {
      console.error('Error handling Kitsu request:', error);
      return { streams: [] };
    }
  }

  /**
   * Gestisce la ricerca AnimeUnity partendo da un ID MAL (mal:ID[:STAGIONE][:EPISODIO])
   */
  async handleMalRequest(malIdString: string): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) {
      return { streams: [] };
    }
    try {
      const request = resolveMappingRequest(malIdString);
      if (!request) return { streams: [] };
      const englishTitle = await getEnglishTitleFromAnyId(request.id, 'mal', this.config.tmdbApiKey);
      debug(2, 'AnimeUnity', `[AnimeUnity] Ricerca con titolo inglese: ${englishTitle}`);
      return this.handleTitleRequest(englishTitle, request.season, request.episode, request.isMovie);
    } catch (error) {
      console.error('Error handling MAL request:', error);
      return { streams: [] };
    }
  }

  /**
   * Split-cour safety net: on a mapping miss never search the base series title
   * with an external episode number. Use the official season title, or nothing.
   */
  private async handleUnmappedSeries(
    request: MappingRequest | null,
    episodeNumber: number | null
  ): Promise<{ streams: StreamForStremio[] } | null> {
    if (!request || request.isMovie) return null;
    const season = request.season ?? 1;
    if (season <= 1) return null;
    const seasonTitle = await resolveSeasonFallbackTitle(request, this.config);
    if (!seasonTitle) {
      console.warn(`[AnimeUnity] Mapping miss for ${request.provider}:${request.id} S${season}E${episodeNumber}: no season title, returning no stream`);
      return { streams: [] };
    }
    console.warn(`[AnimeUnity] Mapping miss for ${request.provider}:${request.id} S${season}E${episodeNumber}: using season title "${seasonTitle}"`);
    return this.handleTitleRequest(seasonTitle, season, episodeNumber, false);
  }

  async handleImdbRequest(imdbId: string, seasonNumber: number | null, episodeNumber: number | null, isMovie = false): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) {
      return { streams: [] };
    }
    try {
      const gateEnabled = (process.env.ANIME_GATE_ENABLED || 'true') !== 'false';
      if (gateEnabled) {
        const gate = await checkIsAnimeById('imdb', imdbId, this.config.tmdbApiKey, isMovie ? 'movie' : 'tv');
        if (!gate.isAnime) {
          debug(2, 'AnimeUnity', `[AnimeUnity] Skipping anime search: no MAL/Kitsu mapping (${gate.reason}) for ${imdbId}`);
          return { streams: [] };
        }
      }
      const request = resolveMappingRequest(imdbId, seasonNumber, episodeNumber, isMovie);
      if (request) {
        const target = await resolveAnimeTarget(request, this.config);
        const title = target ? target.title || (await getKitsuTitle(target.kitsuId)) : '';
        if (target && title) {
          return this.handleTitleRequest(title, target.displaySeason, target.kitsuEpisode, request.isMovie, target.titleAlt);
        }
      }
      const unmapped = await this.handleUnmappedSeries(request, episodeNumber);
      if (unmapped) return unmapped;
      const englishTitle = await getEnglishTitleFromAnyId(imdbId, 'imdb', this.config.tmdbApiKey);
      debug(2, 'AnimeUnity', `[AnimeUnity] Ricerca con titolo inglese: ${englishTitle}`);
      return this.handleTitleRequest(englishTitle, seasonNumber, episodeNumber, isMovie);
    } catch (error) {
      console.error('Error handling IMDB request:', error);
      return { streams: [] };
    }
  }

  async handleTmdbRequest(tmdbId: string, seasonNumber: number | null, episodeNumber: number | null, isMovie = false): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) {
      return { streams: [] };
    }
    try {
      const gateEnabled = (process.env.ANIME_GATE_ENABLED || 'true') !== 'false';
      if (gateEnabled) {
        const gate = await checkIsAnimeById('tmdb', tmdbId, this.config.tmdbApiKey, isMovie ? 'movie' : 'tv');
        if (!gate.isAnime) {
          debug(2, 'AnimeUnity', `[AnimeUnity] Skipping anime search: no MAL/Kitsu mapping (${gate.reason}) for TMDB ${tmdbId}`);
          return { streams: [] };
        }
      }
      const request = resolveMappingRequest(`tmdb:${tmdbId}`, seasonNumber, episodeNumber, isMovie);
      if (request) {
        const target = await resolveAnimeTarget(request, this.config);
        const title = target ? target.title || (await getKitsuTitle(target.kitsuId)) : '';
        if (target && title) {
          return this.handleTitleRequest(title, target.displaySeason, target.kitsuEpisode, request.isMovie, target.titleAlt);
        }
      }
      const unmapped = await this.handleUnmappedSeries(request, episodeNumber);
      if (unmapped) return unmapped;
      const englishTitle = await getEnglishTitleFromAnyId(tmdbId, 'tmdb', this.config.tmdbApiKey);
      debug(2, 'AnimeUnity', `[AnimeUnity] Ricerca con titolo inglese: ${englishTitle}`);
      return this.handleTitleRequest(englishTitle, seasonNumber, episodeNumber, isMovie);
    } catch (error) {
      console.error('Error handling TMDB request:', error);
      return { streams: [] };
    }
  }

  async handleTvdbRequest(tvdbId: string, seasonNumber: number | null, episodeNumber: number | null, isMovie = false): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) {
      return { streams: [] };
    }
    try {
      const gateEnabled = (process.env.ANIME_GATE_ENABLED || 'true') !== 'false';
      if (gateEnabled) {
        const gate = await checkIsAnimeById('tvdb', tvdbId, this.config.tmdbApiKey, isMovie ? 'movie' : 'tv');
        if (!gate.isAnime) {
          debug(2, 'AnimeUnity', `[AnimeUnity] Skipping anime search: no Kitsu mapping (${gate.reason}) for TVDB ${tvdbId}`);
          return { streams: [] };
        }
      }
      const request = resolveMappingRequest(`tvdb:${tvdbId}`, seasonNumber, episodeNumber, isMovie);
      if (request) {
        const target = await resolveAnimeTarget(request, this.config);
        const title = target ? target.title || (await getKitsuTitle(target.kitsuId)) : '';
        if (target && title) {
          return this.handleTitleRequest(title, target.displaySeason, target.kitsuEpisode, request.isMovie, target.titleAlt);
        }
      }
      const unmapped = await this.handleUnmappedSeries(request, episodeNumber);
      if (unmapped) return unmapped;
      const fallbackTitle = await getTvdbTitle(tvdbId, this.config);
      if (!fallbackTitle) return { streams: [] };
      debug(2, 'AnimeUnity', `[AnimeUnity] Ricerca con titolo TVDB: ${fallbackTitle}`);
      return this.handleTitleRequest(fallbackTitle, seasonNumber, episodeNumber, isMovie);
    } catch (error) {
      console.error('Error handling TVDB request:', error);
      return { streams: [] };
    }
  }

  async handleTitleRequest(title: string, seasonNumber: number | null, episodeNumber: number | null, isMovie = false, titleAlt?: string | null): Promise<{ streams: StreamForStremio[] }> {
    debug(1, 'AnimeUnity', 'title request', { title, titleAlt, season: seasonNumber, episode: episodeNumber, isMovie });
    const universalTitle = applyUniversalAnimeTitleNormalization(title);
    const normalizedTitle = normalizeTitleForSearch(universalTitle);
    if (universalTitle !== title) {
      debug(3, 'AnimeUnity', `[UniversalTitle][Applied] ${title} -> ${universalTitle}`);
    }
    debug(2, 'AnimeUnity', `[AnimeUnity] Titolo normalizzato per ricerca: ${normalizedTitle}`);
    // Romaji MAL: alcuni record del sito non hanno name_eng e il titolo inglese
    // non supera la soglia. Entra solo se l'inglese non trova nulla: prima nel
    // filtro, poi (se il sito non ha risposto) come query di ripiego.
    const altQuery = titleAlt && titleAlt !== normalizedTitle ? titleAlt : '';
    const queryTitles = [normalizedTitle];
    // Se il titolo originale è una chiave dell'exactMap allora saltiamo qualsiasi filtro successivo:
    // l'intento dell'utente è: se la ricerca parte da una chiave exactMap, NON applicare filterAnimeResults
    const skipFilter = Object.prototype.hasOwnProperty.call(exactMap, title);
    if (skipFilter) {
      debug(3, 'AnimeUnity', `[AnimeUnity][ExactMap] Skip filtro: titolo di input corrisponde a chiave exactMap -> "${title}"`);
    }
    let animeVersions = await this.searchAllVersions(normalizedTitle);
    // Budget ricerca <=2 fetch: una sola ricerca di ripiego, il romaji se c'è
    // (molti record sono indicizzati solo così), altrimenti le varianti storiche.
    let usedFallbackSearch = false;
    if (!animeVersions.length) {
      const candidates = [
        altQuery,
        normalizedTitle.includes("'") ? normalizedTitle.replace(/'/g, "") : '',
        normalizedTitle.includes("(") ? normalizedTitle.split("(")[0].trim() : '',
        normalizedTitle.split(" ").length > 3 ? normalizedTitle.split(" ").slice(0, 3).join(" ") : '',
      ].filter(q => q && q !== normalizedTitle);
      if (candidates.length) {
        usedFallbackSearch = true;
        animeVersions = await this.searchAllVersions(candidates[0]);
      }
    }
    if (!skipFilter) {
      const rawVersions = animeVersions;
      animeVersions = filterAnimeResults(rawVersions, queryTitles);
      if (!animeVersions.length && altQuery) {
        queryTitles.push(altQuery);
        animeVersions = filterAnimeResults(rawVersions, queryTitles);
        if (animeVersions.length) {
          debug(2, 'AnimeUnity', `[AnimeUnity] Match con titolo alternativo "${altQuery}"`);
        }
      }
    } else {
      debug(3, 'AnimeUnity', '[AnimeUnity][ExactMap] Uso risultati grezzi senza filtro (exactMap).');
      // STRICT EXACT FILTER: per le richieste exactMap, manteniamo SOLO i risultati
      // il cui nome base NON contiene parole extra rispetto agli altri risultati dello stesso gruppo.
      // Esempio: se troviamo "Final Season" e "Final Season Parte 2", teniamo solo i primi.
      // IMPORTANTE: AnimeUnity restituisce nomi in italiano, quindi confrontiamo i risultati tra loro,
      // non con il titolo inglese di input.
      try {
        const before = animeVersions.length;
        debug(4, 'AnimeUnity', `[AnimeUnity][ExactMap][StrictFilter] Risultati da filtrare (${before}):`);

        // Estrai i nomi base (senza parentesi) di tutti i risultati
        const baseNames = animeVersions.map(v => {
          const base = v.version.name
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
          debug(4, 'AnimeUnity', `  name="${v.version.name}" -> base="${base}"`);
          return base;
        });

        // Trova il nome più corto (quello senza "Parte 2", "Part 2", ecc.)
        const sortedByLength = [...baseNames].sort((a, b) => a.length - b.length);
        const shortestBase = sortedByLength[0];
        debug(4, 'AnimeUnity', `[AnimeUnity][ExactMap][StrictFilter] Nome base più corto (target): "${shortestBase}"`);

        // Filtra: mantieni solo i risultati che matchano esattamente il nome più corto
        animeVersions = animeVersions.filter((v, idx) => {
          const match = baseNames[idx] === shortestBase;
          debug(4, 'AnimeUnity', `  [${idx}] "${v.version.name}" -> match=${match}`);
          return match;
        });

        debug(4, 'AnimeUnity', `[AnimeUnity][ExactMap][StrictFilter] DOPO filtro: ${animeVersions.length} risultati rimasti`);
      } catch (e) {
        console.warn('[AnimeUnity][ExactMap][StrictFilter] errore:', (e as any)?.message || e);
      }
    }
    if (!animeVersions.length && !skipFilter && !usedFallbackSearch) {
      // Budget ricerca <=2 fetch: una sola query di ripiego. Il romaji batte
      // le varianti storiche: i siti spesso indicizzano solo quello.
      const [fallbackQuery] = [altQuery, ...buildTitleFallbackQueries(normalizedTitle)].filter(q => q && q !== normalizedTitle);
      if (fallbackQuery) {
        const fallbackVersions = filterAnimeResults(await this.searchAllVersions(fallbackQuery), queryTitles);
        if (fallbackVersions.length) {
          debug(2, 'AnimeUnity', `[AnimeUnity] Trovato con query di ripiego: ${fallbackQuery}`);
          animeVersions = fallbackVersions;
        }
      }
    }
    if (!animeVersions.length) {
      console.warn('[AnimeUnity] Nessun risultato trovato per il titolo:', normalizedTitle);
      return { streams: [] };
    }
    const streams: StreamForStremio[] = [];
    const seenLinks = new Set();
    for (const { version } of animeVersions) {
      // .co tipizza le schede: un film non è l'episodio di una serie.
      if (!isMovie && version.type === 'Movie') continue;
      const cleanName = version.name
        .replace(/\s*\(ITA\)/i, '')
        .replace(/\s*\(CR\)/i, '')
        .replace(/ITA/gi, '')
        .replace(/CR/gi, '')
        .trim();
      const path = normalizeAnimePath(`/anime/${version.id}-${version.slug}`);
      if (!path) continue;
      const perVersion = await this.extractStreamsFromAnimePath(
        path,
        episodeNumber,
        seasonNumber,
        isMovie,
        cleanName
      );
      for (const st of perVersion) {
        if (!st || !st.url) continue;
        if (seenLinks.has(st.url)) continue;
        streams.push(st);
        seenLinks.add(st.url);
      }
    }

    // .co: se l'archivio non ha restituito la scheda ITA della stessa serie
    // (es. One Piece), il link è nella pagina SUB appena letta (cache, 0 fetch).
    if (isUnityCoBase() && !isMovie && !streams.some(s => /ITA/.test(String(s.title || '')))) {
      const subVersion = animeVersions.find(v => !/-ita$/i.test(v.version.slug || ''));
      if (subVersion) {
        const subPath = normalizeAnimePath(`/anime/${subVersion.version.id}-${subVersion.version.slug}`);
        const subUrl = subPath ? buildUnityUrl(subPath) : null;
        if (subPath && subUrl) {
          const html = String(await auFetchResource(subUrl, caches, {
            ttlMs: TTL.animePage,
            cacheKey: `au-anime:${subPath}`,
            timeoutMs: FETCH_TIMEOUT,
          }).catch(() => '') || '');
          const itaPath = findUnityCoItaSibling(html, subPath);
          if (itaPath) {
            const cleanName = subVersion.version.name
              .replace(/\s*\(ITA\)/i, '')
              .replace(/\s*\(CR\)/i, '')
              .replace(/ITA/gi, '')
              .replace(/CR/gi, '')
              .trim();
            const extra = await this.extractStreamsFromAnimePath(itaPath, episodeNumber, seasonNumber, isMovie, cleanName);
            for (const st of extra) {
              if (!st || !st.url || seenLinks.has(st.url)) continue;
              streams.push(st);
              seenLinks.add(st.url);
            }
            if (extra.length) debug(2, 'AnimeUnity', `[AnimeUnity] Scheda ITA recuperata dalla pagina SUB: ${itaPath}`);
          }
        }
      }
    }
    debug(1, 'AnimeUnity', 'streams', {
      title: normalizedTitle,
      count: streams.length,
      season: seasonNumber,
      episode: episodeNumber,
      isMovie,
    });
    return { streams };
  }
}

// Funzione di utilità per capitalizzare la prima lettera
function capitalize(str: string) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
