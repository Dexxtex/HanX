/**
 * anime-core/cache.ts
 * TTL-based Map cache with inflight request deduplication.
 * Ported 1:1 from easystreams-main (inline cache logic shared by all 3 anime providers).
 */

export interface CacheEntry<T = any> {
  value: T;
  expiresAt: number;
  /** Peso della voce in byte, per il tetto di memoria. */
  size?: number;
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
    addBytes(map, -(entry.size || 0));
    return undefined;
  }
  return entry.value;
}

/** Tetto di voci: guardia secondaria, il limite vero e' in byte. */
const MAX_CACHE_ENTRIES = 500;

/**
 * Tetto di memoria. Le voci di questa cache sono **payload HTTP grezzi**: una
 * pagina scheda di Saturn pesa 82-190 KB, una ricerca 448 KB, la pagina serie
 * di World fino a 494 KB. Con 500 voci il caso peggiore era ~220 MB di HTML in
 * RAM; 32 MB tengono un working set caldo (decine di pagine) e non di piu'.
 */
const MAX_CACHE_BYTES = 32 * 1024 * 1024;

type Sized = Map<string, CacheEntry> & { bytes?: number };

function addBytes(map: Map<string, CacheEntry>, delta: number): void {
  const sized = map as Sized;
  sized.bytes = Math.max(0, (sized.bytes || 0) + delta);
}

/** Peso approssimato: `length` per le stringhe, JSON per gli oggetti gia' parsati. */
function payloadBytes(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value).length;
    } catch {
      // Cicli o BigInt: non si misura, si conta come una voce media.
      return 64 * 1024;
    }
  }
  return 64;
}

/** Sfratta per scadenza più vicina finché si sta dentro il tetto di byte. */
function evictUntilFits(map: Map<string, CacheEntry>): void {
  const sized = map as Sized;
  if ((sized.bytes || 0) <= MAX_CACHE_BYTES) return;
  const byExpiry = [...map.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (const [key, entry] of byExpiry) {
    if ((sized.bytes || 0) <= MAX_CACHE_BYTES) break;
    map.delete(key);
    addBytes(map, -(entry.size || 0));
  }
}

/**
 * Store a value in the cache with the given TTL (milliseconds).
 * Returns the stored value for convenience (allows inline usage).
 */
export function setCached<T = any>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): T {
  // Rinfrescare una chiave esistente non la sposta in coda alla Map: senza il
  // delete la voce piu' calda resterebbe la prima a essere sfrattata.
  const previous = map.get(key);
  if (previous) addBytes(map, -(previous.size || 0));
  map.delete(key);
  const size = payloadBytes(value);
  map.set(key, { value, expiresAt: Date.now() + ttlMs, size });
  addBytes(map, size);
  // Prima le scadute, poi per scadenza più vicina: le ricerche a TTL 12 h si
  // inseriscono una volta e non si riscrivono, quindi con l'ordine di
  // inserimento finivano per prime mentre le voci a 2 min restavano.
  if (map.size > MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [entryKey, entry] of map) {
      if (entry.expiresAt <= now) {
        map.delete(entryKey);
        addBytes(map, -(entry.size || 0));
      }
    }
    if (map.size > MAX_CACHE_ENTRIES) {
      const byExpiry = [...map.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      let excess = map.size - MAX_CACHE_ENTRIES;
      for (const [entryKey, entry] of byExpiry) {
        if (excess <= 0) break;
        map.delete(entryKey);
        addBytes(map, -(entry.size || 0));
        excess -= 1;
      }
    }
  }
  evictUntilFits(map);
  return value;
}

/** Byte occupati dalla cache (per i test e per capire quanto pesa davvero). */
export function cacheBytes(map: Map<string, CacheEntry>): number {
  return (map as Sized).bytes || 0;
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

/**
 * Invalida tutte le voci del `cacheKey` dato. La chiave reale porta un prefisso
 * (`as:metodo:`) e un suffisso di hop (`#<exit>:`) aggiunti da fetchResource:
 * una delete sulla chiave nuda non trova mai la voce. Il carattere dopo il
 * cacheKey (':' o '#') esclude i cacheKey che lo estendono ("naruto" non tocca
 * "naruto-shippuden"). Torna quante voci ha tolto.
 */
export function invalidateCached(
  caches: { http: Map<string, CacheEntry> },
  cacheKey: string,
  as = 'text',
  method = 'GET'
): number {
  const prefix = `${as}:${method}:${cacheKey}`;
  let n = 0;
  for (const key of [...caches.http.keys()]) {
    const rest = key.slice(prefix.length);
    if (key.startsWith(prefix) && (rest.startsWith(':') || rest.startsWith('#'))) {
      caches.http.delete(key);
      n += 1;
    }
  }
  return n;
}
