/**
 * anime-core/helpers.ts
 * Shared utility functions ported 1:1 from easystreams-main.
 * Used by all 3 anime providers for episode/season normalization,
 * URL handling, title sanitization, and concurrency control.
 */

// ─── Errors ────────────────────────────────────────────────

/**
 * True per gli errori di abort/timeout di fetch e undici (AbortError,
 * TimeoutError, "operation timed out", ...). Usato dai provider per
 * distinguere un timeout da un errore definitivo.
 */
export function isAbortOrTimeoutError(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | null | undefined;
  return /timeout|abort/i.test(`${e?.name || ''} ${e?.message || ''}`);
}

/**
 * Etichetta S/E. La stagione si stampa solo quando e' davvero nota: negli id Kitsu ogni
 * stagione e' un anime a se', quindi il campo season vale sempre 1 e stamparlo mette "S1"
 * su episodi di S2. Per IMDB/TMDB la stagione e' reale e resta.
 */
export function episodeTag(seasonNumber: number | null, episodeNumber: number | null): string {
  const s = seasonNumber != null ? `S${seasonNumber}` : '';
  const e = episodeNumber != null ? `E${episodeNumber}` : '';
  return `${s}${e}`;
}

/** Etichetta qualità per lo stream: FHD da 1080p in su, niente per il resto. */
export function qualityTag(height: number | null | undefined): string | null {
  return Number(height) >= 1080 ? 'FHD' : null;
}

/**
 * Stagione scritta nel titolo Kitsu ("… Season 2", "… 2nd Season", "… II",
 * "… 2"). Solo pattern espliciti: un numero in coda può essere parte del nome
 * ("Mob Psycho 100") o un cour ("… Part 2"), e lì comporre sarebbe un errore.
 */
export function seasonFromTitle(title: string): number | null {
  const text = String(title || '').trim();  if (!text) return null;
  const explicit = /\bseason\s*(\d+)\s*$/i.exec(text) || /\b(\d+)(?:st|nd|rd|th)\s+season\s*$/i.exec(text);
  if (explicit) return Number(explicit[1]);
  if (/\b(?:season|part|cour|stagione)\b/i.test(text)) return null;
  const roman = /(?:^|\s)(ii|iii|iv|v|vi|vii|viii|ix|x)\s*$/i.exec(text);
  if (roman) {
    const value = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 }[roman[1].toLowerCase()];
    return value ?? null;
  }
  const digit = /(?:^|\s)([2-9])\s*$/.exec(text);
  return digit ? Number(digit[1]) : null;
}

/**
 * Query con il titolo italiano dell'opera. I siti scrivono la stagione in coda
 * ("La malinconia di Haruhi Suzumiya 2"), quindi dalla 2 in poi si aggiunge il
 * numero. Il filtro titoli resta comunque l'unico a decidere il match.
 */
export function italianSeasonQuery(
  titleIt: string | null | undefined,
  season: number | null,
  requestedTitle: string | null | undefined = ''
): string {
  const title = String(titleIt || '').trim();
  if (!title) return '';
  if (season && season > 1) return `${title} ${season}`;
  if (season === 1) return title;
  // Gli id Kitsu mappano una stagione per entry: `season` è null, la stagione
  // va letta dal titolo. Senza indicazione esplicita non si usa il titolo
  // italiano: è quello dell'opera e prenderebbe la scheda sbagliata.
  const fromTitle = seasonFromTitle(String(requestedTitle || ''));
  return fromTitle && fromTitle > 1 ? `${title} ${fromTitle}` : '';
}

/** Stesso titolo a meno di maiuscole, accenti e punteggiatura. */
export function sameTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = (value: unknown) =>
    String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const left = key(a);
  return Boolean(left) && left === key(b);
}

// ─── Numeric helpers ────────────────────────────────────────

/**
 * Parse a value to a positive integer (> 0). Returns null otherwise.
 */
