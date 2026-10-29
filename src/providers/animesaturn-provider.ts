import { AnimeSaturnConfig, AnimeSaturnResult, StreamForStremio } from '../types/animeunity.js';
import * as cheerio from 'cheerio';
import { selectHighestHlsVariant } from './animeunity-parsers.js';
import { getDomain } from '../utils/domains.js';
import { debug, redactUrl } from '../utils/logger.js';
import { checkIsAnimeById, applyUniversalAnimeTitleNormalization } from '../utils/animeGate.js';
import { buildEasyProxyHlsUrl, buildEasyProxyStreamUrl } from '../utils/easyproxy.js';
import {
  buildTitleFallbackQueries,
  normalizeTitleForSearch,
  titleMatchScoreAny,
  type TitleNormalizationOptions,
} from '../utils/anime-title-normalization.js';
import {
  createCaches,
  fetchResource,
  getProviderUrl,
  toAbsoluteUrl,
  normalizeRequestedEpisode,
  parsePositiveInt,
  normalizePlayableMediaUrl,
  normalizeHostLabel,
  inferSourceTag,
  BLOCKED_DOMAINS,
  getEnglishTitleFromAnyId,
  episodeTag,
  italianSeasonQuery,
  sameTitle,
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

const AS_FETCH_TIMEOUT = Number.parseInt(process.env.ANIMESATURN_FETCH_TIMEOUT_MS || '10000', 10) || 10000;
// Le liste dei siti cambiano di rado: 12 ore evitano di rifare la stessa
// ricerca (e di ripresentare la raffica al WAF) a ogni apertura.
const SEARCH_TTL_MS = 12 * 60 * 60 * 1000;
const asCaches = createCaches();
const AS_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function buildSaturnHeaders(referer?: string): Record<string, string> {
  const h: Record<string, string> = {
    'user-agent': AS_USER_AGENT,
    'accept-language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
  };
  if (referer) h.referer = referer;
  return h;
}

function getSaturnBaseUrl(): string {
  const configured = getProviderUrl('animesaturn', ['ANIMESATURN_BASE_URL', 'AS_BASE_URL']);
  const raw = configured || `https://${getDomain('animesaturn') || 'animesaturn.net'}`;
  try {
    const u = new URL(String(raw).replace(/\/+$/, ''));
    if (!/^www\./i.test(u.hostname)) u.hostname = `www.${u.hostname}`;
    return u.origin;
  } catch {
    const host = (getDomain('animesaturn') || 'animesaturn.net').replace(/^www\./i, '');
    return `https://www.${host}`;
  }
}

function normalizeAnimeSaturnPath(pathOrUrl: string | null | undefined): string | null {
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
  const match = value.match(/^\/anime\/[^/?#]+/i);
  return match ? match[0] : null;
}

function normalizeEpisodePath(pathOrUrl: string | null | undefined): string | null {
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
  const match = value.match(/^\/episode\/[^/?#]+\/ep-\d+/i);
  return match ? match[0] : null;
}

function buildSaturnUrl(pathOrUrl: string | null | undefined): string | null {
  const text = String(pathOrUrl || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('/')) return `${getSaturnBaseUrl()}${text}`;
  return `${getSaturnBaseUrl()}/${text}`;
}

function sanitizeAnimeTitle(rawTitle: string | null | undefined): string | null {
  let text = String(rawTitle || '').trim();
  if (!text) return null;
  text = text.replace(/^\s*AnimeSaturn\s*-\s*/i, '')
             .replace(/\s*-\s*AnimeSaturn.*$/i, '')
             .replace(/\s+Streaming.*$/i, '')
             .replace(/\s+Episodi.*$/i, '')
             .replace(/\s+episodio\s*\d+(?:[.,]\d+)?\b/gi, '')
             .replace(/\s+episode\s*\d+(?:[.,]\d+)?\b/gi, '')
             .trim();
  text = text.replace(/\s*[\[(]\s*(?:SUB\s*ITA|ITA|SUB|DUB(?:BED)?|DOPPIATO)\s*[\])]\s*/gi, ' ')
             .replace(/\s*[-–_|:]\s*(?:SUB\s*ITA|ITA|SUB|DUB(?:BED)?|DOPPIATO)\s*$/gi, '')
             .replace(/\s{2,}/g, ' ')
             .replace(/\s*[-–_|:]\s*$/g, '')
             .trim();
  return text || null;
}

function decodeHtmlEntities(value: string | null | undefined): string {
  return String(value || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function stripHtmlTags(value: string | null | undefined): string {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function getTagAttribute(tag: string | null | undefined, attrName: string): string | null {
  const escaped = String(attrName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
  const match = String(tag || '').match(regex);
  return match ? decodeHtmlEntities(match[2]) : null;
}

function getFirstTagText(html: string | null | undefined, tagName: string): string {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = String(html || '').match(regex);
  return match ? stripHtmlTags(match[1]) : '';
}

function getMetaContent(html: string | null | undefined, propertyValue: string): string | null {
  const escaped = String(propertyValue || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<meta\\b(?=[^>]*(?:property|name)\\s*=\\s*["']${escaped}["'])[\\s\\S]*?>`, 'i');
  const match = String(html || '').match(regex);
  return match ? getTagAttribute(match[0], 'content') : null;
}

interface AnchorMatch {
  href: string;
  title: string;
  text: string;
}

function collectAnchorMatches(html: string | null | undefined, hrefNeedle: string): AnchorMatch[] {
  const anchors: AnchorMatch[] = [];
  const regex = /<a\b[^>]*href\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  const content = String(html || '');
  while ((match = regex.exec(content)) !== null) {
    const tag = match[0];
    const href = decodeHtmlEntities(match[2]);
    if (!String(href || '').includes(hrefNeedle)) continue;
    anchors.push({
      href,
      title: getTagAttribute(tag, 'title') || '',
      text: stripHtmlTags(match[3]),
    });
  }
  return anchors;
}

function parseEpisodeNumber(value: string | null | undefined, fallbackNum: number): number {
  const raw = String(value || '').trim();
  if (!raw) return fallbackNum;
  const byHref = raw.match(/\/ep-(\d+)/i);
  if (byHref) {
    const parsed = Number.parseInt(byHref[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const byLabel = raw.match(/episodio\s*(\d+)/i);
  if (byLabel) {
    const parsed = Number.parseInt(byLabel[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallbackNum;
}

function extractWatchUrlsFromHtml(html: string, expectedFileId: string | null = null): string[] {
  const text = String(html || '');
  const values = new Set<string>();
  let match: RegExpExecArray | null;
  const absoluteRegex = /https?:\/\/[^\s"'<>\\]+\/watch\?file=[^"'<>\\\s]+/gi;
  while ((match = absoluteRegex.exec(text)) !== null) values.add(match[0]);
  const relativeRegex = /\/watch\?file=[^"'<>\\\s]+/gi;
  while ((match = relativeRegex.exec(text)) !== null) {
    const abs = buildSaturnUrl(match[0]);
    if (abs) values.add(abs);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  values.forEach((candidate) => {
    try {
      const parsed = new URL(candidate, getSaturnBaseUrl());
      if (parsed.pathname !== '/watch') return;
      const fileParam = parsed.searchParams.get('file');
      if (!fileParam) return;
      if (expectedFileId && fileParam !== expectedFileId) return;
      const abs = parsed.toString();
      if (!seen.has(abs)) {
        seen.add(abs);
        out.push(abs);
      }
      if (!parsed.searchParams.has('s')) {
        parsed.searchParams.set('s', 'alt');
        const alt = parsed.toString();
        if (!seen.has(alt)) {
          seen.add(alt);
          out.push(alt);
        }
      }
    } catch {
      // ignore
    }
  });
  return out;
}

interface MediaLink {
  href: string;
  label: string;
}

function collectMediaLinksFromWatchHtml(html: string | null | undefined): MediaLink[] {
  const links: MediaLink[] = [];
  const seen = new Set<string>();
  function addLink(href: string | null | undefined, label: string) {
    const playable = normalizePlayableMediaUrl(href, getSaturnBaseUrl());
    if (!playable || seen.has(playable)) return;
    seen.add(playable);
    links.push({ href: playable, label });
  }
  const sourceRegex = /<source\b[^>]*src\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi;
  let sourceMatch: RegExpExecArray | null;
  const content = String(html || '');
  while ((sourceMatch = sourceRegex.exec(content)) !== null) {
    addLink(decodeHtmlEntities(sourceMatch[2]), 'Player');
  }
  const rawHtml = String(html || '');
  const variants = [rawHtml, rawHtml.replace(/\\\//g, '/')];
  for (const text of variants) {
    let match: RegExpExecArray | null;
    const directRegex = /https?:\/\/[^\s"'<>\\]+(?:\.mp4|\.m3u8)(?:[^\s"'<>\\]*)?/gi;
    while ((match = directRegex.exec(text)) !== null) {
      addLink(match[0], 'Player');
    }
    const encodedRegex = /https%3A%2F%2F[^\s"'<>\\]+/gi;
    while ((match = encodedRegex.exec(text)) !== null) {
      try {
        addLink(decodeURIComponent(match[0]), 'Player');
      } catch {
        // ignore
      }
    }
    const sourceRegex2 = /(?:file|src|url|link)\s*[:=]\s*["']([^"']+)["']/gi;
    while ((match = sourceRegex2.exec(text)) !== null) {
      addLink(match[1], 'Player');
    }
  }
  return links;
}

function extractEmbedUrlFromWatchHtml(html: string | null | undefined): string | null {
  const content = String(html || '');
  const match = content.match(/<iframe\b[^>]*src\s*=\s*["']([^"']*play\.saturncdn\.net[^"']*)["']/i);
  if (match) return decodeHtmlEntities(match[1]);
  const dataMatch = content.match(/initialVideoUrl\s*:\s*["']([^"']*)["']/i);
  if (dataMatch) return decodeHtmlEntities(dataMatch[1]);
  return null;
}

function base64XorDecrypt(encoded: string, key: string): string | null {
  if (!encoded || !key) return null;
  try {
    const bytes = typeof Buffer !== 'undefined'
      ? Buffer.from(encoded, 'base64').toString('binary')
      : atob(encoded);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      out += String.fromCharCode(bytes.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return out;
  } catch {
    return null;
  }
}

async function resolvePlaylistUrl(embedUrl: string): Promise<string | null> {
  if (!embedUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(embedUrl);
  } catch {
    return null;
  }
  const pathMatch = parsed.pathname.match(/\/embed\/(\d+)/);
  if (!pathMatch) return embedUrl;
  const id = pathMatch[1];
  const token = parsed.searchParams.get('token');
  const expires = parsed.searchParams.get('expires');
  if (!id || !token || !expires) return embedUrl;
  
  const playlistUrl = `${parsed.origin}/embed/${id}/playlist?token=${encodeURIComponent(token)}&expires=${encodeURIComponent(expires)}`;
  
  try {
    const payload = await fetchResource(playlistUrl, asCaches, {
      as: 'json',
      ttlMs: 5 * 60 * 1000,
      cacheKey: `playlist:${embedUrl}`,
      timeoutMs: AS_FETCH_TIMEOUT,
      headers: {
        'Accept': '*/*',
        'Origin': parsed.origin,
        'Referer': embedUrl,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'user-agent': AS_USER_AGENT,
      },
    });
    if (!payload || !payload.d) return embedUrl;
    const decrypted = base64XorDecrypt(payload.d, token);
    if (decrypted) return decrypted;
  } catch (error: any) {
    console.error('[AnimeSaturn] playlist resolution failed:', error.message);
  }
  return embedUrl;
}

async function resolveWatchUrlsForEpisodeEntry(
  episodeEntry: { num: number; token: string; episodePath: string | null; watchUrl: string | null }
): Promise<string[]> {
  const urls: string[] = [];
  if (episodeEntry?.watchUrl) {
    urls.push(...extractWatchUrlsFromHtml(episodeEntry.watchUrl));
  }
  if (urls.length === 0 && episodeEntry?.episodePath) {
    const watchPath = episodeEntry.episodePath.replace(/^\/episode\//, '/anime/');
    const watchUrl = buildSaturnUrl(watchPath);
    if (watchUrl) urls.push(watchUrl);
  }
  if (urls.length === 0 && episodeEntry?.episodePath) {
    const episodeUrl = buildSaturnUrl(episodeEntry.episodePath);
    if (episodeUrl) {
      try {
        const html = await fetchResource(episodeUrl, asCaches, {
          ttlMs: 5 * 60 * 1000,
          cacheKey: `episode-page:${episodeEntry.episodePath}`,
          timeoutMs: AS_FETCH_TIMEOUT,
          headers: buildSaturnHeaders(),
        });
        urls.push(...extractWatchUrlsFromHtml(html));
      } catch (error: any) {
        console.error('[AnimeSaturn] episode page request failed:', error.message);
      }
    }
  }
  const clean = urls.map((url) => toAbsoluteUrl(url, getSaturnBaseUrl()) || '').filter(Boolean);
  const seen = new Set<string>();
  return clean.filter((v) => {
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
}

interface ParsedSaturnPage {
  title: string | null;
  animePath: string | null;
  sourceTag: 'ITA' | 'SUB';
  episodes: { num: number; token: string; episodePath: string | null; watchUrl: string | null }[];
}

function parseAnimeSaturnPage(html: string, fallback: { animePath?: string | null; title?: string | null } = {}): ParsedSaturnPage {
  const pageTitle = getFirstTagText(html, 'h1') || getMetaContent(html, 'og:title') || getFirstTagText(html, 'title') || null;
  const title = sanitizeAnimeTitle(fallback.title) || sanitizeAnimeTitle(pageTitle) || null;
  const animePath = normalizeAnimeSaturnPath(fallback.animePath || null);
  const sourceTag = inferSourceTag(title, animePath);
  const episodes: { num: number; token: string; episodePath: string | null; watchUrl: string | null }[] = [];
  const seenEpisodePath = new Set<string>();
  
  collectAnchorMatches(html, '/episode/').forEach((anchor, index) => {
    const href = normalizeEpisodePath(anchor.href);
    if (!href || seenEpisodePath.has(href)) return;
    seenEpisodePath.add(href);
    const probe = `${href} ${anchor.text || ''} ${anchor.title || ''}`;
    const num = parseEpisodeNumber(probe, index + 1);
    episodes.push({
      num,
      token: href,
      episodePath: href,
      watchUrl: null,
    });
  });

  if (episodes.length === 0) {
    const watchUrls = extractWatchUrlsFromHtml(html);
    if (watchUrls.length > 0) {
      episodes.push({
        num: 1,
        token: 'watch-1',
        episodePath: null,
        watchUrl: watchUrls[0],
      });
    }
  }

  episodes.sort((a, b) => a.num - b.num);
  return {
    title,
    animePath,
    sourceTag,
    episodes,
  };
}

function normalizeEpisodesList(sourceEpisodes: any[] = []): { num: number; token: string; episodePath: string | null; watchUrl: string | null }[] {
  if (!Array.isArray(sourceEpisodes) || sourceEpisodes.length === 0) return [];
  const out: { num: number; token: string; episodePath: string | null; watchUrl: string | null }[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < sourceEpisodes.length; index += 1) {
    const entry = sourceEpisodes[index] || {};
    const numRaw = Number.parseInt(String(entry.num !== undefined && entry.num !== null ? entry.num : index + 1), 10);
    const num = Number.isFinite(numRaw) && numRaw > 0 ? numRaw : index + 1;
    const episodePath = normalizeEpisodePath(entry.episodePath || entry.href || entry.token || null);
    const watchUrl = toAbsoluteUrl(entry.watchUrl || null, getSaturnBaseUrl());
    const token = String(entry.token || episodePath || watchUrl || `ep-${num}`).trim();
    const key = `${num}|${episodePath || ''}|${watchUrl || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ num, token, episodePath, watchUrl });
  }
  out.sort((a, b) => a.num - b.num);
  return out;
}

function pickEpisodeEntry(
  episodes: any[],
  requestedEpisode: number,
  mediaType = 'tv'
): { num: number; token: string; episodePath: string | null; watchUrl: string | null } | null {
  const list = normalizeEpisodesList(episodes);
  if (list.length === 0) return null;
  if (mediaType === 'movie') return list[0];
  const episode = normalizeRequestedEpisode(requestedEpisode);
  const byNum = list.find((entry) => entry.num === episode);
  if (byNum) return byNum;
  return null;
}

async function asSearch(query: string): Promise<AnimeSaturnResult[]> {
  const qRaw = String(query || '').trim();
  const q = encodeURIComponent(qRaw);
  if (!q) return [];

  // Nuova API JSON: GET /api/search?q=...
  // Sostituisce la vecchia /index.php?search=1&key=... (404 dopo il restyling del sito).
  let apiSucceeded = false;
  try {
    const apiUrl = `${getSaturnBaseUrl()}/api/search?q=${q}`;
    const apiData = await fetchResource(apiUrl, asCaches, {
      ttlMs: SEARCH_TTL_MS,
      cacheKey: `as-search-api:${qRaw.toLowerCase()}`,
      as: 'json',
      timeoutMs: AS_FETCH_TIMEOUT,
      headers: {
        ...buildSaturnHeaders(`${getSaturnBaseUrl()}/`),
        accept: 'application/json,text/javascript,*/*;q=0.01',
        'x-requested-with': 'XMLHttpRequest',
      },
    });

    const outFromApi: AnimeSaturnResult[] = [];
    const seen = new Set<string>();
    // Formato nuovo: { query, results: [{ title, url }] } — formato vecchio: [{ name, link }]
    const isKnownFormat = Array.isArray(apiData) || Array.isArray((apiData as any)?.results);
    if (isKnownFormat) apiSucceeded = true;
    const records: any[] = Array.isArray(apiData)
      ? apiData
      : Array.isArray((apiData as any)?.results)
        ? (apiData as any).results
        : [];
    for (const item of records) {
      const rawUrl = String(item?.url || item?.link || '').trim();
      if (!rawUrl) continue;
      const path = normalizeAnimeSaturnPath(
        rawUrl.startsWith('/') || /^https?:\/\//i.test(rawUrl) ? rawUrl : `/anime/${rawUrl}`
      );
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const title = String(item?.title || item?.name || path).replace(/\s+/g, ' ').trim();
      outFromApi.push({ title, url: buildSaturnUrl(path) || `${getSaturnBaseUrl()}${path}` });
    }
    debug(2, 'AnimeSaturn', `[AnimeSaturn][Search] API /api/search?q="${qRaw}" -> ${outFromApi.length} risultati`);
    if (outFromApi.length) return outFromApi;
  } catch (err: any) {
    console.warn('[AnimeSaturn][Search] API /api/search fallita, fallback HTML:', err?.message || err);
  }

  // API raggiunta con formato valido ma 0 risultati: il sito non ha nulla per la
  // query, i fallback HTML non aggiungono nulla e costano 2 richieste a testa.
  if (apiSucceeded) return [];

  // Fallback HTML: sito nuovo -> /filter?key=... ; sito vecchio -> /?search=...
  const urls = [
    `${getSaturnBaseUrl()}/filter?key=${q}`,
    `${getSaturnBaseUrl()}/?search=${q}`,
  ];
  const out: AnimeSaturnResult[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    let html = '';
    try {
      html = await fetchResource(url, asCaches, {
        ttlMs: SEARCH_TTL_MS,
        cacheKey: `as-search:${url}`,
        timeoutMs: AS_FETCH_TIMEOUT,
        headers: buildSaturnHeaders(`${getSaturnBaseUrl()}/`),
      });
    } catch (err: any) {
      console.warn(`[AnimeSaturn][Search] scraping HTML fallito per ${url}:`, err?.message || err);
      continue;
    }
    const $ = cheerio.load(String(html || ''));
    $('a[href*="/anime/"]').each((_, el) => {
      const $el = $(el);
      const href = String($el.attr('href') || '').trim();
      const path = normalizeAnimeSaturnPath(href);
      if (!path || seen.has(path)) return;
      seen.add(path);
      // Markup nuovo: titolo in <h3 class="ac__title"> o nell'alt della locandina;
      // markup vecchio: attributo title o testo dell'anchor.
      const title = (
        $el.find('h3.ac__title').first().text().trim() ||
        String($el.find('img[alt]').first().attr('alt') || '').trim() ||
        String($el.attr('title') || '').trim() ||
        $el.text().trim() ||
        path
      ).replace(/\s+/g, ' ').trim();
      if (title && qRaw) {
        const t = normalizeUnicodeToAscii(title.toLowerCase());
        const qn = normalizeUnicodeToAscii(qRaw.toLowerCase());
        if (!t.includes(qn) && !qn.includes(t)) return;
      }
      out.push({ title, url: buildSaturnUrl(path) || `${getSaturnBaseUrl()}${path}` });
    });
    debug(2, 'AnimeSaturn', `[AnimeSaturn][Search] scraping HTML ${url} -> ${out.length} risultati cumulativi`);
    if (out.length) break;
  }
  return out;
}

function normalizeApostrophes(str: string): string {
  return str.replace(/['’‘]/g, "'");
}

export function filterAnimeResults(
  results: { version: AnimeSaturnResult; language_type: string }[],
  titles: string[]
) {
  const norm = (s: string) => normalizeApostrophes(normalizeUnicodeToAscii(s.toLowerCase().replace(/\s+/g, ' ').trim()));
  const baseRaw = norm(titles[0] || '');
  const scored = results
    .map((result) => ({ result, score: titleMatchScoreAny(titles, result.version.title) }))
    .filter((entry) => entry.score > 0);
  const best = scored.reduce((max, entry) => Math.max(max, entry.score), 0);
  // Il sito a volte ha solo il titolo italiano ("La scomparsa di Haruhi
  // Suzumiya" contro la query "The Disappearance…"): score 0, ma il match l'ha
  // fatto la ricerca del sito. Un solo risultato per una query di almeno due
  // parole è affidabile; i casi ambigui arrivano sempre come liste lunghe.
  const singleSiteMatch = results.length === 1 && baseRaw.split(' ').filter(Boolean).length >= 2;
  const filtered = best >= 0.5
    ? scored.filter((entry) => entry.score === best).map((entry) => entry.result)
    : singleSiteMatch
      ? results.map((entry) => entry)
      : [];
  if (singleSiteMatch && best < 0.5) {
    debug(2, 'AnimeSaturn', `[AnimeSaturn] Unico risultato del sito accettato senza match di titolo: "${results[0].version.title}"`);
  }

  debug(4, 'AnimeSaturn', 'DEBUG filtro:', {
    base: baseRaw,
    titoli: results.map(r => ({ raw: r.version.title, score: titleMatchScoreAny(titles, r.version.title) }))
  });

  debug(3, 'AnimeSaturn', `[UniversalTitle] Risultati prima del filtro:`, results.map(r => r.version.title));
  debug(3, 'AnimeSaturn', `[UniversalTitle] Risultati dopo il filtro:`, filtered.map(r => r.version.title));
  return filtered;
}

const animeSaturnTitleNormalization: TitleNormalizationOptions = {
  exactMap: {
    "Demon Slayer: Kimetsu no Yaiba - The Movie: Infinity Castle": "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
    "Attack on Titan: The Final Season - Final Chapters Part 2": "L'attacco dei Giganti: L'ultimo attacco",
    'Ore dake Level Up na Ken': 'Solo Leveling',
    'Lupin the Third: The Woman Called Fujiko Mine': 'Lupin III - La donna chiamata Fujiko Mine ',
    "Slam Dunk: Roar!! Basket Man Spiriy": "Slam Dunk: Hoero Basketman-damashii! Hanamichi to Rukawa no Atsuki Natsu",
    "Parasyte: The Maxim": "Kiseijuu",
    "Attack on Titan OAD": "L'attacco dei Giganti: Il taccuino di Ilse",
    "Fullmetal Alchemist: Brotherhood": "Fullmetal Alchemist Brotherhood",
    "Slam Dunk: Roar!! Basket Man Spirit": "Slam Dunk: Hoero Basketman-damashii! Hanamichi to Rukawa no Atsuki Natsu",
    "Slam Dunk: Shohoku Maximum Crisis! Burn Sakuragi Hanamichi": "Slam Dunk: Shouhoku Saidai no Kiki! Moero Sakuragi Hanamichi",
    "Slam Dunk: National Domination! Sakuragi Hanamichi": "Slam Dunk: Zenkoku Seiha Da! - Sakuragi Hanamichi",
    "JoJo's Bizarre Adventure (2012)": "Le Bizzarre Avventure di JoJo",
    "JoJo's Bizarre Adventure: Stardust Crusaders": "Le Bizzarre Avventure di JoJo: Stardust Crusaders",
    "Cat's Eye (2025)": "Occhi di gatto (2025)",
    "Cat's\u2665Eye": "Occhi di gatto (2025)",
    "Ranma \u00bd (2024) Season 2": "Ranma \u00bd (2024) 2",
    "Ranma1/2 (2024) Season 2": "Ranma \u00bd (2024) 2",
    "Link Click Season 2": "Link Click 2",
    "K: SEVEN STORIES Lost Small World - Outside the Cage - ": "K: Seven Stories Movie 4 - Lost Small World - Ori no Mukou ni",
    "Nichijou - My Ordinary Life": "Nichijou",
    "Case Closed Movie 01: The Time Bombed Skyscraper": "Detective Conan Movie 01: Fino alla fine del tempo",
    "My Hero Academia Final Season": "Boku no Hero Academia: Final Season",
    "Jujutsu Kaisen: The Culling Game Part 1": "Jujutsu Kaisen 3: The Culling Game Part 1",
    "Hell's Paradise Season 2": "Jigokuraku 2",
    "[Oshi no Ko]": "Oshi no Ko",
    "Record of Ragnarok II Part 2": "Record of Ragnarok 2 Part 2",
    "Record of Ragnarok II": "Record of Ragnarok 2",
    "Magical Circle": "Mahoujin Guru Guru",
    // Kitsu la chiama "Season 2", Saturn "La malinconia di Haruhi Suzumiya 2".
    "The Melancholy of Haruhi Suzumiya Season 2": "La malinconia di Haruhi Suzumiya 2",
    // << AUTO-INSERT-EXACT >> (non rimuovere questo commento)
  },
  replacements: [
    ['Attack on Titan', "L'attacco dei Giganti"],
    ['Season', ''],
    ['Shippuuden', 'Shippuden'],
  ],
  replacementMode: 'literal',
  stripSpacedHyphen: true,
  stripColonAfter: 'Naruto:',
};

function normalizeUnicodeToAscii(str: string): string {
  return str
    .replace(/[\u2019\u2018'']/g, "'")
    .replace(/[\u201C\u201D""]/g, '"')
    .replace(/\u003A/g, ':');
}

/**
 * Se il media è un master HLS, sceglie la variante con risoluzione più alta.
 * Se il fetch fallisce o non è un master, restituisce l'URL originale: il
 * proxy HLS può comunque applicare max_res=true come fallback.
 */
export async function selectHighestSaturnHls(mediaUrl: string, referer: string): Promise<string> {
  if (!/\.m3u8(?:[?#]|$)/i.test(mediaUrl)) return mediaUrl;
  try {
    const manifest = String(await fetchResource(mediaUrl, asCaches, {
      ttlMs: 5 * 60 * 1000,
      cacheKey: `hls-master:${mediaUrl}`,
      timeoutMs: AS_FETCH_TIMEOUT,
      proxyPlatform: 'animesaturn',
      headers: {
        ...buildSaturnHeaders(referer),
        accept: '*/*',
      },
    }) || '');
    const highest = selectHighestHlsVariant(manifest, mediaUrl);
    if (highest) {
      debug(4, 'AnimeSaturn', '[AnimeSaturn] Variante HLS massima selezionata:', redactUrl(highest));
      return highest;
    }
  } catch (error: any) {
    console.warn('[AnimeSaturn] Selezione variante HLS fallita:', error?.message || error);
  }
  return mediaUrl;
}

export class AnimeSaturnProvider {
  constructor(private config: AnimeSaturnConfig) {}

  private applyEasyProxy(streams: StreamForStremio[]): StreamForStremio[] {
    const proxyUrl = String(this.config.proxyUrl || '').trim();
    if (!proxyUrl) return streams;

    // shortcut: gli embed non riconosciuti restano diretti, aggiungere extractor quando EasyProxy copre l'host.
    return streams.map((stream) => {
      const target = String(stream.url || '');
      const isHls = /\.m3u8(?:[?#]|$)/i.test(target);
      const isFile = /\.(?:mp4|mkv|avi|webm|mov)(?:[?#]|$)/i.test(target);
      if (!isHls && !isFile) return stream;

      const headers = (stream.behaviorHints && stream.behaviorHints.headers) || {};
      let url = isHls
        ? buildEasyProxyHlsUrl(target, proxyUrl, this.config.proxyPassword, headers)
        : buildEasyProxyStreamUrl(target, proxyUrl, this.config.proxyPassword, headers);

      // Fallback: se la selezione server-side non ha trovato il master, EasyProxy sceglie la variante più alta.
      if (isHls) {
        try {
          const parsed = new URL(url);
          parsed.searchParams.set('max_res', 'true');
          url = parsed.toString();
        } catch {
          // URL non valido: lascia il valore originale.
        }
      }

      return { ...stream, url };
    });
  }

  async searchAllVersions(title: string): Promise<{ version: AnimeSaturnResult; language_type: string }[]> {
    let results = await asSearch(title);
    if (results.length <= 1 && title.includes("'")) {
      const titleTypo = title.replace(/'/g, '’');
      const moreResults = await asSearch(titleTypo);
      const seen = new Set(results.map(r => r.url));
      for (const r of moreResults) {
        if (!seen.has(r.url)) results.push(r);
      }
    }
    results = results.map(r => ({
      ...r,
      title: normalizeUnicodeToAscii(r.title)
    }));
    results.forEach(r => {
      debug(4, 'AnimeSaturn', 'DEBUG titolo JSON normalizzato:', r.title);
    });
    return results.map(r => {
      const nameLower = r.title.toLowerCase();
      let language_type = 'SUB ITA';
      if (nameLower.includes('cr')) {
        language_type = 'CR ITA';
      } else if (nameLower.includes('ita')) {
        language_type = 'ITA';
      }
      return { version: { ...r, title: r.title }, language_type };
    });
  }

  private async extractStreamsFromAnimePath(
    animePath: string,
    requestedEpisode: number,
    seasonNumber: number | null,
    mediaType = 'tv',
    originalEpisode: number | null = null
  ): Promise<StreamForStremio[]> {
    const normalizedPath = normalizeAnimeSaturnPath(animePath);
    if (!normalizedPath) return [];
    const animeUrl = buildSaturnUrl(normalizedPath);
    if (!animeUrl) return [];
    
    let parsedPage: ParsedSaturnPage;
    try {
      const html = await fetchResource(animeUrl, asCaches, {
        ttlMs: 15 * 60 * 1000,
        cacheKey: `anime:${normalizedPath}`,
        timeoutMs: AS_FETCH_TIMEOUT,
        headers: buildSaturnHeaders(),
      });
      parsedPage = parseAnimeSaturnPage(html, { animePath: normalizedPath });
    } catch (error: any) {
      console.error('[AnimeSaturn] anime page request failed:', error.message);
      return [];
    }

    const normalizedEpisode = normalizeRequestedEpisode(requestedEpisode);
    const normalizedOriginalEpisode = normalizeRequestedEpisode(
      originalEpisode === null || originalEpisode === undefined ? normalizedEpisode : originalEpisode
    );

    const episodes = normalizeEpisodesList(parsedPage.episodes);
    const selected = pickEpisodeEntry(episodes, normalizedEpisode, mediaType);

    if (!selected) return [];

    const baseTitle = sanitizeAnimeTitle(parsedPage.title) || 'Unknown Title';
    const resolvedEpisode = parsePositiveInt(selected.num) || normalizedEpisode;

    if (String(parsedPage.sourceTag || '').toUpperCase() === 'ITA' && resolvedEpisode !== normalizedOriginalEpisode) {
      debug(3, 'AnimeSaturn', `[AnimeSaturn] Skipping ITA episode ${resolvedEpisode} (requested ${normalizedOriginalEpisode}).`);
      return [];
    }

    const initialWatchUrls = await resolveWatchUrlsForEpisodeEntry(selected);

    if (initialWatchUrls.length === 0) return [];
    
    const queue = [...initialWatchUrls];
    const visitedWatchUrls = new Set<string>();
    const streams: StreamForStremio[] = [];
    const seenMedia = new Set<string>();

    const expectedFileId = (() => {
      try {
        const parsed = new URL(initialWatchUrls[0]);
        return parsed.searchParams.get('file');
      } catch {
        return null;
      }
    })();

    let processed = 0;
    while (queue.length > 0 && processed < 6) {
      const watchUrl = queue.shift();
      if (!watchUrl || visitedWatchUrls.has(watchUrl)) continue;
      visitedWatchUrls.add(watchUrl);
      processed += 1;

      let html = '';
      try {
        html = await fetchResource(watchUrl, asCaches, {
          ttlMs: 5 * 60 * 1000,
          cacheKey: `watch:${watchUrl}`,
          timeoutMs: AS_FETCH_TIMEOUT,
          headers: {
            ...buildSaturnHeaders(animeUrl),
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'upgrade-insecure-requests': '1',
          },
        });
      } catch (error: any) {
        console.error('[AnimeSaturn] watch page request failed:', error.message);
        continue;
      }

      const embedUrl = extractEmbedUrlFromWatchHtml(html);
      if (embedUrl) {
        const resolved = await resolvePlaylistUrl(embedUrl);
        const mediaUrl = normalizePlayableMediaUrl(resolved, getSaturnBaseUrl());
        // L'embed è una pagina HTML, non un media: niente stream rotto. I link
        // diretti della stessa watch page vengono comunque letti più sotto.
        if (mediaUrl && !seenMedia.has(mediaUrl)) {
          seenMedia.add(mediaUrl);
          const finalMediaUrl = await selectHighestSaturnHls(mediaUrl, watchUrl);
          const host = normalizeHostLabel(finalMediaUrl);

          const langLabel = parsedPage.sourceTag === 'ITA' ? 'ITA' : 'SUB';
          let streamTitle = `${capitalize(baseTitle)} ▪ ${langLabel}`;
          const epTag = episodeTag(seasonNumber, mediaType !== 'movie' ? requestedEpisode : null);
          if (epTag) streamTitle += ` ▪ ${epTag}`;
          if (host) {
            streamTitle += ` (${host})`;
          }

          streams.push({
            title: streamTitle,
            url: finalMediaUrl,
            behaviorHints: {
              notWebReady: true,
              headers: {
                'User-Agent': AS_USER_AGENT,
                Referer: watchUrl,
              },
            },
          });
        }
      }

      const links = collectMediaLinksFromWatchHtml(html);
      for (const link of links) {
        const mediaUrl = normalizePlayableMediaUrl(link.href, getSaturnBaseUrl());
        if (!mediaUrl || seenMedia.has(mediaUrl)) continue;

        const finalMediaUrl = await selectHighestSaturnHls(mediaUrl, watchUrl);
        const lowerLink = finalMediaUrl.toLowerCase();
        if (lowerLink.endsWith('.mkv.mp4') || BLOCKED_DOMAINS.some((domain) => lowerLink.includes(domain))) {
          continue;
        }
        seenMedia.add(mediaUrl);
        const hostLabel = normalizeHostLabel(finalMediaUrl);

        const langLabel = parsedPage.sourceTag === 'ITA' ? 'ITA' : 'SUB';
        let streamTitle = `${capitalize(baseTitle)} ▪ ${langLabel}`;
        const epTag = episodeTag(seasonNumber, mediaType !== 'movie' ? requestedEpisode : null);
        if (epTag) streamTitle += ` ▪ ${epTag}`;
        if (hostLabel) {
          streamTitle += ` (${hostLabel})`;
        }

        streams.push({
          title: streamTitle,
          url: finalMediaUrl,
          behaviorHints: {
            notWebReady: true,
            headers: {
              'User-Agent': AS_USER_AGENT,
              Referer: watchUrl,
            },
          },
        });
      }

      const extraWatchUrls = extractWatchUrlsFromHtml(html, expectedFileId);
      for (const extra of extraWatchUrls) {
        if (!visitedWatchUrls.has(extra)) queue.push(extra);
      }
    }

    return this.applyEasyProxy(streams);
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
        } catch {}
      }
      if (!title) return { streams: [] };
      // L'id Kitsu non porta stagione: la fornisce l'indice insieme al titolo italiano.
      const target = await resolveAnimeTarget(request, this.config);
      return this.handleTitleRequest(title, null, request.episode, request.isMovie, target?.titleAlt, target?.titleIt, target?.titleItSeason);
    } catch (error) {
      console.error('Error handling Kitsu request:', error);
      return { streams: [] };
    }
  }

  async handleMalRequest(malIdString: string): Promise<{ streams: StreamForStremio[] }> {
    if (!this.config.enabled) {
      return { streams: [] };
    }
    try {
      const request = resolveMappingRequest(malIdString);
      if (!request) return { streams: [] };
      const englishTitle = await getEnglishTitleFromAnyId(request.id, 'mal', this.config.tmdbApiKey);
      debug(2, 'AnimeSaturn', `[AnimeSaturn] Ricerca con titolo inglese: ${englishTitle}`);
      return this.handleTitleRequest(englishTitle, request.season, request.episode, request.isMovie);
    } catch (error) {
      console.error('Error handling MAL request:', error);
      return { streams: [] };
    }
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
      console.warn(`[AnimeSaturn] Mapping miss for ${request.provider}:${request.id} S${season}E${episodeNumber}: no season title, returning no stream`);
      return { streams: [] };
    }
    console.warn(`[AnimeSaturn] Mapping miss for ${request.provider}:${request.id} S${season}E${episodeNumber}: using season title "${seasonTitle}"`);
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
          debug(2, 'AnimeSaturn', `[AnimeSaturn] Skipping anime search: no MAL/Kitsu mapping (${gate.reason}) for ${imdbId}`);
          return { streams: [] };
        }
      }
      const request = resolveMappingRequest(imdbId, seasonNumber, episodeNumber, isMovie);
      if (request) {
        const target = await resolveAnimeTarget(request, this.config);
        const title = target ? target.title || (await getKitsuTitle(target.kitsuId)) : '';
        if (target && title) {
          return this.handleTitleRequest(title, target.displaySeason, target.kitsuEpisode, request.isMovie, target.titleAlt, target.titleIt, target.titleItSeason);
        }
      }
      const unmapped = await this.handleUnmappedSeries(request, episodeNumber);
      if (unmapped) return unmapped;
      const englishTitle = await getEnglishTitleFromAnyId(imdbId, 'imdb', this.config.tmdbApiKey);
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
          debug(2, 'AnimeSaturn', `[AnimeSaturn] Skipping anime search: no MAL/Kitsu mapping (${gate.reason}) for TMDB ${tmdbId}`);
          return { streams: [] };
        }
      }
      const request = resolveMappingRequest(`tmdb:${tmdbId}`, seasonNumber, episodeNumber, isMovie);
      if (request) {
        const target = await resolveAnimeTarget(request, this.config);
        const title = target ? target.title || (await getKitsuTitle(target.kitsuId)) : '';
        if (target && title) {
          return this.handleTitleRequest(title, target.displaySeason, target.kitsuEpisode, request.isMovie, target.titleAlt, target.titleIt, target.titleItSeason);
        }
      }
      const unmapped = await this.handleUnmappedSeries(request, episodeNumber);
      if (unmapped) return unmapped;
      const englishTitle = await getEnglishTitleFromAnyId(tmdbId, 'tmdb', this.config.tmdbApiKey);
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
          debug(2, 'AnimeSaturn', `[AnimeSaturn] Skipping anime search: no Kitsu mapping (${gate.reason}) for TVDB ${tvdbId}`);
          return { streams: [] };
        }
      }
      const request = resolveMappingRequest(`tvdb:${tvdbId}`, seasonNumber, episodeNumber, isMovie);
      if (request) {
        const target = await resolveAnimeTarget(request, this.config);
        const title = target ? target.title || (await getKitsuTitle(target.kitsuId)) : '';
        if (target && title) {
          return this.handleTitleRequest(title, target.displaySeason, target.kitsuEpisode, request.isMovie, target.titleAlt, target.titleIt, target.titleItSeason);
        }
      }
      const unmapped = await this.handleUnmappedSeries(request, episodeNumber);
      if (unmapped) return unmapped;
      const fallbackTitle = await getTvdbTitle(tvdbId, this.config);
      if (!fallbackTitle) return { streams: [] };
      debug(2, 'AnimeSaturn', `[AnimeSaturn] Ricerca con titolo TVDB: ${fallbackTitle}`);
      return this.handleTitleRequest(fallbackTitle, seasonNumber, episodeNumber, isMovie);
    } catch (error) {
      console.error('Error handling TVDB request:', error);
      return { streams: [] };
    }
  }

  async handleTitleRequest(title: string, seasonNumber: number | null, episodeNumber: number | null, isMovie = false, titleAlt?: string | null, titleIt?: string | null, titleItSeason?: number | null): Promise<{ streams: StreamForStremio[] }> {
    debug(1, 'AnimeSaturn', 'title request', { title, titleAlt, titleIt, titleItSeason, season: seasonNumber, episode: episodeNumber, isMovie });
    const universalTitle = applyUniversalAnimeTitleNormalization(title);
    if (universalTitle !== title) {
      debug(3, 'AnimeSaturn', `[UniversalTitle][Applied] ${title} -> ${universalTitle}`);
    }
    const normalizedTitle = normalizeTitleForSearch(universalTitle, animeSaturnTitleNormalization);
    debug(2, 'AnimeSaturn', `[AnimeSaturn] Titolo normalizzato per ricerca: ${normalizedTitle}`);
    debug(3, 'AnimeSaturn', '[AnimeSaturn] Query inviata allo scraper (post-normalize):', normalizedTitle);
    // L'alternativo (romaji MAL) entra solo se l'inglese non trova nulla: così
    // non può scavalcare un match già buono. Prima si rifiltrano gli stessi
    // risultati; se il sito non ha nemmeno risposto, si usa come query.
    const altQuery = titleAlt && titleAlt !== normalizedTitle ? titleAlt : '';
    // Saturn indicizza i titoli italiani: senza sottotitolo è il primo ripiego.
    const itQueryRaw = italianSeasonQuery(titleIt, titleItSeason ?? seasonNumber, normalizedTitle);
    const itQuery = sameTitle(itQueryRaw, normalizedTitle) ? '' : itQueryRaw;
    const titles = [normalizedTitle];
    if (itQuery) titles.push(itQuery);
    const rawVersions = await this.searchAllVersions(normalizedTitle);
    let animeVersions = filterAnimeResults(rawVersions, titles);
    if (!animeVersions.length && altQuery) {
      titles.push(altQuery);
      animeVersions = filterAnimeResults(rawVersions, titles);
      if (animeVersions.length) {
        debug(2, 'AnimeSaturn', `[AnimeSaturn] Match con titolo alternativo "${altQuery}"`);
      }
    }
    if (!animeVersions.length) {
      // Budget ricerca <=3 fetch: la principale più DUE ripieghi, e il secondo
      // si paga solo se il primo ha già dato 0. Un solo ripiego non basta: per
      // un titolo con sottotitolo il primo candidato è il romaji, e i siti che
      // indicizzano in italiano restavano senza seconda possibilità.
      const hasSubtitle = /:|\s+-\s+/.test(normalizedTitle);
      const candidates = hasSubtitle
        ? [altQuery, ...buildTitleFallbackQueries(normalizedTitle)]
        : [itQuery, altQuery, ...buildTitleFallbackQueries(normalizedTitle)];
      for (const fallbackQuery of candidates.filter(q => q && !sameTitle(q, normalizedTitle)).slice(0, 2)) {
        const fallbackVersions = filterAnimeResults(await this.searchAllVersions(fallbackQuery), titles);
        if (fallbackVersions.length) {
          debug(2, 'AnimeSaturn', `[AnimeSaturn] Trovato con query di ripiego: ${fallbackQuery}`);
          animeVersions = fallbackVersions;
          break;
        }
      }
    }
    if (!animeVersions.length) {
      console.warn('[AnimeSaturn] Nessun risultato trovato per il titolo:', normalizedTitle);
      return { streams: [] };
    }
    const streams: StreamForStremio[] = [];
    const seen = new Set<string>();
    for (const { version } of animeVersions) {
      const path = normalizeAnimeSaturnPath(version.url);
      if (!path) continue;
      
      const perPath = await this.extractStreamsFromAnimePath(
        path,
        episodeNumber ?? 1,
        seasonNumber,
        isMovie ? 'movie' : 'tv',
        episodeNumber ?? 1
      );
      for (const st of perPath) {
        const key = String(st.url || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        streams.push(st);
      }
    }
    debug(1, 'AnimeSaturn', 'streams', {
      title: normalizedTitle,
      count: streams.length,
      season: seasonNumber,
      episode: episodeNumber,
      isMovie,
    });
    return { streams };
  }
}

function capitalize(str: string) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
