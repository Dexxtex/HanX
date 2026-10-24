import * as cheerio from 'cheerio';
import { normalizeBool } from '../config.js';
import { getDomain } from '../utils/domains.js';
import { debug, redactUrl } from '../utils/logger.js';
import { AnimeWorldConfig, AnimeWorldResult, AnimeWorldEpisode, StreamForStremio } from '../types/animeunity.js';
import { checkIsAnimeById, applyUniversalAnimeTitleNormalization } from '../utils/animeGate.js';
import { buildEasyProxyHlsUrl, buildEasyProxyStreamUrl } from '../utils/easyproxy.js';
import {
  animeSlugBase as animeWorldSlugBase,
  buildTitleFallbackQueries,
  normalizeSearchTitleKey,
  normalizeTitleForSearch,
  resolveExactMapKey,
  titleMatchScore,
  type TitleNormalizationOptions,
} from '../utils/anime-title-normalization.js';
import {
  createCaches,
  fetchResource,
  getProviderUrl,
  getEnglishTitleFromAnyId,
  isAbortOrTimeoutError,
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

const AW_FETCH_TIMEOUT = Number.parseInt(process.env.ANIMEWORLD_FETCH_TIMEOUT_MS || '10000', 10) || 10000;
const ALLOW_EMPTY_TITLE = normalizeBool(process.env.AW_ALLOW_EMPTY_TITLE) ?? false;
const awCaches = createCaches();

// ─── Cloudflare/SecurityAW2 challenge bypass ───────────────
// AnimeWorld serves a tiny HTML stub (HTTP 202) on the first hit to any page,
// containing:
//   <script>document.cookie="SecurityAW2-os=<hash>; path=/";
//           location.href="http://www.animeworld.ac/<same>?d=1";</script>
// The cookie value is stable per IP, so we extract it once and replay every
// subsequent request with the cookie + ?d=1 to obtain the real page.
let awSecurityCookie: string | null = null;

const AW_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function extractSecurityCookieFromHtml(html: string): string | null {
  const m = /SecurityAW2-os=([a-f0-9]+)/i.exec(String(html || ''));
  return m && m[1] ? `SecurityAW2-os=${m[1]}` : null;
}

function looksLikeAwChallenge(html: string): boolean {
  const s = String(html || '');
  if (s.length > 4000) return false;
  return /SecurityAW2-os=/.test(s) || /__CF\$cv\$params/.test(s);
}

function appendDParam(url: string): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has('d')) u.searchParams.set('d', '1');
    return u.toString();
  } catch {
    return url + (url.includes('?') ? '&' : '?') + 'd=1';
  }
}

function mergeCookies(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join('; ');
}

/**
 * Cached, challenge-aware HTML fetch for AnimeWorld.
 * Returns the real page HTML, transparently solving the SecurityAW2 stub.
 */
async function awFetchHtml(
  url: string,
  opts: { ttlMs?: number; cacheKey?: string; extraCookie?: string | null; extraHeaders?: Record<string, string>; timeoutMs?: number } = {}
): Promise<string> {
  const { ttlMs = 0, cacheKey, extraCookie, extraHeaders, timeoutMs = AW_FETCH_TIMEOUT } = opts;

  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { ...(extraHeaders || {}) };
    const cookie = mergeCookies(awSecurityCookie, extraCookie);
    if (cookie) h.cookie = cookie;
    return h;
  };

  const targetUrl = awSecurityCookie ? appendDParam(url) : url;
  const hadCookie = !!awSecurityCookie;
  let html = await fetchResource(targetUrl, awCaches, {
    ttlMs,
    cacheKey: cacheKey ? `${cacheKey}:d=${awSecurityCookie ? 1 : 0}` : undefined,
    timeoutMs,
    headers: buildHeaders(),
  });

  if (looksLikeAwChallenge(html)) {
    const extracted = extractSecurityCookieFromHtml(html);
    if (extracted) {
      awSecurityCookie = extracted;
      debug(4, 'AnimeWorld', '[AnimeWorld][Challenge] captured SecurityAW2 cookie, replaying with d=1');
      // Replay sotto la chiave che il path normale legge (:d=1). Con un cookie
      // gia' presente il primo fetch ha pero' appena cachato lo stub sotto :d=1:
      // in quel caso resta la chiave distinta per non rileggere lo stub.
      html = await fetchResource(appendDParam(url), awCaches, {
        ttlMs,
        cacheKey: cacheKey ? `${cacheKey}:d=1${hadCookie ? ':retry' : ''}` : undefined,
        timeoutMs,
        headers: buildHeaders(),
      });
    } else {
      console.warn('[AnimeWorld][Challenge] stub detected but no cookie extracted for', url);
    }
  }
  return String(html || '');
}

// ─── Page Context helpers (ported from easystreams) ─────────
function getWorldBaseUrl(): string {
  const configured = getProviderUrl('animeworld', ['ANIMEWORLD_BASE_URL', 'AW_BASE_URL']);
  let raw = configured || `https://${getDomain('animeworld') || 'animeworld.ac'}`;
  raw = raw.replace(/\/+$/, '');
  // Ensure the www. subdomain: the apex animeworld.ac issues a different
  // SecurityAW2 cookie that does NOT unlock /play/ pages, so we always force
  // www. regardless of what provider_urls.json / domains.json contain.
  try {
    const u = new URL(raw);
    if (!/^www\./i.test(u.hostname)) u.hostname = `www.${u.hostname}`;
    return u.origin;
  } catch {
    return raw;
  }
}