export function parsePositiveInt(value: any): number | null {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Normalize a requested episode number. Falls back to 1 if invalid.
 */
export function normalizeRequestedEpisode(value: any): number {
  const parsed = parsePositiveInt(value);
  return parsed || 1;
}

/**
 * Normalize a requested season number. Returns null if invalid.
 * Season 0 is valid (specials).
 */
export function normalizeRequestedSeason(value: any): number | null {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Parse an episode number from a string (first sequence of 1-4 digits).
 */
export function parseEpisodeNumber(value: any, fallbackNum: number): number {
  const text = String(value || '').trim();
  const match = text.match(/(\d{1,4})/);
  if (match) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallbackNum;
}

// ─── URL helpers ────────────────────────────────────────────

/**
 * Convert a relative or protocol-relative URL to absolute.
 * Uses the given baseUrl as the resolution base.
 */
export function toAbsoluteUrl(href: string | null | undefined, baseUrl: string): string | null {
  if (!href) return null;
  const trimmed = String(href).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Check if a URL/path points to a directly playable media file (.mp4 / .m3u8).
 */
function isDirectMediaPath(value: string | null | undefined): boolean {
  const text = String(value || '').trim();
  if (!text) return false;

  if (!/^https?:\/\//i.test(text)) {
    return /\.(?:mp4|m3u8)(?:[?#].*)?$/i.test(text);
  }

  try {
    const parsed = new URL(text);
    const path = String(parsed.pathname || '').toLowerCase();
    return path.endsWith('.mp4') || path.endsWith('.m3u8');
  } catch {
    return /\.(?:mp4|m3u8)(?:[?#].*)?$/i.test(text);
  }
}

/**
 * Normalize a raw URL to a playable media URL, resolving nested query-string redirects.
 * Returns null if the URL does not point to a playable media resource.
 * Ported 1:1 from easystreams normalizePlayableMediaUrl().
 *
 * @param rawUrl  - The URL to normalize
 * @param baseUrl - Base URL for resolving relative paths
 * @param depth   - Recursion depth (max 1)
 */
export function normalizePlayableMediaUrl(
  rawUrl: string | null | undefined,
  baseUrl: string,
  depth = 0
): string | null {
  const absolute = toAbsoluteUrl(rawUrl, baseUrl);
  if (!absolute) return null;
  if (isDirectMediaPath(absolute)) return absolute;
  if (depth >= 1) return null;

  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }

  const path = String(parsed.pathname || '').toLowerCase();
  if (path.endsWith('.mp4') || path.endsWith('.m3u8')) return parsed.toString();

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

    const nestedUrl = normalizePlayableMediaUrl(decoded, baseUrl, depth + 1);
    if (nestedUrl) return nestedUrl;
  }

  return null;
}

// ─── Title helpers ──────────────────────────────────────────

/**
 * Sanitize an anime title by removing site-specific suffixes and language markers.
 * Ported from easystreams sanitizeAnimeTitle().
 */
export function sanitizeAnimeTitle(rawTitle: string | null | undefined): string | null {
  let text = String(rawTitle || '').trim();
  if (!text) return null;

  text = text
    .replace(/\s*-\s*AnimeUnity.*$/i, '')
    .replace(/\s*-\s*AnimeWorld.*$/i, '')
    .replace(/\s*-\s*AnimeSaturn.*$/i, '')
    .replace(/\s+Streaming.*$/i, '')
    .trim();

  // Remove language markers
  text = text
    .replace(/\s*[\[(]\s*(?:SUB\s*ITA|ITA|SUB|DUB(?:BED)?|DOPPIATO)\s*[\])]\s*/gi, ' ')
    .replace(/\s*[-–_|:]\s*(?:SUB\s*ITA|ITA|SUB|DUB(?:BED)?|DOPPIATO)\s*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[-–_|:]\s*$/g, '')
    .trim();

  return text || null;
}

/**
 * Infer a language source tag from title and path.
 * Returns 'ITA' if Italian dub markers found, otherwise 'SUB'.
 */
export function inferSourceTag(title: string | null | undefined, animePath: string | null | undefined): 'ITA' | 'SUB' {
  const titleText = String(title || '').toLowerCase();
  const pathText = String(animePath || '').toLowerCase();
  if (/(?:^|[^\w])ita(?:[^\w]|$)/i.test(titleText)) return 'ITA';
  if (/(?:^|[-_/])ita(?:[-_/]|$)/i.test(pathText)) return 'ITA';
  return 'SUB';
}

/**
 * Normalize a host label from a URL for display purposes.
 */
export function normalizeHostLabel(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').split('.')[0];
    return host.charAt(0).toUpperCase() + host.slice(1);
  } catch {
    return null;
  }
}

// ─── Episode list helpers ───────────────────────────────────

/** Normalized episode entry (provider-agnostic structure) */
export interface NormalizedEpisode {
  num: number;
  token: string;
  episodeId: number | null;
  scwsId: number | null;
  link: string | null;
  fileName: string | null;
  embedUrl: string | null;
}

/**
 * Normalize a raw episodes array into a sorted, deduplicated list.
 * Ported 1:1 from easystreams normalizeEpisodesList().
 */
export function normalizeEpisodesList(
  sourceEpisodes: any[],
  baseUrl: string
): NormalizedEpisode[] {
  if (!Array.isArray(sourceEpisodes) || sourceEpisodes.length === 0) return [];
  const out: NormalizedEpisode[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < sourceEpisodes.length; index += 1) {
    const entry = sourceEpisodes[index] || {};
    const numRaw = Number.parseInt(String(entry.num ?? index + 1), 10);
    const num = Number.isFinite(numRaw) && numRaw > 0 ? numRaw : index + 1;
    const episodeId = parsePositiveInt(entry.episodeId ?? entry.id) ?? null;
    const scwsId = parsePositiveInt(entry.scwsId ?? entry.scws_id) ?? null;
    const token =
      String(
        entry.token ||
          (episodeId ? `ep:${episodeId}` : scwsId ? `scws:${scwsId}` : `ep-${num}`)
      ).trim() || `ep-${num}`;
    const link = toAbsoluteUrl(entry.link || entry.file_name || null, baseUrl);
    const fileName = String(entry.fileName || entry.file_name || entry.link || '').trim() || null;
    const embedUrl = toAbsoluteUrl(entry.embedUrl || entry.embed_url || null, baseUrl);
    const key = `${num}|${episodeId || ''}|${scwsId || ''}|${token}|${link || ''}|${fileName || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ num, token, episodeId, scwsId, link, fileName, embedUrl });
  }

  out.sort((a, b) => a.num - b.num);
  return out;
}

/**
 * Pick the episode entry whose number matches the requested one.
 * Solo match esatto: la scheda ITA di AnimeUnity può avere un solo episodio
 * (es. Black Clover 2 ITA = ep 1) e un ripiego per indice o "episodio unico"
 * restituirebbe l'episodio sbagliato etichettato come quello richiesto.
 */
export function pickEpisodeEntry(
  episodes: NormalizedEpisode[],
  requestedEpisode: number | string | null | undefined,
  mediaType: 'tv' | 'movie' = 'tv'
): NormalizedEpisode | null {
  const list = episodes;
  if (list.length === 0) return null;

  // For movies, return the first episode
  if (mediaType === 'movie') return list[0];

  const episodeNum = normalizeRequestedEpisode(requestedEpisode);
  return list.find((entry) => entry.num === episodeNum) ?? null;
}

// ─── HTML/Media helpers ─────────────────────────────────────

/** List of domains known to serve broken/blocked content */
export const BLOCKED_DOMAINS = [
  'jujutsukaisenanime.com',
  'onepunchman.it',
  'dragonballhd.it',
  'narutolegend.it',
];

/**
 * Collect playable media links from an HTML embed page.
 * Ported 1:1 from easystreams collectMediaLinksFromEmbedHtml().
 */
export function collectMediaLinksFromEmbedHtml(
  html: string,
  baseUrl: string
): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];
  const seen = new Set<string>();

  function addLink(href: string, label: string): void {
    const playable = normalizePlayableMediaUrl(href, baseUrl);
    if (!playable || seen.has(playable)) return;
    seen.add(playable);
    links.push({ href: playable, label });
  }

  const raw = String(html || '');
  const variants = [raw, raw.replace(/\\\//g, '/')];

  for (const text of variants) {
    // Download URL
    const downloadRegex = /window\.downloadUrl\s*=\s*["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = downloadRegex.exec(text)) !== null) {
      addLink(match[1], 'Download diretto');
    }

    // Direct media URLs
    const directRegex = /https?:\/\/[^\s"'<>\\]+(?:\.mp4|\.m3u8)(?:[^\s"'<>\\]*)?/gi;
    while ((match = directRegex.exec(text)) !== null) {
      addLink(match[0], 'Player');
    }

    // URL-encoded media URLs
    const encodedUrlRegex = /https%3A%2F%2F[^\s"'<>\\]+/gi;
    while ((match = encodedUrlRegex.exec(text)) !== null) {
      try {
        addLink(decodeURIComponent(match[0]), 'Player');
      } catch {
        // ignore malformed encoded URLs
      }
    }

    // Attribute-based media URLs
    const fileRegex = /(?:file|src|url|link)\s*[:=]\s*["']([^"']+)["']/gi;
    while ((match = fileRegex.exec(text)) !== null) {
      addLink(match[1], 'Player');
    }
  }

  return links;
}
