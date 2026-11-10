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
  // Rinfrescare una chiave esistente non la sposta in coda alla Map: senza il
  // delete la voce piu' calda resterebbe la prima a essere sfrattata.
  map.delete(key);
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
  // Limite come la cache provider dell'addon: prima scarta le entry scadute,
  // poi le più vecchie. Senza questo la Map cresce per tutta la vita del processo.
  if (map.size > MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [entryKey, entry] of map) {
      if (entry.expiresAt <= now) map.delete(entryKey);
    }
    // Sfratta per scadenza più vicina, non per ordine di inserimento: le
    // ricerche a TTL 12 h si inseriscono una volta e non si riscrivono, quindi
    // finivano per prime mentre le voci a 2 min restavano.
    if (map.size > MAX_CACHE_ENTRIES) {
      const byExpiry = [...map.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      let excess = map.size - MAX_CACHE_ENTRIES;
      for (const [entryKey] of byExpiry) {
        if (excess <= 0) break;
        map.delete(entryKey);
        excess -= 1;
      }
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
    inflight: new Map<string, Promise<any>>(),
  };
}