function normalizeAnimeWorldPath(pathOrUrl: string | null | undefined): string | null {
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
  const match = value.match(/^\/(?:play\/[^/?#]+|anime\/[^/?#]+)/i);
  return match ? match[0] : null;
}

function parseAwEpisodeNumber(value: any, fallback: number): number {
  const text = String(value || '').trim();
  const direct = Number.parseInt(text, 10);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const floatMatch = text.match(/(\d+(?:[.,]\d+)?)/);
  if (floatMatch) {
    const parsed = Number.parseFloat(floatMatch[1].replace(',', '.'));
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return fallback;
}

function parseTagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([A-Za-z_:][A-Za-z0-9_:\-.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(String(tag || ''))) !== null) {
    const key = String(match[1] || '').trim().toLowerCase();
    const value = String(match[3] ?? match[4] ?? '').trim();
    if (!key) continue;
    attrs[key] = value;
  }
  return attrs;
}

function unwrapAnimeWorldDownloadUrl(absoluteUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(absoluteUrl);
  } catch {
    return null;
  }
  if (!/\/download-file\.php$/i.test(parsed.pathname)) return null;

  const rawId = parsed.searchParams.get('id');
  if (!rawId) return null;
  let target = rawId.trim();
  try {
    target = decodeURIComponent(target);
  } catch {
    target = rawId.trim();
  }
  if (!target) return null;

  try {
    const direct = /^https?:\/\//i.test(target)
      ? new URL(target)
      : new URL(target.replace(/^\/+/, ''), `${parsed.origin}/`);
    if (/\.(?:mp4|m3u8)$/i.test(direct.pathname)) return direct.toString();
  } catch {
    return null;
  }
  return null;
}

function normalizePlayableMediaUrl(rawUrl: string | null | undefined, depth = 0): string | null {
  if (!rawUrl) return null;
  let absolute: string;
  try {
    absolute = new URL(String(rawUrl).trim(), getWorldBaseUrl()).toString();
  } catch {
    return null;
  }
  const unwrappedDownload = unwrapAnimeWorldDownloadUrl(absolute);
  if (unwrappedDownload) return unwrappedDownload;
  try {
    const parsedForExtension = new URL(absolute);
    if (/\.(?:mp4|m3u8)$/i.test(parsedForExtension.pathname)) return absolute;
  } catch {
    return null;
  }
  if (depth >= 1) return null;
  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }
  const nestedKeys = ['url', 'src', 'file', 'link', 'stream', 'id'];
  for (const key of nestedKeys) {
    const nested = parsed.searchParams.get(key);
    if (!nested) continue;
    let decoded = nested;
    try {
      decoded = decodeURIComponent(nested);
    } catch {
      decoded = nested;
    }
    const nestedUrl = normalizePlayableMediaUrl(decoded, depth + 1);
    if (nestedUrl) return nestedUrl;
  }
  return null;
}

function collectMediaLinksFromHtml(html: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const add = (rawUrl: string) => {
    const normalized = normalizePlayableMediaUrl(rawUrl);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    links.push(normalized);
  };
  const raw = String(html || '');
  const variants = [raw, raw.replace(/\\\//g, '/')];
  for (const text of variants) {
    let match: RegExpExecArray | null;
    const directRegex = /https?:\/\/[^\s"'<>\\]+(?:\.mp4|\.m3u8)(?:[^\s"'<>\\]*)?/gi;
    while ((match = directRegex.exec(text)) !== null) add(match[0]);
    const sourceRegex = /(?:file|src|url|link)\s*[:=]\s*["']([^"']+)["']/gi;
    while ((match = sourceRegex.exec(text)) !== null) add(match[1]);
  }
  return links;
}

/**
 * AnimeWorld, quando il filtro non trova nulla, restituisce il listone "ultimi
 * arrivi" (Firefly Wedding, One Piece...). Distinguerlo serve: preso per vero
 * produce stream di un anime completamente diverso.
 */
export function awResultsRelateToQuery(results: AnimeWorldResult[], query: string): boolean {
  const tokens = normalizeSearchTitleKey(query).split(' ').filter(Boolean);
  const wanted = tokens.filter(t => t.length >= 4);
  const keys = wanted.length ? wanted : tokens;
  if (!keys.length) return false;
  return results.some(r => {
    const hay = normalizeSearchTitleKey(`${r.searchTitle || ''} ${r.name || ''} ${r.slug || ''}`);
    return keys.some(k => hay.includes(k));
  });
}

async function awSearch(query: string, date?: string): Promise<AnimeWorldResult[]> {
  const q = encodeURIComponent(String(query || '').trim());
  if (!q) return [];
  const year = date ? String(date).split('-')[0] : null;
  const urls = [
    `${getWorldBaseUrl()}/filter?keyword=${q}${year ? `&year[]=${encodeURIComponent(year)}` : ''}`,
    `${getWorldBaseUrl()}/filter?keyword=${q}`,
  ];
  const out: AnimeWorldResult[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    let html = '';
    try {
      html = await awFetchHtml(url, { ttlMs: 2 * 60 * 1000, cacheKey: `aw-search:${url}` });
    } catch {
      continue;
    }
    const $ = cheerio.load(String(html || ''));
    const bySlug = new Map<string, AnimeWorldResult>();
    $('a[href*="/play/"]').each((_, el) => {
      const href = String($(el).attr('href') || '').trim();
      const path = normalizeAnimeWorldPath(href);
      if (!path || !path.startsWith('/play/')) return;
      const slug = path.replace('/play/', '');
      if (!slug) return;
      // Ogni scheda compare due volte: prima <a class="poster"> (nessun titolo, il testo
      // sono i badge tipo "DUB") e poi <a class="name"> col titolo vero. Il primo definisce
      // l'ordine di rilevanza, il secondo il titolo: teniamo entrambi.
      const jtitle = String($(el).attr('data-jtitle') || '').replace(/\s+/g, ' ').trim();
      const titleAttr = String($(el).attr('title') || '').replace(/\s+/g, ' ').trim();
      const text = String($(el).text() || '').replace(/\s+/g, ' ').trim();
      // Badge lingua della scheda: <div class="dub">DUB</div> nell'anchor poster
      // e' presente SOLO sulla scheda della versione ITA (verificato contro
      // window.animeDub delle pagine play: scheda senza badge -> animeDub=false).
      const hasDub = $(el).find('.dub').length > 0;
      // Solo l'anchor col titolo espone data-jtitle; il testo del poster sono i badge
      // ("DUB"), non un titolo, quindi non va preso come searchTitle.
      const searchTitle = jtitle ? text : '';
      const existing = bySlug.get(slug);
      if (existing) {
        if (searchTitle && !existing.searchTitle) existing.searchTitle = searchTitle;
        if (hasDub && !existing.dubBadge) existing.dubBadge = true;
        return;
      }
      // `name` resta identico a prima (primo anchor incontrato): vedi AnimeWorldResult.
      const name = String(jtitle || titleAttr || text || slug).replace(/\s+/g, ' ').trim();
      const entry: AnimeWorldResult = { id: slug, slug, name, episodes_count: 0, language_type: 'SUB ITA' };
      if (searchTitle) entry.searchTitle = searchTitle;
      if (hasDub) entry.dubBadge = true;
      bySlug.set(slug, entry);
      seen.add(slug);
      out.push(entry);
    });
    // Se l'URL con l'anno non produce nulla di inerente, il sito ha risposto col
    // listone generico: scartalo e prova la query senza anno.
    if (out.length && awResultsRelateToQuery(out, query)) break;
    out.length = 0;
    seen.clear();
  }
  return out;
}

async function awGetEpisodes(slug: string): Promise<AnimeWorldEpisode[]> {
  const animeUrl = `${getWorldBaseUrl()}/play/${slug}`;
  let html = '';
  try {
    html = await awFetchHtml(animeUrl, { ttlMs: 5 * 60 * 1000, cacheKey: `aw-play:${slug}` });
  } catch {
    return [];
  }
  const raw = String(html || '');
  const episodes: AnimeWorldEpisode[] = [];
  const anchorRegex = /<a\b[^>]*(?:data-episode-num=(?:"[^"]*"|'[^']*'))[^>]*(?:data-id=(?:"[^"]*"|'[^']*'))[^>]*>|<a\b[^>]*(?:data-id=(?:"[^"]*"|'[^']*'))[^>]*(?:data-episode-num=(?:"[^"]*"|'[^']*'))[^>]*>/gi;
  const tags = raw.match(anchorRegex) || [];
  for (let index = 0; index < tags.length; index += 1) {
    const attrs = parseTagAttributes(tags[index]);
    const token = String(attrs['data-id'] || '').trim();
    if (!token) continue;
    const num = parseAwEpisodeNumber(attrs['data-episode-num'], index + 1);
    episodes.push({ id: token, number: num, name: attrs['data-comment'] || undefined });
  }
  return episodes;
}

/**
 * Parse <a data-episode-num="N" data-id="..." href="/play/<slug>/<urlToken>"> entries
 * from a play page HTML. Returns the urlToken (last path segment of the href)
 * for the requested episode number; this is what is needed to fetch the episode
 * page that contains the actual mp4 URL.
 */
function findEpisodeUrlTokenInHtml(html: string, episodeNumber: number | null | undefined): string | null {
  const raw = String(html || '');
  const anchorRegex = /<a\b[^>]*\bdata-episode-num=(?:"[^"]*"|'[^']*')[^>]*\bhref=(?:"([^"]*)"|'([^']*)')[^>]*>|<a\b[^>]*\bhref=(?:"([^"]*)"|'([^']*)')[^>]*\bdata-episode-num=(?:"[^"]*"|'[^']*')[^>]*>/gi;
  const tags = raw.match(anchorRegex) || [];
  let firstToken: string | null = null;
  for (let i = 0; i < tags.length; i += 1) {
    const attrs = parseTagAttributes(tags[i]);
    const href = String(attrs['href'] || '').trim();
    if (!href) continue;
    const m = href.match(/\/play\/[^/?#]+\/([^/?#]+)/);
    if (!m) continue;
    const token = m[1];
    if (!firstToken) firstToken = token;
    const num = parseAwEpisodeNumber(attrs['data-episode-num'], i + 1);
    if (episodeNumber == null) return token;
    if (Number(num) === Number(episodeNumber)) return token;
  }
  return episodeNumber == null ? firstToken : null;
}

/**
 * Fetch the episode page HTML and extract the first playable mp4/m3u8 URL.
 * Bypasses the broken /api/episode/info endpoint (returns 401 with current
 * AnimeWorld setup) by using the same direct-link approach the page itself
 * exposes for the download button.
 */
async function awExtractEpisodeStreamFromPlayPage(slug: string, episodeNumber: number | null | undefined, timeoutMs = AW_FETCH_TIMEOUT): Promise<string | null> {
  const animeUrl = `${getWorldBaseUrl()}/play/${slug}`;
  let playHtml = '';
  try {
    // Stessa pagina (e stessa cache aw-play:) gia' scaricata dal probe lingua e da
    // awGetEpisodes: il fetch era duplicato solo per avere cookie/csrf, che
    // l'API serverPlayer non richiede (verificato: risponde 200 senza).
    playHtml = await awFetchHtml(animeUrl, { ttlMs: 5 * 60 * 1000, cacheKey: `aw-play:${slug}`, timeoutMs });
  } catch (err: any) {
    console.error('[AnimeWorld][Stream] play page fetch failed for', slug, err?.message);
    if (isAbortOrTimeoutError(err)) throw err;
    return null;
  }
  const urlToken = findEpisodeUrlTokenInHtml(playHtml, episodeNumber == null ? null : Number(episodeNumber));
  if (!urlToken) {
    debug(3, 'AnimeWorld', '[AnimeWorld][Stream] no urlToken found for', slug, 'ep=', episodeNumber);
    return null;
  }

  // Upstream-compatible path: ask AnimeWorld API for the active player HTML
  // for this episode token, then extract mp4/m3u8 from that payload.
  try {
    const apiUrl = `${getWorldBaseUrl()}/api/episode/serverPlayerAnimeWorld?id=${encodeURIComponent(urlToken)}`;
    const apiHeaders: Record<string, string> = {
      'user-agent': AW_USER_AGENT,
      'accept-language': 'it-IT,it;q=0.9,en;q=0.8',
      'x-requested-with': 'XMLHttpRequest',
      referer: `${getWorldBaseUrl()}/play/${slug}/${urlToken}`,
    };

    const playerHtml = await fetchResource(apiUrl, awCaches, {
      ttlMs: 2 * 60 * 1000,
      cacheKey: `aw-player:${slug}:${urlToken}`,
      timeoutMs,
      headers: apiHeaders,
    });

    const fromApi = collectMediaLinksFromHtml(String(playerHtml || ''))[0] || null;
    if (fromApi) return fromApi;
    debug(3, 'AnimeWorld', '[AnimeWorld][Stream] no media link in serverPlayer payload for', slug, 'ep=', episodeNumber);
  } catch (err: any) {
    console.warn('[AnimeWorld][Stream] serverPlayer request failed, fallback to episode HTML:', slug, urlToken, err?.message || err);
  }

  // Fallback path: parse direct episode HTML as before.
  const epUrl = `${getWorldBaseUrl()}/play/${slug}/${urlToken}`;
  let epHtml = '';
  try {
    epHtml = await awFetchHtml(epUrl, { ttlMs: 2 * 60 * 1000, cacheKey: `aw-ep:${slug}:${urlToken}`, timeoutMs });
  } catch (err: any) {
    console.error('[AnimeWorld][Stream] episode page fetch failed for', slug, urlToken, err?.message);
    if (isAbortOrTimeoutError(err)) throw err;
    return null;
  }
  const mp4 = collectMediaLinksFromHtml(epHtml)[0] || null;
  if (!mp4) {
    debug(3, 'AnimeWorld', '[AnimeWorld][Stream] no mp4 link in episode page for', slug, 'ep=', episodeNumber);
  }
  return mp4;
}

async function awGetStream(slug: string, episode?: number, timeoutMs = AW_FETCH_TIMEOUT): Promise<{ mp4_url: string | null }> {
  const mp4 = await awExtractEpisodeStreamFromPlayPage(slug, episode == null ? null : Number(episode), timeoutMs);
  return { mp4_url: mp4 };
}

function getAnimeWorldStreamHeaders(slug: string): Record<string, string> {
  return {
    Referer: `${getWorldBaseUrl()}/play/${slug}`,
    'User-Agent': AW_USER_AGENT,
  };
}

export function buildAnimeWorldStreamOutput(
  mediaUrl: string,
  slug: string,
  config: AnimeWorldConfig,
  extraBehaviorHints: Record<string, any> = {}
): { url: string; behaviorHints: Record<string, any> } {
  const requestHeaders = getAnimeWorldStreamHeaders(slug);
  const behaviorHints: Record<string, any> = {
    notWebReady: true,
    requestHeaders,
    headers: requestHeaders,
    proxyHeaders: { request: requestHeaders },
    proxyUseFallback: true,
    ...extraBehaviorHints,
  };

  const proxyUrl = String(config.proxyUrl || '').trim();
  if (!proxyUrl) return { url: mediaUrl, behaviorHints };

  const proxyHeaders = {
    Referer: requestHeaders.Referer,
    'User-Agent': requestHeaders['User-Agent'],
  };
  const isHls = /\.m3u8(?:[?#]|$)/i.test(mediaUrl);
  return {
    url: isHls
      ? buildEasyProxyHlsUrl(mediaUrl, proxyUrl, config.proxyPassword, proxyHeaders)
      : buildEasyProxyStreamUrl(mediaUrl, proxyUrl, config.proxyPassword, proxyHeaders),
    behaviorHints,
  };
}

async function invokePython(args: string[], timeoutMs = AW_FETCH_TIMEOUT): Promise<any> {
  const cmd = String(args?.[0] || '');
  if (cmd === 'search') {
    const qIdx = args.indexOf('--query');
    const dIdx = args.indexOf('--date');
    const query = qIdx >= 0 ? String(args[qIdx + 1] || '') : '';
    const date = dIdx >= 0 ? String(args[dIdx + 1] || '') : undefined;
    return awSearch(query, date);
  }
  if (cmd === 'get_episodes') {
    const sIdx = args.indexOf('--anime-slug');
    const slug = sIdx >= 0 ? String(args[sIdx + 1] || '') : '';
    return awGetEpisodes(slug);
  }
  if (cmd === 'get_stream') {
    const sIdx = args.indexOf('--anime-slug');
    const eIdx = args.indexOf('--episode');
    const slug = sIdx >= 0 ? String(args[sIdx + 1] || '') : '';
    const episode = eIdx >= 0 ? Number(args[eIdx + 1]) : undefined;
    return awGetStream(slug, Number.isFinite(episode as number) ? episode : undefined, timeoutMs);
  }
  throw new Error(`AnimeWorld adapter command non supportato: ${cmd}`);
}

// ==== AUTO-NORMALIZATION-EXACT-MAP-START ====
const exactMap: Record<string, string> = {

      "Cat's\u2665Eye": "Occhi di gatto (2025)",
      "Cat's Eye (2025)": "Occhi di gatto (2025)",


      "Ranma \u00bd (2024) Season 2": "Ranma \u00bd (2024) 2",
      "Ranma1/2 (2024) Season 2": "Ranma \u00bd (2024) 2",


      "Link Click Season 2": "Link Click 2",



      "K: SEVEN STORIES Lost Small World - Outside the Cage - ": "K: Seven Stories Movie 4 - Lost Small World - Ori no Mukou ni",




      "Nichijou - My Ordinary Life": "Nichijou",

      "Case Closed Movie 01: The Time Bombed Skyscraper": "Detective Conan Movie 01: Fino alla fine del tempo",
      "My Hero Academia Final Season": "Boku no Hero Academia: Final Season",






      "Jujutsu Kaisen: The Culling Game Part 1": "Jujutsu Kaisen 3: The Culling Game Part 1",






      "Hell's Paradise Season 2": "Hell's Paradise 2",







      "[Oshi no Ko]": "Oshi no Ko",








      // << AUTO-INSERT-EXACT >> (non rimuovere questo commento)
};
// ==== AUTO-NORMALIZATION-EXACT-MAP-END ====

const animeWorldTitleNormalization: TitleNormalizationOptions = {
  exactMap,
  replacements: [
    ['Attack on Titan', "L'attacco dei Giganti"],
    ['Season', ''],
    ['Shippuuden', 'Shippuden'],
    ['Solo Leveling 2', 'Solo Leveling 2:'],
    ['Solo Leveling 2 :', 'Solo Leveling 2:'],
    ['-', ''],
  ],
  stripColonAfter: 'Naruto:',
};

// Pattern lingua degli slug AnimeWorld (ordine: SUB prima per evitare che 'subita' attivi 'ita')
const AW_SUB_PAT = /(?:^|[\-_.])sub(?:[-_]?ita)?(?:$|[\-_.])/i; // sub, subita, sub-ita
const AW_ITA_PAT = /(?:^|[\-_.])(cr[-_]?ita|ita[-_]?cr|ita)(?:$|[\-_.])/i; // ita, cr-ita, crita, ita-cr

export class AnimeWorldProvider {
  constructor(private config: AnimeWorldConfig) {}

  async searchAllVersions(title: string, probeFilter?: (v: AnimeWorldResult) => boolean): Promise<AnimeWorldResult[]> {
    try {
      const raw: AnimeWorldResult[] = await invokePython(['search','--query', title]);
      if (!raw) return [];
      const normSlugKey = title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

      // Regole richieste:
      // 1. Se slug contiene pattern sub ita -> SUB ITA
      // 2. Altrimenti se slug contiene ita -> ITA
      // 3. Altrimenti se la scheda di ricerca porta il badge DUB -> ITA
      // 4. Altrimenti (slug "base", nessun segnale) -> probe HTML, ma SOLO se la
      //    passante a probeFilter: chi chiama la usa per filtrare i risultati,
      //    quindi non convene sondare slug che il filtro butta via comunque.
      //    Se la pagina ha window.animeDub=true -> ITA, else SUB ITA

      // Colleziona slug che richiedono probe (base slugs). Budget: MAX 1 probe per
      // ricerca, altrimenti la fase di ricerca supera le 2 richieste.
      const probeQueue: string[] = [];

      interface TempRes { baseMatch: boolean; nameRaw: string; slugRaw: string; language_type: 'ORIGINAL' | 'SUB ITA' | 'CR ITA' | 'ITA' | 'NEEDS_PROBE'; }
      const prelim: TempRes[] = raw.map(r => {
        const nameRaw = r.name || '';
        const slugRaw = r.slug || '';
        const slugLower = slugRaw.toLowerCase();
        let language_type: TempRes['language_type'] = 'ORIGINAL';
        // 1. Marker nello slug
        if (AW_SUB_PAT.test(slugLower)) {
          language_type = 'SUB ITA';
        } else if (AW_ITA_PAT.test(slugLower)) {
          language_type = 'ITA';
        } else if (r.dubBadge) {
          language_type = 'ITA';
        } else {
          // Nessun segnale -> probe HTML (max 1 per ricerca), solo se il chiamante
          // vuole ancora questo slug
          if (probeQueue.length === 0 && (!probeFilter || probeFilter({ slug: slugRaw, name: nameRaw } as AnimeWorldResult))) {
            probeQueue.push(slugRaw);
          }
          language_type = 'NEEDS_PROBE';
        }
        const basePart = slugLower.split('.')[0];
        const cleaned = basePart.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
        const baseMatch = cleaned === normSlugKey;
        return { baseMatch, nameRaw, slugRaw, language_type };
      });

      // Probe funzione ridotta (solo segnali forti)
      const probeLang = async (slug: string): Promise<'ITA' | 'SUB ITA'> => {
        try {
          const awDom = getDomain('animeworld') || 'animeworld.ac';
          const html = await awFetchHtml(`https://www.${awDom}/play/${slug}`, {
            ttlMs: 5 * 60 * 1000,
            // Stessa chiave di awGetEpisodes: la pagina play scaricata per il probe
            // riempie la cache e risparmia il refetch degli episodi qui sotto.
            cacheKey: `aw-play:${slug}`,
          });
          // Solo il flag globale della pagina: window.animeDub e' true solo per la
          // versione ITA. Il resto della pagina elenca le varianti DUB sorelle
          // (badge "(ITA)", "dub") e contamina i match testuali.
          const isDub = /window\.animeDub\s*=\s*true/i.test(html);
          debug(4, 'AnimeWorld', `[AnimeWorld][LangProbe] ${slug} -> ${isDub ? 'ITA' : 'SUB ITA'} (animeDub)`);
          return isDub ? 'ITA' : 'SUB ITA';
        } catch (err: any) {
          debug(3, 'AnimeWorld', '[AnimeWorld][LangProbe] pagina non recuperata, assumo SUB ITA per', slug, err?.message || err);
          return 'SUB ITA';
        }
      };

      // Esegui probe in parallelo (tutti gli slug base insieme)
      await Promise.all(probeQueue.map(async (slug) => {
        const lang = await probeLang(slug);
        prelim.filter(p => p.slugRaw === slug && p.language_type === 'NEEDS_PROBE').forEach(p => p.language_type = lang);
      }));

      const mapped = prelim.map(p => ({
        ...raw.find(r => r.slug === p.slugRaw)!,
        language_type: p.language_type === 'NEEDS_PROBE' ? 'SUB ITA' : p.language_type
      }));

      // Regola aggiuntiva: se il nome e' vuoto e lo slug era "base" (nessun marcatore originale) forza SUB ITA
      mapped.forEach(m => {
        if (!m.name || !m.name.trim()) {
          const slugLower = (m.slug || '').toLowerCase();
          const hasSub = AW_SUB_PAT.test(slugLower);
          const hasIta = AW_ITA_PAT.test(slugLower);
          if (!hasSub && !hasIta) {
            if (m.language_type === 'ITA') {
              debug(4, 'AnimeWorld', '[AnimeWorld][LangMap][AdjustEmptyName] Forzo SUB ITA per slug base con name vuoto:', m.slug);
            }
            m.language_type = 'SUB ITA';
          }
        }
      });

      mapped.forEach(m => {
        debug(4, 'AnimeWorld', '[AnimeWorld][LangMap][DecisionSimple]', {
          slug: m.slug,
          name: m.name,
          final: m.language_type
        });
      });
      debug(4, 'AnimeWorld', '[AnimeWorld] search versions sample:', mapped.slice(0,12).map(v => `${v.language_type}:${v.slug}`).join(', '));
      return mapped;
    } catch (e) {
      console.error('[AnimeWorld] search error', e);
      return [];
    }
  }

  async handleKitsuRequest(kitsuIdString: string): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) return { streams: [] };
    try {
      const request = resolveMappingRequest(kitsuIdString);
      if (!request) return { streams: [] };
      const kitsuId = request.id;
      // Single quick Kitsu call: canonical title (for stream label) + startDate (for fallback filter-year)
      let quickTitle = '';
      try {
        const metaResp = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}`);
        if (metaResp.ok) {
          const metaJson: any = await metaResp.json();
          const attr = metaJson?.data?.attributes || {};
          if (attr.startDate) (this as any)._lastKitsuStartDate = attr.startDate;
          quickTitle = attr.titles?.en || attr.titles?.en_jp || attr.canonicalTitle || '';
        }
      } catch (e) {
        console.warn('[AnimeWorld] quick Kitsu meta fetch failed', e);
      }
      let title = quickTitle || (await getKitsuTitle(kitsuId));
      if (!title) {
        try {
          title = await getEnglishTitleFromAnyId(kitsuId, 'kitsu', this.config.tmdbApiKey, ALLOW_EMPTY_TITLE);
        } catch {}
      }
      if (!title) return { streams: [] };
      // Kitsu has one season per entry, so no external season label is used.
      return await this.handleTitleRequest(title, null, request.episode, request.isMovie);
    } catch (e) {
      console.error('[AnimeWorld] kitsu handler error', e);
      return { streams: [] };
    }
  }
  async handleMalRequest(malIdString: string): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) return { streams: [] };
    try {
      const request = resolveMappingRequest(malIdString);
      if (!request) return { streams: [] };
      const englishTitle = await getEnglishTitleFromAnyId(request.id, 'mal', this.config.tmdbApiKey, ALLOW_EMPTY_TITLE);
      return this.handleTitleRequest(englishTitle, request.season, request.episode, request.isMovie);
    } catch (e) { console.error('[AnimeWorld] mal handler error', e); return { streams: [] }; }
  }
  /** Split-cour safety net: season title on a mapping miss, never the base series title. */
  private async handleUnmappedSeries(
    request: MappingRequest | null,
    episodeNumber: number | null
  ): Promise<{ streams: StreamForStremio[] } | null> {
    if (!request || request.isMovie) return null;
    const season = request.season ?? 1;
    if (season <= 1) return null;
    const seasonTitle = await resolveSeasonFallbackTitle(request, this.config);
    if (!seasonTitle) {
      console.warn(`[AnimeWorld] Mapping miss for ${request.provider}:${request.id} S${season}E${episodeNumber}: no season title, returning no stream`);
      return { streams: [] };
    }
    console.warn(`[AnimeWorld] Mapping miss for ${request.provider}:${request.id} S${season}E${episodeNumber}: using season title "${seasonTitle}"`);
    return this.handleTitleRequest(seasonTitle, season, episodeNumber, false);
  }

  async handleImdbRequest(imdbId: string, seasonNumber: number | null, episodeNumber: number | null, isMovie=false): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) return { streams: [] };
    try {
      const gateEnabled = (process.env.ANIME_GATE_ENABLED || 'true') !== 'false';
      if (gateEnabled) {
        const gate = await checkIsAnimeById('imdb', imdbId, this.config.tmdbApiKey, isMovie ? 'movie' : 'tv');
        if (!gate.isAnime) {
          debug(2, 'AnimeWorld', `[AnimeWorld] Skipping anime search: no MAL/Kitsu mapping (${gate.reason}) for ${imdbId}`);
          return { streams: [] };
        }
      }
      const request = resolveMappingRequest(imdbId, seasonNumber, episodeNumber, isMovie);
      if (request) {
        const target = await resolveAnimeTarget(request, this.config);
        const title = target ? target.title || (await getKitsuTitle(target.kitsuId)) : '';
        if (target && title) {
          return this.handleTitleRequest(title, target.displaySeason, target.kitsuEpisode, request.isMovie);
        }
      }
      const unmapped = await this.handleUnmappedSeries(request, episodeNumber);
      if (unmapped) return unmapped;
      const englishTitle = await getEnglishTitleFromAnyId(imdbId, 'imdb', this.config.tmdbApiKey, ALLOW_EMPTY_TITLE);
      return this.handleTitleRequest(englishTitle, seasonNumber, episodeNumber, isMovie);
    } catch(e){ console.error('[AnimeWorld] imdb handler error', e); return { streams: [] }; }
  }
  async handleTmdbRequest(tmdbId: string, seasonNumber: number | null, episodeNumber: number | null, isMovie=false): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) return { streams: [] };
    try {
      const gateEnabled = (process.env.ANIME_GATE_ENABLED || 'true') !== 'false';
      if (gateEnabled) {
        const gate = await checkIsAnimeById('tmdb', tmdbId, this.config.tmdbApiKey, isMovie ? 'movie' : 'tv');
        if (!gate.isAnime) {
          debug(2, 'AnimeWorld', `[AnimeWorld] Skipping anime search: no MAL/Kitsu mapping (${gate.reason}) for TMDB ${tmdbId}`);
          return { streams: [] };
        }
      }
      const request = resolveMappingRequest(`tmdb:${tmdbId}`, seasonNumber, episodeNumber, isMovie);
      if (request) {
        const target = await resolveAnimeTarget(request, this.config);
        const title = target ? target.title || (await getKitsuTitle(target.kitsuId)) : '';
        if (target && title) {
          return this.handleTitleRequest(title, target.displaySeason, target.kitsuEpisode, request.isMovie);
        }
      }
      const unmapped = await this.handleUnmappedSeries(request, episodeNumber);
      if (unmapped) return unmapped;
      const englishTitle = await getEnglishTitleFromAnyId(tmdbId, 'tmdb', this.config.tmdbApiKey, ALLOW_EMPTY_TITLE);
      return this.handleTitleRequest(englishTitle, seasonNumber, episodeNumber, isMovie);
    } catch(e){ console.error('[AnimeWorld] tmdb handler error', e); return { streams: [] }; }
  }

  async handleTvdbRequest(tvdbId: string, seasonNumber: number | null, episodeNumber: number | null, isMovie=false): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) return { streams: [] };
    try {
      const gateEnabled = (process.env.ANIME_GATE_ENABLED || 'true') !== 'false';
      if (gateEnabled) {
        const gate = await checkIsAnimeById('tvdb', tvdbId, this.config.tmdbApiKey, isMovie ? 'movie' : 'tv');
        if (!gate.isAnime) {
          debug(2, 'AnimeWorld', `[AnimeWorld] Skipping anime search: no Kitsu mapping (${gate.reason}) for TVDB ${tvdbId}`);
          return { streams: [] };
        }
      }
      const request = resolveMappingRequest(`tvdb:${tvdbId}`, seasonNumber, episodeNumber, isMovie);
      if (request) {
        const target = await resolveAnimeTarget(request, this.config);
        const title = target ? target.title || (await getKitsuTitle(target.kitsuId)) : '';
        if (target && title) {
          return this.handleTitleRequest(title, target.displaySeason, target.kitsuEpisode, request.isMovie);
        }
      }
      const unmapped = await this.handleUnmappedSeries(request, episodeNumber);
      if (unmapped) return unmapped;
      const fallbackTitle = await getTvdbTitle(tvdbId, this.config);
      if (!fallbackTitle) return { streams: [] };
      return this.handleTitleRequest(fallbackTitle, seasonNumber, episodeNumber, isMovie);
    } catch(e){ console.error('[AnimeWorld] tvdb handler error', e); return { streams: [] }; }
  }

  async handleTitleRequest(title: string, seasonNumber: number | null, episodeNumber: number | null, isMovie = false): Promise<{ streams: StreamForStremio[] }> {
    debug(1, 'AnimeWorld', 'title request', { title, season: seasonNumber, episode: episodeNumber, isMovie });
    const universalTitle = applyUniversalAnimeTitleNormalization(title);
    if (universalTitle !== title) {
      debug(3, 'AnimeWorld', `[UniversalTitle][Applied] ${title} -> ${universalTitle}`);
    }

    const exactMapKey = resolveExactMapKey(title, universalTitle, exactMap);
    const normalized = normalizeTitleForSearch(universalTitle, animeWorldTitleNormalization, exactMapKey);
    if (exactMapKey) {
      debug(3, 'AnimeWorld', `[AnimeWorld][ExactMap] Hit: "${exactMapKey}" -> "${exactMap[exactMapKey]}"`);
    }
    const skipExtraNormalization = !!exactMapKey;
    if (skipExtraNormalization) {
      debug(3, 'AnimeWorld', `[AnimeWorld][ExactMap] Forced search title: ${normalized}`);
    }

    // Filtro slug base definito PRIMA della ricerca: searchAllVersions lo usa per
    // sondare SOLO gli slug base che poi sopravvivono a questo filtro (senza,
    // ogni ricerca sonda ~10 pagine /play/<slug> per determinare la lingua).
    const normSlugKey = normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const wantsRewrite = /rewrite/i.test(normalized);
    const strictFilterActive = !skipExtraNormalization && !wantsRewrite;
    const allowedSuffixes = ['-ita', '-subita', '-sub-ita', '-cr-ita', '-ita-cr'];
    const matchesBaseSlug = (v: AnimeWorldResult) => {
      const raw = (v.slug || v.name || '').toLowerCase();
      const basePart = raw.split('.')[0];
      const cleaned = basePart.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (/rewrite\b/.test(cleaned)) return false;
      if (cleaned === normSlugKey) return true;
      if (allowedSuffixes.some(suf => cleaned === normSlugKey + suf)) return true;
      return titleMatchScore(normalized, basePart.replace(/-/g, ' ')) >= 0.5;
    };

    const searchWithLogging = async (query: string) => {
      const results = await this.searchAllVersions(query, strictFilterActive ? matchesBaseSlug : undefined);
      debug(2, 'AnimeWorld', `[AnimeWorld] Search query "${query}" -> ${results.length}`);
      return results;
    };

    debug(3, 'AnimeWorld', '[AnimeWorld] Title original:', title);
    debug(3, 'AnimeWorld', '[AnimeWorld] Title normalized:', normalized);

    let versions = await searchWithLogging(normalized);

    if (!skipExtraNormalization && !versions.length) {
      // Budget ricerca = 2 fetch: UNA sola query di ripiego e senza probe lingua
      // (i risultati senza marcatore restano SUB, default verificato sul vivo).
      const [fallbackQuery] = buildTitleFallbackQueries(normalized).filter(q => q && q !== normalized);
      if (fallbackQuery) {
        const res = await this.searchAllVersions(fallbackQuery, () => false);
        debug(2, 'AnimeWorld', `[AnimeWorld] Search fallback "${fallbackQuery}" -> ${res.length}`);
        if (res.length) {
          versions = res;
        }
      }
    } else if (skipExtraNormalization && !versions.length) {
      console.warn(`[AnimeWorld][ExactMap] Nessun risultato trovato per titolo mappato "${normalized}" (fallback disabilitati).`);
    }

    debug(2, 'AnimeWorld', '[AnimeWorld] Versions found:', versions.length);
    const debugLangCounts = versions.reduce((acc: Record<string, number>, item) => {
      const key = item.language_type || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    debug(3, 'AnimeWorld', '[AnimeWorld] Language type counts:', debugLangCounts);

    if (!versions.length) {
      const fallbackDate = (this as any)._lastKitsuStartDate as string | undefined;
      if (fallbackDate) {
        try {
          const fb = await this.fallbackFilterYearSearch(normalized, fallbackDate, isMovie, episodeNumber, seasonNumber);
          if (fb.streams.length) {
            return fb;
          }
          debug(2, 'AnimeWorld', '[AnimeWorld] Fallback filter-year search produced 0 streams.');
        } catch (err) {
          console.warn('[AnimeWorld] Fallback filter-year search errored:', err);
        }
      }
      return { streams: [] };
    }

    if (!skipExtraNormalization) {
      try {
        if (!wantsRewrite) {
          const beforeCount = versions.length;
          const filtered = versions.filter(matchesBaseSlug);
          debug(3, 'AnimeWorld', `[AnimeWorld] Strict base filter applied (${normSlugKey}) from ${beforeCount} -> ${filtered.length}`);
          if (!filtered.length) {
            debug(3, 'AnimeWorld', '[AnimeWorld] Strict filter produced 0 results, NOT restoring broad matches (no full title match).');
            const fallbackDate = (this as any)._lastKitsuStartDate as string | undefined;
            if (fallbackDate) {
              try {
                debug(3, 'AnimeWorld', '[AnimeWorld] Invoking fallbackFilterYearSearch AFTER strict filter zero-match, date=', fallbackDate);
                const fb = await this.fallbackFilterYearSearch(normalized, fallbackDate, isMovie, episodeNumber, seasonNumber);
                if (fb.streams.length) {
                  return fb;
                }
                debug(2, 'AnimeWorld', '[AnimeWorld] fallbackFilterYearSearch produced 0 streams after strict filter.');
              } catch (err) {
                console.warn('[AnimeWorld] fallbackFilterYearSearch post-strict error:', err);
              }
            }
            return { streams: [] };
          }
          versions = filtered;
          // Se e' rimasta solo la versione doppiata, cerca il titolo base per aggiungere
          // la versione sub dello stesso anime (la ricerca con il sottotitolo di stagione
          // a volte restituisce una sola delle due lingue).
          // Budget ricerca = 2 fetch: la sub-recovery (1 ricerca) parte solo se la
          // ricerca principale non ha gia' speso il budget in un probe lingua.
          const probedInFilter = filtered.some(v => {
            const s = String(v.slug || '').toLowerCase();
            return !AW_SUB_PAT.test(s) && !AW_ITA_PAT.test(s) && !v.dubBadge;
          });
          if (!versions.some(v => v.language_type === 'SUB ITA') && !probedInFilter) {
            // Solo per i titoli con sottotitolo di stagione: il primo ripiego e' il titolo della serie.
            const baseQuery = /:|\s-\s/.test(normalized) ? buildTitleFallbackQueries(normalized)[0] : '';
            if (baseQuery && baseQuery !== normalized) {
              // probeFilter () => false: nessun probe extra, il budget e' finito
              const extra = (await this.searchAllVersions(baseQuery, () => false))
                .filter(v => v.language_type === 'SUB ITA' && matchesBaseSlug(v));
              if (extra.length) {
                debug(2, 'AnimeWorld', `[AnimeWorld] Versione SUB aggiunta dalla query base "${baseQuery}":`, extra.map(v => v.slug).join(', '));
                versions = versions.concat(extra);
              }
            }
          }
        } else {
          debug(3, 'AnimeWorld', '[AnimeWorld] Rewrite detected in normalized title, keeping rewrite variants alongside base');
        }
      } catch (e) {
        console.warn('[AnimeWorld] Strict base slug filter error (ignored):', e);
      }
    } else {
      debug(3, 'AnimeWorld', '[AnimeWorld][ExactMap] Skip strict base slug filter (exact map enforced).');
    }

    const rank = (v: AnimeWorldResult & { language_type?: string }) => {
      if (v.language_type === 'ITA') return 0;
      if (v.language_type === 'SUB ITA') return 1;
      if (v.language_type === 'CR ITA') return 2;
      return 3;
    };
    versions.sort((a, b) => rank(a) - rank(b));
    debug(4, 'AnimeWorld', '[AnimeWorld] Top versions sample:', versions.slice(0, 8).map(v => `${v.language_type}:${v.slug}`).join(', '));

    let reduced = versions.filter(v => v.language_type === 'ITA' || v.language_type === 'SUB ITA' || v.language_type === 'CR ITA');
    if (!reduced.length) reduced = versions.slice(0, 1);

    const isMovieSlug = (v: any) => {
      const s = (v.slug || v.name || '').toLowerCase();
      return s.includes('movie') || /-movie-/.test(s);
    };

    let selected: typeof reduced = [];
    if (episodeNumber != null && !isMovie) {
      selected = reduced.filter(v => !isMovieSlug(v));
    } else {
      selected = reduced.slice(0, 2);
    }
    debug(3, 'AnimeWorld', '[AnimeWorld] Processing versions (candidates):', selected.map(v => `${v.language_type}:${v.slug || v.name}`).join(', '));

    const seen = new Set<string>();
    const tBatch = Date.now();

    const episodeInfos = await Promise.all(selected.map(async v => {
      try {
        const t0 = Date.now();
        const episodes: AnimeWorldEpisode[] = await invokePython(['get_episodes', '--anime-slug', v.slug]);
        if (!episodes || !episodes.length) return null;
        let target: AnimeWorldEpisode | undefined;
        if (isMovie) {
          target = episodes[0];
        } else if (episodeNumber != null) {
          target = episodes.find(e => e.number === episodeNumber);
          if (!target) {
            debug(3, 'AnimeWorld', `[AnimeWorld] Skipping ${v.language_type} version: episode ${episodeNumber} not found for slug=${v.slug}`);
            return null;
          }
        } else {
          target = episodes[0];
        }
        if (!target) return null;
        return { v, target, ms: Date.now() - t0 };
      } catch (e) {
        console.error('[AnimeWorld] get_episodes error', v.slug, e);
        return null;
      }
    }));

    const streamObjs = await Promise.all(episodeInfos.filter(Boolean).map(async info => {
      if (!info) return null;
      const { v, target } = info;
      try {
        const epNum = episodeNumber != null ? episodeNumber : target.number;
        debug(4, 'AnimeWorld', `[AnimeWorld] Fetching stream for slug=${v.slug} ep=${epNum}`);
        let streamData: any = null;
        let timedOut = false;
        try {
          streamData = await invokePython(['get_stream', '--anime-slug', v.slug, ...(epNum != null ? ['--episode', String(epNum)] : [])]);
        } catch (e: any) {
          if (isAbortOrTimeoutError(e)) {
            timedOut = true;
            console.warn('[AnimeWorld] get_stream timeout, retry extended 15s:', v.slug);
          } else {
            throw e;
          }
        }
        if (timedOut) {
          try {
            streamData = await invokePython(['get_stream', '--anime-slug', v.slug, ...(epNum != null ? ['--episode', String(epNum)] : [])], 15000);
          } catch (e2) {
            console.error('[AnimeWorld] get_stream retry failed', v.slug, e2);
            return null;
          }
        }

        const mp4 = streamData?.mp4_url;
        if (!mp4) return null;

        if (!isMovie && episodeNumber != null) {
          const lowerUrl = mp4.toLowerCase();
          const epStr = episodeNumber.toString();
          const epPadded2 = epStr.padStart(2, '0');
          const epPadded3 = epStr.padStart(3, '0');
          const looksLikeEpisode = /ep[_-]?\d{1,3}/i.test(lowerUrl) || lowerUrl.includes(`_${epPadded2}_`) || lowerUrl.includes(`_${epPadded3}_`);
          const isMovieFile = lowerUrl.includes('movie');
          const isSpecialFile = lowerUrl.includes('special');
          if ((isMovieFile || isSpecialFile) && !looksLikeEpisode) {
            debug(3, 'AnimeWorld', '[AnimeWorld] Skipping non-episode file (movie/special) for requested ep:', redactUrl(mp4));
            return null;
          }
        }

        const streamOut = buildAnimeWorldStreamOutput(mp4, v.slug, this.config);
        const finalUrl = streamOut.url;
        if (seen.has(finalUrl)) return null;
        seen.add(finalUrl);

        const baseName = animeWorldDisplayName(v.name, v.slug, normalized || title);

        let langLabel = 'SUB';
        if (v.language_type === 'ITA') langLabel = 'ITA';
        else if (v.language_type === 'SUB ITA') langLabel = 'SUB';
        else if (v.language_type === 'CR ITA') langLabel = 'CR';

        let titleStream = `${capitalize(baseName)} ▪ ${langLabel}`;
        const epTag = episodeTag(seasonNumber, episodeNumber);
        if (epTag) titleStream += ` ▪ ${epTag}`;

        return { title: titleStream, url: finalUrl, behaviorHints: streamOut.behaviorHints } as StreamForStremio;
      } catch (e) {
        console.error('[AnimeWorld] get_stream error', v.slug, e);
        return null;
      }
    }));

    const streams = streamObjs.filter(Boolean) as StreamForStremio[];
    debug(1, 'AnimeWorld', `[AnimeWorld] Total AW streams produced: ${streams.length} (parallel batch ${Date.now() - tBatch}ms)`);
    return { streams };
  }

  /**
   * Fallback che replica la logica del vecchio script: usa la ricerca filter?year=YYYY&keyword=TitoloTroncato
   * - Usa Python scraper con --date per forzare pattern identico all'originale (prima prova con anno, poi senza)
   * - Prende i primi 2 risultati compatibili (data match gia' gestita nello scraper)
   * - get_episodes + get_stream come normale, ma etichetta versioni come Original / Italian come ordine di apparizione
   */
  private async fallbackFilterYearSearch(normalizedTitle: string, startDate: string, isMovie: boolean, episodeNumber: number | null, seasonNumber: number | null): Promise<{ streams: StreamForStremio[] }> {
    try {
      debug(3, 'AnimeWorld', '[AnimeWorld][FallbackFilter] Triggered with title=', normalizedTitle, 'date=', startDate);
      // Emula lo "split(':')[0]" aggressivo del vecchio script: tronca al primo ':' o '?'
      // Solo per le serie: nei film il sottotitolo fa parte del titolo, e troncarlo
      // trasforma la richiesta di un film in un episodio della serie omonima.
      let query = normalizedTitle;
      if (!isMovie && normalizedTitle.includes(':')) {
        query = normalizedTitle.split(':')[0];
      } else if (!isMovie && normalizedTitle.includes('?')) {
        query = normalizedTitle.split('?')[0];
      }
      query = query.trim();
      debug(3, 'AnimeWorld', '[AnimeWorld][FallbackFilter] Truncated query:', query);
      // Nel vecchio script poi spazio -> '+' prima della costruzione URL; lo scraper fa gia' replace interno (spazi -> +) prima di generare URL, passiamo quindi query semplice
      const results = await invokePython(['search','--query', query,'--date', startDate]);
      if (!Array.isArray(results) || !results.length) {
        debug(3, 'AnimeWorld', '[AnimeWorld][FallbackFilter] No results from filter year search');
        return { streams: [] };
      }
      // Il vecchio codice prendeva results[0] e results[1] etichettandoli per posizione
      // (0 = Original, 1 = Italian): con due SUB in cima serviva un SUB spacciato per ITA,
      // spesso pure di un'altra parte della stagione. Ora la lingua viene dallo slug.
      // I candidati restano ancorati allo slug base del primo risultato, altrimenti senza
      // versione ITA si pescherebbe lo slug -ita di un anime completamente diverso.
      // Preferenza: il titolo mostrato nei risultati, che e' nella stessa lingua della query
      // (a meno del marcatore "(ITA)"). Gli slug non bastano: AnimeWorld nomina la stessa
      // parte in modi diversi per SUB e ITA (…-2nd-season-part-2 contro …-2-part-2-ita),
      // quindi un confronto per prefisso di slug perde la versione ITA.
      const wanted = normalizeSearchTitleKey(normalizedTitle);
      let related = results.filter(r => r.searchTitle && normalizeSearchTitleKey(r.searchTitle) === wanted);
      if (related.length) {
        debug(3, 'AnimeWorld', '[AnimeWorld][FallbackFilter] Match per titolo:', wanted, '->', related.length, '/', results.length);
      } else {
        // Nessun titolo utile (markup cambiato, o titolo diverso dalla query): ripiego
        // sull'ancora del primo risultato inerente alla query, che segue la rilevanza
        // della ricerca. Mai results[0] alla cieca: senza risultati inerenti -> 0 stream.
        const anchorSource = results.find(r => awResultsRelateToQuery([r], query));
        const anchor = anchorSource
          ? animeWorldSlugBase(anchorSource.slug || anchorSource.id || anchorSource.name)
          : '';
        related = anchor
          ? results.filter(r => animeWorldSlugBase(r.slug || r.id || r.name).startsWith(anchor))
          : [];
        debug(3, 'AnimeWorld', '[AnimeWorld][FallbackFilter] Nessun match per titolo, anchor base:', anchor, '->', related.length, '/', results.length);
      }
      const picked = [
        ...related.filter(r => isItaSlug(r.slug || r.id || r.name)).slice(0, 1),
        ...related.filter(r => !isItaSlug(r.slug || r.id || r.name)).slice(0, 1),
      ];
      const streams: StreamForStremio[] = [];
      for (const r of picked) {
        const slug = r.slug || r.id || r.name;
        if (!slug) continue;
        try {
          const episodes: AnimeWorldEpisode[] = await invokePython(['get_episodes','--anime-slug', slug]);
          if (!episodes || !episodes.length) continue;
          let target: AnimeWorldEpisode | undefined;
            if (isMovie) target = episodes[0];
            else if (episodeNumber != null) target = episodes.find(e => e.number === episodeNumber);
            else target = episodes[0];
          if (!target) continue; // episodio richiesto non trovato
          const epNum = episodeNumber != null ? episodeNumber : target.number;
          let streamData: any = null;
          try {
            streamData = await invokePython(['get_stream','--anime-slug', slug, ...(epNum != null ? ['--episode', String(epNum)] : [])]);
          } catch (e) {
            console.warn('[AnimeWorld][FallbackFilter] get_stream error', slug, e);
            continue;
          }
          const mp4 = streamData?.mp4_url;
          if (!mp4) continue;
          const baseName = animeWorldDisplayName(r.searchTitle || r.name, slug, normalizedTitle);
          let titleStream = `${capitalize(baseName)} ▪ ${isItaSlug(slug) ? 'ITA' : 'SUB'}`;
          const epTag = episodeTag(seasonNumber, episodeNumber);
          if (epTag) titleStream += ` ▪ ${epTag}`;
          const streamOut = buildAnimeWorldStreamOutput(mp4, slug, this.config, { bingeGroup: 'animeworld-fallback' });
          streams.push({ title: titleStream, url: streamOut.url, behaviorHints: streamOut.behaviorHints });
        } catch (e) {
          console.warn('[AnimeWorld][FallbackFilter] error processing slug', r.slug, e);
        }
      }
      debug(3, 'AnimeWorld', '[AnimeWorld][FallbackFilter] Produced streams:', streams.length);
      return { streams };
    } catch (e) {
      console.error('[AnimeWorld][FallbackFilter] failure', e);
      return { streams: [] };
    }
  }
}

/** AnimeWorld marca il doppiaggio italiano col suffisso -ita / -cr-ita / -ita-cr sullo slug base. */
export function isItaSlug(slugOrName: string): boolean {
  const base = String(slugOrName || '').split('.')[0].toLowerCase();
  if (/(?:^|[-_])sub[-_]?ita$/.test(base)) return false;
  return /(?:^|[-_])(?:ita|cr[-_]?ita|ita[-_]?cr)$/.test(base);
}

/**
 * Nome da mostrare in etichetta. La ricerca di AnimeWorld stampa due <a> per scheda
 * (prima il poster coi soli badge, poi il titolo vero) e la deduplica tiene il primo:
 * il `name` che arriva qui e' spesso vuoto, un badge di lingua ("DUB") o lo slug nudo.
 * Non si puo' sistemare in awSearch: un name vuoto e' il segnale su cui si regge
 * AdjustEmptyName, che corregge in SUB ITA gli slug base che il LangProbe sbaglia.
 */
export function animeWorldDisplayName(name: string | undefined, slug: string, fallback = ''): string {
  const clean = String(name || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\b(?:DUB|SUB|CR)\b/gi, '')
    .replace(/\((?:ITA|CR)\)/gi, '')
    .replace(/\b(?:ITA|Movie|Special)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const looksLikeSlug = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[A-Za-z0-9_-]+)?$/.test(clean) && !clean.includes(' ');
  if (clean.length >= 3 && !looksLikeSlug) return clean;
  const fromSlug = animeWorldSlugBase(slug).replace(/[^a-z0-9]+/gi, ' ').trim();
  return fromSlug || String(fallback || '').trim() || slug;
}

export { normalizeSearchTitleKey, animeWorldSlugBase };

function capitalize(str: string) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
