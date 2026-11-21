import { normalizeBool } from '../config.js';
import { getDomain } from '../utils/domains.js';
import { debug, redactUrl } from '../utils/logger.js';
import { buildEasyProxyHlsUrl } from '../utils/easyproxy.js';
import {
  decodeHtmlAttribute,
  parseEpisodesFromAnimeHtml,
  parseEpisodeServers,
  parseSearchResultsHtml,
  parseVixcloudHls,
  hlsHeightFromUrl,
  mp4HeightFromUrl,
  vixsrcEmbedUrl,
  selectHighestHlsVariantInfo,
} from './animeunity-parsers.js';
import type { AnimeUnityPageEpisode } from './animeunity-parsers.js';
import { AnimeUnityConfig, StreamForStremio } from '../types/animeunity.js';
import * as cheerio from 'cheerio';
import { checkIsAnimeById, applyUniversalAnimeTitleNormalization } from '../utils/animeGate.js';
import { providerLabel } from '../utils/unifiedNames.js';
import { lookupTitle, REVIEW_SCORE, type CatalogQueryOptions } from '../catalog/matcher.js';
import {
  buildTitleFallbackQueries,
  stripPartNumeral,
  matchKeys,
  normalizeTitleForSearch as normalizeAnimeTitleForSearch,
  sameQuery,
  titleMatchScoreAny,
  type TitleNormalizationOptions,
} from '../utils/anime-title-normalization.js';
import {
  createCaches,
  invalidateCached,
  DEFAULT_FETCH_TIMEOUT,
  fetchResource,
  markProviderFetchFailure,
  getProviderUrl,
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
  qualityTag,
  italianSeasonQuery,
  pickBestScored,
  isAbortOrTimeoutError,
  proxyAgentFor,
  resolveKitsuRequest,
  resolveMalRequest,
  resolveImdbRequest,
  resolveTmdbRequest,
  resolveTvdbRequest,
  type TitleResolutionContext,
  seasonFromTitle,
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

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

const FETCH_TIMEOUT = DEFAULT_FETCH_TIMEOUT;
/**
 * Le pagine e i link firmati durano a lungo: l'embed non ha token e il playlist
 * che contiene scade dopo due mesi. Sei ore coprono una sessione senza rifare
 * il fan-out; la ricerca sta a dodici come Saturn e World.
 */
const TTL = {
  http: 12 * 60 * 60 * 1000,
  animePage: 6 * 60 * 60 * 1000,
  streamPage: 6 * 60 * 60 * 1000,
  mapping: 2 * 60 * 1000,
};

const caches = createCaches();

const DIRECT_TIMEOUT = 3000; // timeout breve per tentativo diretto (senza proxy)
const PROXY_CONFIGS = [
  { label: 'AU_PROXY', url: String(process.env.AU_PROXY || '').trim() },
  { label: 'globale', url: String(process.env.PROXY || '').trim() },
]
  .filter((entry, index, all) => entry.url && all.findIndex((other) => other.url === entry.url) === index)
  .flatMap((entry) => {
    try {
      const isSocks = entry.url.startsWith('socks');
      return [{
        ...entry,
        type: isSocks ? 'SOCKS' : 'HTTP/HTTPS',
        // fetchResource usa undici per HTTP(S), node-fetch per SOCKS.
        // Unica factory: e' quella che imposta keepAlive sugli agent SOCKS.
        // Creandolo qui senza, ogni richiesta pagava TCP + SOCKS5 + TLS.
        agent: proxyAgentFor(entry.url),
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
 * fetchResource wrapper: usa AU_PROXY, poi il PROXY globale, poi il diretto.
 * I proxy valgono appena sono impostati (ricerca e pagine di riproduzione).
 */
export async function auFetchResource(url: string, providerCaches: any, options: any = {}): Promise<any> {
  const attempts = [
    ...PROXY_CONFIGS.map((proxy) => ({
      label: `proxy ${proxy.label} ${proxy.type}`,
      agent: proxy.agent,
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
        exitLabel: attempt.agent ? attempt.label : 'diretto',
        timeoutMs: attempt.timeoutMs,
      });
      debug(4, 'AnimeUnity', `[AnimeUnity][Proxy] fetchResource ${attempt.label} OK <- ${redactUrl(url)}`);
      return result;
    } catch (error: any) {
      lastError = error;
      console.warn(`[AnimeUnity][Proxy] fetchResource ${attempt.label} FALLITO: ${error?.message || error} <- ${redactUrl(url)}`);
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
  type?: string; // Solo .cx: `tv`, `movie`, `tv_short` (minuscolo, come lo manda il sito)
  /** Solo .cx: la scheda ha una variante `ita` fra le `variants[]`. */
  language?: 'ITA';
  /** Dal catalogo: coppie [numero, id] degli episodi, evita la pagina scheda. */
  ep?: [number, number | string][];
}

interface AnimeUnityStreamData {
  episode_page: string | null;
  embed_url: string | null;
  hls_url: string | null;
  mp4_url: string | null;
  /** Altezza della variante HLS scelta, null se non dichiarata. */
  height: number | null;
  /** Il player dichiara canPlayFHD: usato quando il manifest non viene scaricato. */
  fhd?: boolean;
}

/**
 * `www.animeunity.cx` non esiste (connessione fallita): il dominio buono è
 * l'apex. Il vecchio `.co` è un guscio che fa 301 su `.cx`, quindi un config
 * fermo lì si riporta al sito nuovo invece di pagare due redirect per richiesta.
 */
export function unityBaseFrom(raw: string): string {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const u = new URL(withScheme);
    if (/(^|\.)animeunity\.co$/i.test(u.hostname)) u.hostname = 'animeunity.cx';
    return u.origin;
  } catch {
    const host = value.replace(/^https?:\/\//i, '');
    if (!host) return 'https://animeunity.at';
    return `https://${host}`;
  }
}

function getUnityBaseUrl(): string {
  const configured = getProviderUrl('animeunity');
  return unityBaseFrom(String(configured || getDomain('animeunity') || 'animeunity.at'));
}

/**
 * `.cx` è il sito nuovo (Laravel + Inertia): ricerca su `api/archive?query=`,
 * episodi su `api/anime/{id}/episodes`, embed con una richiesta parziale
 * Inertia. Tutto il resto del provider resta uguale.
 */
function isUnityCx(): boolean {
  try {
    return /(^|\.)animeunity\.cx$/i.test(new URL(getUnityBaseUrl()).hostname);
  } catch {
    return false;
  }
}

/**
 * La `X-Inertia-Version` è obbligatoria per le richieste parziali: senza, il
 * sito risponde 409. Cambia a ogni deploy, quindi si cacha e si rinnova una
 * volta sola quando il 409 arriva.
 */
let inertiaVersion = '';
let inertiaVersionAt = 0;
const INERTIA_VERSION_TTL = 6 * 60 * 60 * 1000;

async function getInertiaVersion(force = false): Promise<string> {
  if (!force && inertiaVersion && Date.now() - inertiaVersionAt < INERTIA_VERSION_TTL) return inertiaVersion;
  // `/login` è la pagina Inertia più piccola (62 KB) che porta la version nel
  // `data-page`: una scheda ne costa 226.
  const key = 'au-cx-version';
  if (force) invalidateCached(caches, key);
  try {
    const html = String(await auFetchResource(`${getUnityBaseUrl()}/login`, caches, {
      ttlMs: 60_000,
      cacheKey: key,
      timeoutMs: FETCH_TIMEOUT,
    }) || '');
    const raw = html.match(/data-page="([^"]+)"/)?.[1];
    const version = raw ? String(JSON.parse(decodeHtmlAttribute(raw))?.version || '') : '';
    if (version) {
      inertiaVersion = version;
      inertiaVersionAt = Date.now();
    }
  } catch (error: any) {
    console.warn('[AnimeUnity][cx] version Inertia non letta:', error?.message || String(error));
  }
  return inertiaVersion;
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

async function searchEndpoint(query: string): Promise<AnimeUnitySearchResult[]> {
  if (isUnityCx()) return searchUnityCx(query);
  if (searchCooldownUntil > Date.now()) {
    // Il cooldown locale azzera la ricerca per 60 s: senza questa riga il log a
    // valle diceva "Nessun risultato trovato", cioè la causa sbagliata.
    console.warn(`[AnimeUnity] Ricerca in pausa per 429 (${Math.ceil((searchCooldownUntil - Date.now()) / 1000)}s residui): nessuna richiesta inviata`);
    // La ricerca non è avvenuta: non è "questo titolo non c'è", quindi il vuoto
    // non deve finire nella cache negativa (90 s > cooldown 60 s).
    markProviderFetchFailure();
    return [];
  }

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
    const message = String(error?.message || error);
    // Il sito throttla aggressivamente: evita la catena di fallback per un minuto.
    if (/\b429\b/.test(message)) {
      searchCooldownUntil = Date.now() + 60_000;
      console.warn('[AnimeUnity] Ricerca in rate limit (429): pausa 60s');
    } else if (/\b403\b/.test(message) || isAbortOrTimeoutError(error)) {
      // Un blocco WAF o un timeout non sono "titolo non trovato": senza questa
      // riga il sintomo a valle era "Nessun risultato trovato per il titolo".
      console.warn(`[AnimeUnity] Ricerca fallita (${/\b403\b/.test(message) ? '403 WAF' : 'timeout'}): ${message}`);
    } else if (/cooldown/i.test(message)) {
      // Rifiuto del cooldown condiviso (net-policy): nessuna richiesta inviata.
      // Per 10 minuti dopo un 403 la ricerca sembrerebbe vuota senza dirlo.
      console.warn(`[AnimeUnity] Ricerca rifiutata dal cooldown: ${message}`);
    }
    return [];
  }

  const hits = parseSearchResultsHtml(String(payload?.result?.html || ''));
  if (!hits.length) {
    // La risposta vuota non è "questo titolo non c'è": il titolo aggiunto al
    // sito resta invisibile fino a 12 h. La voce si toglie, non si ricacha.
    invalidateCached(caches, `au-search:${query}`, 'json');
  }
  return hits.map((hit) => ({
    ...hit,
    name_it: hit.name,
    name_eng: '',
  }));
}

/**
 * `api/archive?query=` è la ricerca vera del sito nuovo: JSON, paginata, e
 * attraversa romaji, inglese e italiano (gli accenti non contano). `api/search`
 * si ferma a 20 risultati e non pagina, quindi non si usa.
 */
async function searchUnityCx(query: string): Promise<AnimeUnitySearchResult[]> {
  try {
    const payload = await auFetchResource(
      `${getUnityBaseUrl()}/api/archive?query=${encodeURIComponent(query)}`,
      caches,
      {
        as: 'json',
        ttlMs: TTL.http,
        cacheKey: `au-cx-search:${query}`,
        timeoutMs: FETCH_TIMEOUT,
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      }
    ) as any;

    const records: any[] = Array.isArray(payload?.data) ? payload.data : [];
    if (!records.length) {
      // La ricerca vuota non resta 12 ore in cache: il titolo appena aggiunto
      // al sito deve comparire.
      invalidateCached(caches, `au-cx-search:${query}`, 'json');
      return [];
    }

    return records
      .filter((record) => record && record.id && record.slug)
      .map((record) => ({
        id: Number(record.id),
        slug: String(record.slug),
        name: String(record.title || record.title_it || record.title_ja || '').trim(),
        name_it: record.title_it ? String(record.title_it) : undefined,
        episodes_count: Number(record.total_episodes) || 0,
        type: record.type ? String(record.type) : undefined,
        ...(Array.isArray(record.variants) &&
        record.variants.some((variant: any) => String(variant?.language || '').toLowerCase() === 'ita')
          ? { language: 'ITA' as const }
          : {}),
      }))
      .filter((record) => record.name);
  } catch (error: any) {
    console.warn('[AnimeUnity][cx] ricerca fallita:', error?.message || error);
    return [];
  }
}

interface AnimeUnityCxEpisode {
  number: number;
  /** Un video per lingua: l'id nell'URL dell'episodio è quello del video. */
  videos: { id: number; language: 'sub' | 'dub' }[];
}

/**
 * `api/anime/{id}/episodes?start=N` dà 120 episodi per blocco (271 B su una
 * serie da 1, 37 KB su One Piece), ognuno con i video per lingua. `page`,
 * `offset` e `tab_size` sono ignorati dal sito: l'unico parametro è `start`.
 */
async function fetchUnityCxEpisodes(
  animeId: number,
  episode: number | null,
  /** `true` scarta la voce in cache: un episodio uscito dopo la lettura non c'è. */
  force = false
): Promise<AnimeUnityCxEpisode[]> {
  const start = episode && episode > 120 ? Math.max(1, episode - 119) : 1;
  const cacheKey = `au-cx-episodes:${animeId}:${start}`;
  // La lista cambia a ogni episodio, il resto delle pagine no: la cache resta
  // 6 h, ma sul miss si rilegge (vedi `extractStreamsFromAnimePath`).
  if (force) invalidateCached(caches, cacheKey, 'json');
  try {
    const payload = await auFetchResource(
      `${getUnityBaseUrl()}/api/anime/${animeId}/episodes?start=${start}`,
      caches,
      {
        as: 'json',
        ttlMs: TTL.animePage,
        cacheKey,
        timeoutMs: FETCH_TIMEOUT,
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      }
    ) as any;

    return (payload?.episodes || [])
      .map((entry: any) => ({
        number: parseEpisodeNumber(entry?.number, 0),
        videos: (entry?.videos || [])
          .map((video: any) => ({
            id: Number(video?.id) || 0,
            // `jpn` è la traccia sottotitolata, `ita` quella doppiata.
            language: (String(video?.language || '').toLowerCase() === 'ita' ? 'dub' : 'sub') as 'sub' | 'dub',
          }))
          .filter((video: { id: number }) => video.id > 0),
      }))
      .filter((entry: AnimeUnityCxEpisode) => entry.number > 0 && entry.videos.length > 0);
  } catch (error: any) {
    console.warn('[AnimeUnity][cx] episodi non recuperati:', error?.message || error);
    return [];
  }
}

/**
 * L'embed URL di un episodio. La pagina `/anime/<id>-<slug>/<videoId>` costa
 * 226 KB, ma con gli header Inertia e `Partial-Data: embedUrl` la stessa URL
 * risponde **314 B** di JSON. Il token dentro l'URL cambia a ogni richiesta
 * (misurato: due token diversi a un minuto di distanza), quindi la cache resta
 * quella delle altre pagine, 6 h.
 */
async function fetchUnityCxEmbed(animeId: number, animeSlug: string, videoId: number): Promise<string | null> {
  const pageUrl = `${getUnityBaseUrl()}/anime/${animeId}-${animeSlug}/${videoId}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const version = await getInertiaVersion(attempt > 0);
    try {
      const payload = await auFetchResource(pageUrl, caches, {
        as: 'json',
        ttlMs: TTL.streamPage,
        cacheKey: `au-cx-embed:${videoId}`,
        timeoutMs: FETCH_TIMEOUT,
        headers: {
          'X-Inertia': 'true',
          'X-Inertia-Version': version,
          'X-Inertia-Partial-Component': 'Anime',
          'X-Inertia-Partial-Data': 'embedUrl',
          Accept: 'application/json, text/html;q=0.9',
        },
      }) as any;
      const embed = String(payload?.props?.embedUrl || '').trim();
      if (/^https?:\/\//i.test(embed)) return embed;
      return null;
    } catch (error: any) {
      // 409 = version cambiata a ogni deploy: si rinnova una volta e si ritenta.
      const message = String(error?.message || error);
      if (/\b409\b/.test(message) && attempt === 0) continue;
      console.warn('[AnimeUnity][cx] embed non recuperato:', message);
      return null;
    }
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
  episodePage: string,
  /** false in modalità proxy: EasyProxy rifà max_res, il manifest qui è sprecato. */
  needVariant = true
): Promise<{ hls_url: string | null; mp4_url: string | null; height: number | null; fhd?: boolean }> {
  let hlsUrl: string | null = null;
  let mp4Url: string | null = null;
  let hlsHeight: number | null = null;

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
      const renditionHeight = hlsHeightFromUrl(hlsUrl);
      if (renditionHeight) {
        // Playlist già ristretta a una rendition: l'addon non la scarica. Il
        // token vixcloud è legato all'IP del primo che la chiede, quindi deve
        // restare al client (o a EasyProxy), non consumarlo qui.
        hlsHeight = renditionHeight;
      } else if (needVariant) {
        try {
          const manifest = String(await fetchPage(hlsUrl) || '');
          const highest = selectHighestHlsVariantInfo(manifest, hlsUrl);
          if (highest) {
            hlsUrl = highest.url;
            hlsHeight = highest.height;
            debug(4, 'AnimeUnity', '[AnimeUnity] Variante HLS massima selezionata');
          }
        } catch (error: any) {
          console.warn('[AnimeUnity] Selezione variante HLS fallita:', error?.message || error);
        }
      }
    }
  } catch (error: any) {
    console.warn('[AnimeUnity] embed media failed:', error?.message || error);
  }

  // In proxy il manifest non si scarica, ma `canPlayFHD` è sempre true: il badge
  // verrebbe FHD anche su un 360p. La risoluzione del file MP4 è l'unico dato
  // vero disponibile senza la playlist, e coincide con la rendition massima.
  const height = hlsHeight || (needVariant ? null : mp4HeightFromUrl(mp4Url));
  // `h=1` resta il ripiego solo se la risoluzione è ignota: con `height` noto
  // deciderebbe `qualityTag`, e `h=1` direbbe FHD su un 360p.
  const fhd = !height && !needVariant && Boolean(hlsUrl && /[?&]h=1(?:&|$)/.test(hlsUrl));
  return { hls_url: hlsUrl, mp4_url: mp4Url, height, fhd };
}

async function getStreamData(
  animeId: number,
  animeSlug: string,
  episodeId: number,
  language: 'sub' | 'dub',
  needVariant = true
): Promise<AnimeUnityStreamData> {
  if (isUnityCx()) return getUnityCxStreamData(animeId, animeSlug, episodeId, needVariant);
  const episodePage = `${getUnityBaseUrl()}/anime/${animeId}-${animeSlug}/ep-${episodeId}`;
  const empty: AnimeUnityStreamData = { episode_page: episodePage, embed_url: null, hls_url: null, mp4_url: null, height: null };

  try {
    const html = await auFetchResource(episodePage, caches, {
      ttlMs: TTL.streamPage,
      cacheKey: `au-ep:${animeId}:${episodeId}`,
      timeoutMs: FETCH_TIMEOUT,
    }).catch((error: any) => {
      // Senza questa riga un 403/timeout diventava "nessuno stream" senza traccia.
      console.warn('[AnimeUnity] pagina episodio non recuperata:', error?.message || String(error));
      return '';
    });

    const candidates = parseEpisodeServers(String(html || ''), episodeId)
      .filter((server) => server.type === language);
    const server = candidates.find((entry) => entry.host === 'vixcloud') || candidates[0];
    if (!server) {
      // L'episodio c'è ma nessun server in quella lingua: è un cambiamento del
      // sito, non "episodio non trovato". Senza log la causa restava invisibile.
      console.warn(`[AnimeUnity][Stream] nessun server ${language} per l'episodio ${episodeId}`);
      return empty;
    }

    const embedUrl = await resolveServerEmbedUrl(server.linkId, episodePage);
    if (!embedUrl) {
      console.warn(`[AnimeUnity][Stream] embed non risolto per l'episodio ${episodeId}`);
      return empty;
    }

    const media = await resolveEmbedMedia(embedUrl, episodePage, needVariant);
    return { ...empty, embed_url: embedUrl, ...media };
  } catch (error: any) {
    console.warn('[AnimeUnity] getStreamData failed:', error?.message || error);
    return empty;
  }
}

async function getUnityCxStreamData(
  animeId: number,
  animeSlug: string,
  videoId: number,
  needVariant = true
): Promise<AnimeUnityStreamData> {
  const episodePage = `${getUnityBaseUrl()}/anime/${animeId}-${animeSlug}/${videoId}`;
  const empty: AnimeUnityStreamData = { episode_page: episodePage, embed_url: null, hls_url: null, mp4_url: null, height: null };
  const embedUrl = await fetchUnityCxEmbed(animeId, animeSlug, videoId);
  if (!embedUrl) return empty;
  const media = await resolveEmbedMedia(embedUrl, episodePage, needVariant);
  return { ...empty, embed_url: embedUrl, ...media };
}

/** Catalogo locale: zero richieste quando il titolo c'è. */
function catalogUnityVersions(
  queries: string[],
  options: CatalogQueryOptions
): { version: AnimeUnitySearchResult; language_type: string }[] {
  const versions: { version: AnimeUnitySearchResult; language_type: string }[] = [];
  for (const hit of lookupTitle('unity', queries, options).hits) {
    const id = Number(String(hit.slug).split('-')[0]);
    const slug = String(hit.slug).replace(/^\d+-/, '');
    if (!Number.isFinite(id) || id <= 0 || !slug) continue;
    versions.push({
      version: {
        id,
        slug,
        name: hit.title,
        episodes_count: 0,
        ...(hit.type ? { type: hit.type } : {}),
        ...(hit.ep?.length ? { ep: hit.ep } : {}),
      },
      language_type: hit.language,
    });
  }
  return versions;
}

function filterAnimeResults(
  results: { version: AnimeUnitySearchResult; language_type: string }[],
  queryTitles: string[],
  isMovie = false
) {
  // Per un film il sottotitolo è parte dell'identità: un ripiego troncato
  // ("Jujutsu Kaisen" da "Jujutsu Kaisen: Execution") non deve far accettare
  // l'opera madre al posto del film.
  const tokensOf = (value: string) => matchKeys(value).tokens;
  const isTruncationOf = (short: string, full: string) => {
    const s = tokensOf(short);
    const f = tokensOf(full);
    return s.length > 0 && s.length < f.length && s.every((token, i) => token === f[i]);
  };
  const scoringTitles = isMovie
    ? queryTitles.filter((title) => !isTruncationOf(title, queryTitles[0] || ''))
    : queryTitles;
  const scored = results.map((result) => {
    const titles = [result.version.name_eng || '', result.version.name_it || '', result.version.name || ''].filter(Boolean);
    const score = Math.max(0, ...titles.map((title) => titleMatchScoreAny(scoringTitles, title)));
    return { result, score };
  }).filter((entry) => entry.score > 0);
  const filtered = pickBestScored(scored, REVIEW_SCORE);

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









  // Sui tre siti la 2ª stagione è listata in italiano ("The Melancholy of Haruhi
  // Suzumiya (2009)" è solo il titolo inglese della scheda). La ricerca con questo
  // nome restituisce una sola scheda, quindi il filtro titoli non serve.
  "The Melancholy of Haruhi Suzumiya Season 2": "La malinconia di Haruhi Suzumiya 2",

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
    titleOverride?: string,
    /** Dal catalogo: coppie [numero, id] che evitano la pagina della scheda. */
    catalogEp?: [number, number | string][]
  ): Promise<StreamForStremio[]> {
    const normalizedPath = normalizeAnimePath(animePath);
    if (!normalizedPath) return [];

    const animeUrl = buildUnityUrl(normalizedPath);
    if (!animeUrl) return [];

    const requestedEpisode = normalizeRequestedEpisode(requestedEpisodeInput);
    const { animeId, animeSlug } = extractAnimeIdSlugFromPath(normalizedPath);
    if (!animeId || !animeSlug) return [];

    // Catalogo: con le coppie [numero, id] la pagina della scheda non serve.
    // E' un hop sull'host AnimeUnity, cioe' 2 s di pacing. Su .cx non si usa:
    // quegli id sono id episodio, mentre l'URL vuole l'id del video.
    const catalogEpisodes = !isUnityCx() && catalogEp?.length
      ? normalizeEpisodesList(
          catalogEp.map(([num, id]) => ({ num, episodeId: id, link: null, fileName: null, embedUrl: null })),
          getUnityBaseUrl()
        )
      : [];
    const fromCatalog = pickEpisodeEntry(catalogEpisodes, requestedEpisode, isMovie ? 'movie' : 'tv');

    let displayTitle = titleOverride || '';
    let selected = fromCatalog;
    let html = '';
    /** Solo .cx: l'id del video per lingua, cioè quello che va nell'URL. */
    let videoIds: Partial<Record<'sub' | 'dub', number>> | null = null;

    if (isUnityCx()) {
      let pageEpisodes = await fetchUnityCxEpisodes(animeId, requestedEpisode);
      let match = pageEpisodes.find((entry) => entry.number === requestedEpisode);
      if (!match) {
        // La lista viene dalla cache (6 h): l'episodio può essere uscito nel
        // frattempo. Si rilegge una volta sola prima di arrendersi, come su
        // AnimeWorld: senza, un episodio nuovo resta invisibile fino a scadenza.
        // Costo: una richiesta per play, e il fan-out negativo di 5 min la limita.
        pageEpisodes = await fetchUnityCxEpisodes(animeId, requestedEpisode, true);
        match = pageEpisodes.find((entry) => entry.number === requestedEpisode);
      }
      if (!match) {
        console.warn(
          `[AnimeUnity][cx] episodio ${requestedEpisode} non presente (scheda ${animeId}, ${pageEpisodes.length} episodi letti)`
        );
        return [];
      }
      videoIds = {};
      for (const video of match.videos) videoIds[video.language] = video.id;
      selected = pickEpisodeEntry(
        normalizeEpisodesList(
          [{
            num: match.number,
            episodeId: videoIds.sub || videoIds.dub || 0,
            link: null,
            fileName: null,
            embedUrl: null,
          }],
          getUnityBaseUrl()
        ),
        requestedEpisode,
        isMovie ? 'movie' : 'tv'
      );
      displayTitle = displayTitle || 'Unknown Title';
    } else if (!selected?.episodeId) {
      // `.at` (il sito vecchio, ancora vivo): la scheda porta episodi e titolo.
      html = String(await auFetchResource(animeUrl, caches, {
        ttlMs: TTL.animePage,
        cacheKey: `au-anime:${normalizedPath}`,
        timeoutMs: FETCH_TIMEOUT,
      }).catch((error: any) => {
        console.warn('[AnimeUnity] pagina scheda non recuperata:', error?.message || String(error));
        return '';
      }) || '');

      if (!html) return [];

      // Il DOM serve solo a leggere il titolo, e il titolo arriva quasi sempre
      // dal chiamante: costruirlo comunque costa ~46 ms su una pagina da 500 KB.
      if (!titleOverride) {
        const $ = cheerio.load(String(html));
        const pageTitle =
          $('meta[property="og:title"]').attr('content') ||
          $('title').first().text().trim() ||
          null;
        displayTitle = sanitizeAnimeTitle(pageTitle) || 'Unknown Title';
      }

      const pageEpisodes = parseEpisodesFromAnimeHtml(String(html));

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

      selected = pickEpisodeEntry(normalizedEpisodes, requestedEpisode, isMovie ? 'movie' : 'tv');
    } else {
      debug(3, 'AnimeUnity', '[AnimeUnity][Catalog] id episodio dal catalogo, nessuna pagina scheda');
      displayTitle = displayTitle || 'Unknown Title';
    }
    if (!selected?.episodeId) return [];

    const resolvedEpisodeNum = parsePositiveInt(selected.num) || requestedEpisode;
    const preferMp4 = /^(1|true|on)$/i.test(String(process.env.ANIMEUNITY_PREFER_MP4 || '0'));

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
    // Il badge FHD vive accanto al nome del provider, non nel titolo: qui il
    // nome viene deciso per singolo stream, perché dipende dalla variante HLS.
    const pushStream = (url: string, title: string, isFhd = false) => {
      if (!url || seenLinks.has(url)) return;
      seenLinks.add(url);
      streams.push({ title, url, name: providerLabel('animeunity', isFhd), behaviorHints: { notWebReady: true } });
    };

    // In proxy il manifest lo scarica EasyProxy con max_res: chiederlo qui costa
    // un hop (2 s di pacing) e consuma il token vixcloud legato al nostro IP.
    const needVariant = !(proxyWanted && this.config.proxyUrl.trim());

    // `.cx` dichiara le lingue nei `videos[]` dell'episodio: si servono quelle che
    // ci sono. `.at` le espone tutte e due sullo stesso episodio.
    const languages: ('sub' | 'dub')[] = isUnityCx()
      ? (['sub', 'dub'] as const).filter((language) => videoIds?.[language])
      : ['sub', 'dub'];
    // SUB e DUB in parallelo: gli hop sull'host AnimeUnity restano in fila per il
    // pacing, ma embed e manifest (host diversi) si sovrappongono. Il budget WAF
    // non cambia: paceHost serializza comunque per host.
    const episodeId = selected.episodeId;
    const streamResults = await Promise.all(
      languages.map((language) =>
        getStreamData(
          animeId,
          animeSlug,
          isUnityCx() ? videoIds![language]! : episodeId,
          language,
          needVariant
        ).catch(() => null)
      )
    );
    for (const [index, streamResult] of streamResults.entries()) {
      if (!streamResult) continue;
      if (!streamResult.hls_url && !streamResult.mp4_url && !streamResult.embed_url) continue;

      const langLabel = languages[index] === 'dub' ? 'ITA' : 'SUB';
      // FHD solo quando la variante HLS scelta dichiara 1080p o più. Il badge
      // sta nel nome del provider: il titolo non porta più la parola "FHD".
      const quality = qualityTag(streamResult.height) || (streamResult.fhd ? 'FHD' : null);
      const isFhd = Boolean(quality);
      const baseTitle = `${capitalize(displayTitle)} ▪ ${langLabel} ▪ ${episodeTag(seasonNumber, resolvedEpisodeNum)}`;

      if (directWanted) {
        if (streamResult.hls_url) pushStream(streamResult.hls_url, baseTitle + ' (HLS)', isFhd);
        // MP4 solo se manca l'HLS o se richiesto esplicitamente: di default una
        // stream per lingua, in HLS (l'MP4 era un doppione dello stesso episodio).
        if (streamResult.mp4_url && (!streamResult.hls_url || preferMp4)) {
          pushStream(
            streamResult.mp4_url,
            baseTitle + (preferMp4 ? ' (MP4 Preferred)' : ' (MP4)'),
            isFhd
          );
        }
      }

      if (proxyWanted && this.config.proxyUrl.trim()) {
        // Il token vixcloud vale per l'IP che apre la playlist: passare al
        // proxy la pagina embed (non la playlist già consumata qui) fa sì che
        // sia il proxy a generarlo e a servire manifest e segmenti.
        const embedForProxy = vixsrcEmbedUrl(streamResult.embed_url);
        const target = embedForProxy || streamResult.hls_url || streamResult.embed_url;
        if (!target) continue;
        let origin = embedForProxy ? 'https://vixsrc.to' : '';
        if (!origin) {
          try {
            origin = new URL(target).origin;
          } catch {
            origin = getUnityBaseUrl();
          }
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
        pushStream(proxyPlaylistUrl.toString(), baseTitle, isFhd);
      }
    }

    return streams;
  }

  // Made public for catalog search
  async searchAllVersions(title: string): Promise<{ version: AnimeUnitySearchResult; language_type: string }[]> {
    try {
      // Una sola ricerca: il flag DUB era ignorato, le due chiamate erano
      // identiche (la seconda un cache hit puro).
      const allResults = await searchEndpoint(title).catch(() => []);
      const results: { version: AnimeUnitySearchResult; language_type: string }[] = [];

      debug(2, 'AnimeUnity', `[AnimeUnity] Risultati ricerca per "${title}":`, allResults?.length || 0);

      // Assegna ITA o CR se il nome contiene
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

  /** Quello che la risoluzione condivisa deve sapere di questo provider. */
  private titleContext(): TitleResolutionContext {
    return {
      label: 'AnimeUnity',
      tmdbApiKey: this.config.tmdbApiKey,
      handleTitleRequest: (title, season, episode, isMovie, titleAlt, titleIt, titleItSeason, malId) =>
        this.handleTitleRequest(title, season, episode, isMovie, titleAlt, titleIt, titleItSeason, malId),
      handleUnmappedSeries: (request, episodeNumber) => this.handleUnmappedSeries(request, episodeNumber),
    };
  }

  async handleKitsuRequest(kitsuIdString: string): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) return { streams: [] };
    try {
      return await resolveKitsuRequest(kitsuIdString, this.titleContext());
    } catch (error) {
      console.error('Error handling Kitsu request:', error);
      return { streams: [] };
    }
  }

  /**
   * Gestisce la ricerca AnimeUnity partendo da un ID MAL (mal:ID[:STAGIONE][:EPISODIO])
   */
  async handleMalRequest(malIdString: string): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) return { streams: [] };
    try {
      return await resolveMalRequest(malIdString, this.titleContext());
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
    if (!this.config.enabled) return { streams: [] };
    try {
      return await resolveImdbRequest(imdbId, seasonNumber, episodeNumber, isMovie, this.titleContext());
    } catch (error) {
      console.error('Error handling IMDB request:', error);
      return { streams: [] };
    }
  }

  async handleTmdbRequest(tmdbId: string, seasonNumber: number | null, episodeNumber: number | null, isMovie = false): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) return { streams: [] };
    try {
      return await resolveTmdbRequest(tmdbId, seasonNumber, episodeNumber, isMovie, this.titleContext());
    } catch (error) {
      console.error('Error handling TMDB request:', error);
      return { streams: [] };
    }
  }

  async handleTvdbRequest(tvdbId: string, seasonNumber: number | null, episodeNumber: number | null, isMovie = false): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) return { streams: [] };
    try {
      return await resolveTvdbRequest(tvdbId, seasonNumber, episodeNumber, isMovie, this.titleContext());
    } catch (error) {
      console.error('Error handling TVDB request:', error);
      return { streams: [] };
    }
  }

  async handleTitleRequest(title: string, seasonNumber: number | null, episodeNumber: number | null, isMovie = false, titleAlt?: string | null, titleIt?: string | null, titleItSeason?: number | null, malId?: number | null): Promise<{ streams: StreamForStremio[] }> {
    debug(1, 'AnimeUnity', 'title request', { title, titleAlt, titleIt, titleItSeason, season: seasonNumber, episode: episodeNumber, isMovie });
    const universalTitle = applyUniversalAnimeTitleNormalization(title);
    const normalizedTitle = normalizeTitleForSearch(universalTitle);
    if (universalTitle !== title) {
      debug(3, 'AnimeUnity', `[UniversalTitle][Applied] ${title} -> ${universalTitle}`);
    }
    debug(2, 'AnimeUnity', `[AnimeUnity] Titolo normalizzato per ricerca: ${normalizedTitle}`);
    // Romaji MAL: alcuni record del sito non hanno name_eng e il titolo inglese
    // non supera la soglia. Entra solo se l'inglese non trova nulla: prima nel
    // filtro, poi (se il sito non ha risposto) come query di ripiego.
    // Anche il romaji passa dalla normalizzazione ("... Season 2" -> "... 2").
    const altRaw = titleAlt ? normalizeTitleForSearch(titleAlt) : '';
    const altQuery = sameQuery(altRaw, normalizedTitle) ? '' : altRaw;
    // Titolo italiano (TMDB): molti record del sito hanno solo name_it
    // italiani, che l'inglese non tocca. Se coincide con la query italiana non
    // aggiunge nulla (es. "Cyberpunk: Edgerunners" ha lo stesso nome in it-IT).
    const itQueryRaw = italianSeasonQuery(titleIt, titleItSeason ?? seasonNumber, normalizedTitle, isMovie);
    const itQuery = sameQuery(itQueryRaw, normalizedTitle) ? '' : itQueryRaw;
    const queryTitles = [normalizedTitle];
    if (itQuery) queryTitles.push(itQuery);
    // Se il titolo originale è una chiave dell'exactMap allora saltiamo qualsiasi filtro successivo:
    // l'intento dell'utente è: se la ricerca parte da una chiave exactMap, NON applicare filterAnimeResults
    const skipFilter = Object.prototype.hasOwnProperty.call(exactMap, title);
    if (skipFilter) {
      debug(3, 'AnimeUnity', `[AnimeUnity][ExactMap] Skip filtro: titolo di input corrisponde a chiave exactMap -> "${title}"`);
    }
    const catalogVersions = catalogUnityVersions([normalizedTitle, itQuery, altQuery], { season: seasonNumber, isMovie, malId, episode: episodeNumber });
    // Il catalogo ha gia' matchato (anche per alias, es. titolo inglese contro
    // romaji del sito): rifiltrare per titolo scarterebbe la scheda e farebbe
    // partire una ricerca di rete inutile.
    const fromCatalog = catalogVersions.length > 0;
    let animeVersions = fromCatalog ? catalogVersions : await this.searchAllVersions(normalizedTitle);
    if (fromCatalog) {
      debug(3, 'AnimeUnity', `[AnimeUnity][Catalog] ${animeVersions.length} schede dal catalogo, nessuna ricerca`);
    } else if (!skipFilter) {
      const rawVersions = animeVersions;
      animeVersions = filterAnimeResults(rawVersions, queryTitles, isMovie);
      if (!animeVersions.length && altQuery) {
        queryTitles.push(altQuery);
        animeVersions = filterAnimeResults(rawVersions, queryTitles, isMovie);
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
    if (!animeVersions.length && !skipFilter) {
      // Budget ricerca <=3 fetch: la principale più DUE ripieghi, il secondo
      // pagato solo se il primo ha già dato 0. Col sottotitolo nel titolo il
      // sito usa il sottotitolo, non "Base N": resta il romaji + le varianti
      // storiche. Senza sottotitolo vince l'italiano.
      const hasSubtitle = /:|\s+-\s+/.test(normalizedTitle);
      // Col sottotitolo l'italiano composto è sbagliato ("Tokyo Revengers 4":
      // sul sito l'arco sta nella scheda base), ma quello nudo è l'unica chance
      // sui siti che indicizzano in italiano.
      const bareItRaw = titleIt ? normalizeTitleForSearch(titleIt) : '';
      const bareItQuery = sameQuery(bareItRaw, normalizedTitle) || sameQuery(bareItRaw, itQuery) ? '' : bareItRaw;
      // Vedi Saturn: il titolo senza numerale di parte va per primo, ma solo per
      // i film (per le serie il numerale è la stagione).
      const partBase = isMovie ? stripPartNumeral(normalizedTitle) || '' : '';
      const candidates = hasSubtitle
        ? [partBase, altQuery, bareItQuery, ...buildTitleFallbackQueries(normalizedTitle, seasonNumber)]
        : [partBase, itQuery, altQuery, ...buildTitleFallbackQueries(normalizedTitle, seasonNumber)];
      for (const fallbackQuery of candidates.filter((q, i, all) => q && !sameQuery(q, normalizedTitle) && all.indexOf(q) === i).slice(0, 2)) {
        queryTitles.push(fallbackQuery);
        const fallbackVersions = filterAnimeResults(await this.searchAllVersions(fallbackQuery), queryTitles, isMovie);
        if (fallbackVersions.length) {
          debug(2, 'AnimeUnity', `[AnimeUnity] Trovato con query di ripiego: ${fallbackQuery}`);
          animeVersions = fallbackVersions;
          break;
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
      // Il sito tipizza le schede: un film non è l'episodio di una serie.
      // `/i`: il sito nuovo manda `movie` minuscolo, il catalogo `Movie`.
      if (!isMovie && /^movie$/i.test(String(version.type || ''))) continue;
      // `\b` e non `/ITA/gi`: senza il confine di parola "Attack on Titan"
      // diventava "Attack on Tn".
      const cleanName = version.name
        .replace(/\s*\(ITA\)/i, '')
        .replace(/\s*\(CR\)/i, '')
        .replace(/\bITA\b/gi, '')
        .replace(/\bCR\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      // L'etichetta deve dire la stagione: se la query mappata la porta ("… 2")
      // e la scheda del sito no, vince la query (AnimeSaturn fa già così).
      const labelTitle =
        seasonFromTitle(normalizedTitle) && !seasonFromTitle(cleanName) ? normalizedTitle : cleanName;
      const path = normalizeAnimePath(`/anime/${version.id}-${version.slug}`);
      if (!path) continue;
      const perVersion = await this.extractStreamsFromAnimePath(
        path,
        episodeNumber,
        seasonNumber,
        isMovie,
        labelTitle,
        version.ep
      );
      for (const st of perVersion) {
        if (!st || !st.url) continue;
        if (seenLinks.has(st.url)) continue;
        streams.push(st);
        seenLinks.add(st.url);
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
