/**
 * Parser per il nuovo backend AnimeUnity (.at, tema "anikoto").
 * Il vecchio sito usava `<video-player embed_url>` e /info_api; qui la pagina
 * anime contiene già tutti gli episodi e i server sono risolti via ajax/server.
 */
import * as cheerio from 'cheerio';
import { parseEpisodeNumber, parsePositiveInt } from './anime-core/index.js';
import { ensurePlaylistM3u8 } from '../utils/tmdbResolver.js';

export interface AnimeUnitySearchHit {
  id: number;
  slug: string;
  name: string;
  episodes_count: number;
}

export interface AnimeUnityPageEpisode {
  id: number;
  number: number;
  name?: string;
}

export interface AnimeUnityServer {
  type: 'sub' | 'dub';
  linkId: string;
  host: string;
}

/** Estrae gli anime da `result.html` di GET /ajax/anime/search?keyword=... */
export function parseSearchResultsHtml(html: string): AnimeUnitySearchHit[] {
  const $ = cheerio.load(String(html || ''));
  const hits: AnimeUnitySearchHit[] = [];
  const seen = new Set<number>();

  $('a[href*="/anime/"]').each((_, element) => {
    const href = $(element).attr('href') || '';
    const match = href.match(/\/anime\/(\d+)(?:-([^/?#]+))?/);
    const id = parsePositiveInt(match?.[1]);
    if (!id || seen.has(id)) return;

    const name = (
      $(element).find('.livesearch-title, .title, .name').first().text()
      || $(element).attr('title')
      || $(element).text()
    ).replace(/\s+/g, ' ').trim();
    if (!name) return;

    const infoText = $(element).find('.livesearch-info-wrap').text() || $(element).text();
    const total = infoText.match(/(\d+)\s*\/\s*(\d+)\s*episod/i)?.[2]
      || infoText.match(/(\d+)\s*episod/i)?.[1];

    seen.add(id);
    hits.push({
      id,
      slug: String(match?.[2] || '').trim(),
      name,
      episodes_count: parsePositiveInt(total) || 0,
    });
  });

  return hits;
}

/** Tutti gli episodi sono nel blocco `.episodes` della pagina anime (anche 1000+). */
export function parseEpisodesFromAnimeHtml(html: string): AnimeUnityPageEpisode[] {
  const $ = cheerio.load(String(html || ''));
  const episodes: AnimeUnityPageEpisode[] = [];
  const seen = new Set<number>();

  $('.episodes a[data-id][data-num]').each((_, element) => {
    const id = parsePositiveInt($(element).attr('data-id'));
    if (!id || seen.has(id)) return;
    seen.add(id);
    episodes.push({
      id,
      number: parseEpisodeNumber($(element).attr('data-num'), episodes.length + 1),
      name: String($(element).attr('title') || '').trim() || undefined,
    });
  });

  return episodes;
}

/** Decodifica i valori negli attributi HTML (il sito .co li scrive con &quot;). */
export function decodeHtmlAttribute(value: string): string {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * AnimeUnity.co: la pagina anime porta la lista episodi nell'attributo JSON
 * `episodes="[...]"`. Sono solo i primi 120: le serie lunghe usano /info_api.
 */
export function parseUnityCoEpisodes(html: string): AnimeUnityPageEpisode[] {
  const raw = String(html || '').match(/\bepisodes="([^"]+)"/)?.[1];
  if (!raw) return [];

  const episodes: AnimeUnityPageEpisode[] = [];
  const seen = new Set<number>();
  try {
    const parsed = JSON.parse(decodeHtmlAttribute(raw)) as Array<{ id?: number; number?: string }>;
    for (const entry of parsed) {
      const id = parsePositiveInt(entry?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      episodes.push({ id, number: parseEpisodeNumber(entry?.number, episodes.length + 1) });
    }
  } catch {
    return [];
  }
  return episodes;
}

/** Server SUB/ITA dell'episodio: `<li data-link-id data-type data-ep-id data-sv-id>`. */
export function parseEpisodeServers(html: string, episodeId: number): AnimeUnityServer[] {
  const $ = cheerio.load(String(html || ''));
  const servers: AnimeUnityServer[] = [];
  const seen = new Set<string>();

  $('li[data-link-id]').each((_, element) => {
    const rowEpisode = parsePositiveInt($(element).attr('data-ep-id'));
    if (rowEpisode && rowEpisode !== episodeId) return;

    const linkId = String($(element).attr('data-link-id') || '').trim();
    if (!linkId || seen.has(linkId)) return;
    seen.add(linkId);

    servers.push({
      type: String($(element).attr('data-type') || '').toLowerCase() === 'dub' ? 'dub' : 'sub',
      linkId,
      host: String($(element).attr('data-sv-id') || '').trim().toLowerCase(),
    });
  });

  return servers;
}

const VIXCLOUD_HOST_RE = /(?:^|\.)(?:vixcloud\.(?:cc|co|to)|vixsrc\.to)$/i;

/** Nuovo player (ani3.api-webs.com/player.php?m3u8=...): estrae e decodifica l'URL HLS. */
function resolvePlayerStreamUrl(raw: string, pageUrl: string): string | null {
  try {
    const playerUrl = new URL(raw, pageUrl);
    let nested = playerUrl.searchParams.get('m3u8');
    if (nested && /^https?%3A/i.test(nested)) nested = decodeURIComponent(nested);
    const streamUrl = nested ? new URL(nested, pageUrl) : playerUrl;
    if (!/^https?:$/.test(streamUrl.protocol) || !VIXCLOUD_HOST_RE.test(streamUrl.hostname)) {
      return null;
    }
    // Il player nuovo usa ani3.api-webs.com/player.php?m3u8=... come wrapper HLS:
    // è quello che il browser riproduce, mentre vixcloud.cc diretto risponde 403.
    if (nested && /(?:^|\.)api-webs\.com$/i.test(playerUrl.hostname) && /\/player\.php$/i.test(playerUrl.pathname)) {
      return playerUrl.toString();
    }
    return ensurePlaylistM3u8(streamUrl.toString());
  } catch {
    return null;
  }
}

export interface HlsVariantInfo {
  url: string;
  /** Altezza in pixel della variante scelta, null se il master non la dichiara. */
  height: number | null;
}

/** Variante HLS con la risoluzione più alta (poi il bandwidth), con la sua altezza. */
export function selectHighestHlsVariantInfo(manifest: string, manifestUrl: string): HlsVariantInfo | null {
  const lines = String(manifest || '').split(/\r?\n/);
  let best: { url: string; score: number; height: number | null } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const next = lines.slice(i + 1).map((entry) => entry.trim()).find((entry) => entry && !entry.startsWith('#'));
    if (!next) continue;

    const resolution = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const bandwidth = Number(line.match(/BANDWIDTH=(\d+)/i)?.[1] || 0);
    // A parità di risoluzione vince il bandwidth; 1e9 tiene separati i due criteri.
    const score = resolution
      ? Number(resolution[1]) * Number(resolution[2]) * 1_000_000_000 + bandwidth
      : bandwidth;

    if (!best || score > best.score) {
      try {
        best = {
          url: new URL(next, manifestUrl).toString(),
          score,
          height: resolution ? Number(resolution[2]) : null,
        };
      } catch {
        // URL non valido: ignora questa variante.
      }
    }
  }

  return best ? { url: best.url, height: best.height } : null;
}

/** Sceglie la variante con la risoluzione più alta (poi il bandwidth) dal master HLS. */
export function selectHighestHlsVariant(manifest: string, manifestUrl: string): string | null {
  return selectHighestHlsVariantInfo(manifest, manifestUrl)?.url ?? null;
}

/**
 * Master HLS dal player vixcloud: `'token'`, `'expires'`, `url:` e `canPlayFHD`.
 * Supporta anche il player nuovo che espone `streamUrl` con l'URL HLS nel parametro `m3u8`.
 */
export function parseVixcloudHls(pageHtml: string, pageUrl: string): string | null {
  const html = String(pageHtml || '');
  const streamUrl = html.match(/(?:const|let|var)\s+streamUrl\s*=\s*['"]([^'"]+)['"]/i)?.[1]
    || html.match(/["']?streamUrl["']?\s*[:=]\s*["']([^"']+)["']/i)?.[1];
  if (streamUrl) {
    const resolved = resolvePlayerStreamUrl(streamUrl, pageUrl);
    if (resolved) return resolved;
  }

  const token = html.match(/'token':\s*'([^']+)'/)?.[1] || html.match(/"token":\s*"([^"]+)"/)?.[1];
  const expires = html.match(/'expires':\s*'(\d+)'/)?.[1] || html.match(/"expires":\s*"?(\d+)/)?.[1];
  const serverUrl = html.match(/url:\s*['"]([^'"]+)['"]/)?.[1] || html.match(/file:\s*['"]([^'"]+)['"]/)?.[1];
  if (!token || !expires || !serverUrl) return null;

  try {
    const u = new URL(ensurePlaylistM3u8(new URL(serverUrl, pageUrl).toString()));
    const hadB = u.searchParams.get('b') === '1';
    u.search = '';
    if (hadB) u.searchParams.set('b', '1');
    u.searchParams.set('token', token);
    u.searchParams.set('expires', expires);
    if (/canPlayFHD\s*[:=]\s*true/.test(html)) u.searchParams.set('h', '1');
    return u.toString();
  } catch {
    return null;
  }
}
