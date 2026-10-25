/**
 * anime-core/index.ts
 * Barrel export for all shared anime provider infrastructure.
 *
 * Usage in providers:
 *   import { fetchResource, createCaches, getProviderUrl, ... } from './anime-core';
 */

// Cache utilities
export {
  getCached,
  setCached,
  createCaches,
  type CacheEntry,
} from './cache.js';

// Fetch with cache + inflight dedup
export {
  fetchResource,
  fetchWithTimeout,
  DEFAULT_USER_AGENT,
  DEFAULT_FETCH_TIMEOUT,
  type ProviderCaches,
  type FetchResourceOptions,
} from './fetch-resource.js';

// Provider URL resolution
export {
  getProviderUrl,
} from './provider-urls.js';

// Risoluzione del titolo inglese condivisa dai tre provider
export {
  getEnglishTitleFromAnyId,
  type TitleIdType,
} from './english-title.js';

// Persistent Tenrai metadata cache with ETag revalidation and request throttling
export {
  getMalAnimeMetadata,
  getPreferredMalTitle,
  TenraiMetadataStore,
  TenraiMetadataError,
  type MalAnimeMetadata,
  type TenraiMetadataStoreOptions,
} from './tenrai-metadata.js';

// Shared helpers
export {
  isAbortOrTimeoutError,
  parsePositiveInt,
  normalizeRequestedEpisode,
  normalizeRequestedSeason,
  parseEpisodeNumber,
  toAbsoluteUrl,
  normalizePlayableMediaUrl,
  sanitizeAnimeTitle,
  inferSourceTag,
  normalizeHostLabel,
  normalizeEpisodesList,
  pickEpisodeEntry,
  collectMediaLinksFromEmbedHtml,
  episodeTag,
  BLOCKED_DOMAINS,
  type NormalizedEpisode,
} from './helpers.js';
