/**
 * Incoming Stremio/Nuvio id parsing.
 * Kept dependency-free so it can be unit-tested and reused by addon.ts.
 */

import type { MappingProvider, MappingRequest, ParsedRequestId } from './types.js';

function parsePositiveInt(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Numeric id from ids like "tmdb:123:2:1", "tvdb:9", "mal:7". */
export function toNumericId(id: string): string {
  const match = String(id || '').trim().match(/^(?:[a-z]+:)?(\d+)/i);
  return match ? match[1] : '';
}

function build(
  provider: MappingProvider,
  id: string,
  season: number | null,
  episode: number | null,
  isMovie: boolean
): ParsedRequestId {
  return { provider, id, season, episode, isMovie };
}

/**
 * Parse a Stremio id. Supported:
 *   kitsu:ID, kitsu:ID:E, kitsu:ID:S:E (S ignored)
 *   imdb:tt..., tt..., with optional :E or :S:E
 *   tmdb:ID, tvdb:ID, mal:ID with optional :E or :S:E
 *   bare numeric id -> tmdb
 * No season/episode means movie.
 */
export function parseRequestId(rawId: string | null | undefined): ParsedRequestId | null {
  let value = String(rawId || '').trim();
  if (!value) return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep the original value
  }

  const kitsu = value.match(/^kitsu:(\d+)(?::(\d+))?(?::(\d+))?$/i);
  if (kitsu) {
    const hasTwoNumbers = kitsu[3] !== undefined;
    const episode = hasTwoNumbers ? parsePositiveInt(kitsu[3]) : kitsu[2] !== undefined ? parsePositiveInt(kitsu[2]) : null;
    return build('kitsu', kitsu[1], null, episode, !hasTwoNumbers && kitsu[2] === undefined);
  }

  for (const provider of ['imdb', 'tmdb', 'tvdb', 'mal'] as const) {
    const pattern =
      provider === 'imdb'
        ? /^(?:imdb:)?(tt\d+)(?::(\d+))?(?::(\d+))?$/i
        : new RegExp(`^${provider}:(\\d+)(?::(\\d+))?(?::(\\d+))?$`, 'i');
    const match = value.match(pattern);
    if (!match) continue;
    const hasTwoNumbers = match[3] !== undefined;
    const season = hasTwoNumbers ? parsePositiveInt(match[2]) : null;
    const episode = hasTwoNumbers ? parsePositiveInt(match[3]) : match[2] !== undefined ? parsePositiveInt(match[2]) : null;
    return build(provider, provider === 'imdb' ? match[1].toLowerCase() : match[1], season, episode, season === null && episode === null);
  }

  if (/^\d+$/.test(value)) {
    return build('tmdb', value, null, null, true);
  }

  return null;
}

/**
 * Build a mapping request from an id plus the S/E the SDK passed separately.
 * Explicit values win; the id is the fallback.
 */
export function resolveMappingRequest(
  id: string,
  season?: number | string | null,
  episode?: number | string | null,
  isMovie?: boolean
): MappingRequest | null {
  const parsed = parseRequestId(id);
  if (!parsed) return null;

  const explicitSeason = parsePositiveInt(season);
  const explicitEpisode = parsePositiveInt(episode);
  const resolvedEpisode = explicitEpisode ?? parsed.episode;
  const resolvedSeason = parsed.provider === 'kitsu' ? null : explicitSeason ?? parsed.season;

  return {
    provider: parsed.provider,
    id: parsed.id,
    season: resolvedSeason,
    episode: resolvedEpisode,
    isMovie: isMovie ?? (resolvedSeason === null && resolvedEpisode === null),
  };
}
