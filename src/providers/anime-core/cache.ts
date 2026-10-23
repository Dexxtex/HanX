/**
 * anime-core/cache.ts
 * TTL-based Map cache with inflight request deduplication.
 * Ported 1:1 from easystreams-main (inline cache logic shared by all 3 anime providers).
 */

export interface CacheEntry<T = any> {
  value: T;
  expiresAt: number;
}

/**
 * Get a cached value if it exists and hasn't expired.
 * Returns `undefined` when missing or expired (expired entries are auto-pruned).
 */
export function getCached<T = any>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return undefined;
  }
  return entry.value;
}

const MAX_CACHE_ENTRIES = 500;

/**
 * Store a value in the cache with the given TTL (milliseconds).
 * Returns the stored value for convenience (allows inline usage).
 */
export function setCached<T = any>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): T {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
  // Limite come la cache provider dell'addon: prima scarta le entry scadute,
  // poi le più vecchie. Senza questo la Map cresce per tutta la vita del processo.
  if (map.size > MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [entryKey, entry] of map) {
      if (entry.expiresAt <= now) map.delete(entryKey);
    }
    let excess = map.size - MAX_CACHE_ENTRIES;
    for (const entryKey of map.keys()) {
      if (excess <= 0) break;
      map.delete(entryKey);
      excess -= 1;
    }
  }
  return value;
}

/**
 * Create a fresh set of caches for a provider instance.
 * Each provider should call this once at module scope.
 */
export function createCaches() {
  return {
    http: new Map<string, CacheEntry>(),
    mapping: new Map<string, CacheEntry>(),
    inflight: new Map<string, Promise<any>>(),
  };
}
