/**
 * anime-core/fetch-resource.ts
 * HTTP fetching with TTL cache, inflight request dedup, and configurable timeout.
 * Ported 1:1 from easystreams-main fetchResource() + fetchWithTimeout().
 */

import { getCached, setCached, type CacheEntry } from './cache.js';
import { debug, redactUrl } from '../../utils/logger.js';

// Node.js 18+ has native fetch — no fallback needed.
const fetchImpl: typeof globalThis.fetch = globalThis.fetch;
import nodeFetch from 'node-fetch';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';

export const DEFAULT_USER_AGENT =
  process.env.AU_USER_AGENT ||
  process.env.AS_USER_AGENT ||
  process.env.AW_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

export const DEFAULT_FETCH_TIMEOUT = Number.parseInt(
  process.env.ANIME_FETCH_TIMEOUT_MS || '10000',
  10
) || 10000;

// Riusa lo stesso agent: crearne uno per richiesta lascia pool di connessioni aperti.
const proxyAgents = new Map<string, any>();

function getProxyAgent(proxyUrl: string): any {
  const cached = proxyAgents.get(proxyUrl);
  if (cached) return cached;
  debug(4, 'Fetch', 'proxy agent created', redactUrl(proxyUrl));
  const agent = proxyUrl.startsWith('socks')
    ? new SocksProxyAgent(proxyUrl)
    : new ProxyAgent(proxyUrl);
  proxyAgents.set(proxyUrl, agent);
  return agent;
}

type ProxyPlatform = 'animeunity' | 'animesaturn' | 'animeworld';

/**
 * Lo scraping va diretto per default: i proxy (PROXY / *_PROXY) valgono solo
 * con SEARCH_VIA_PROXY=true. Restano utili dove l'IP diretto viene bloccato.
 */
export function isSearchProxyEnabled(): boolean {
  return /^(1|true|on|yes)$/i.test(String(process.env.SEARCH_VIA_PROXY || '').trim());
}

/** Ordine richiesto: proxy della piattaforma, poi proxy globale, poi diretto. */
function getProxyChain(url: string, platformOverride?: ProxyPlatform): { label: string; url: string }[] {
  if (!isSearchProxyEnabled()) return [];
  const platformName = platformOverride
    || (url.includes('animesaturn') ? 'animesaturn'
      : url.includes('animeworld') ? 'animeworld'
      : url.includes('animeunity') ? 'animeunity'
      : null);
  const platform = platformName === 'animesaturn'
    ? { label: 'AS_PROXY', url: String(process.env.AS_PROXY || '').trim() }
    : platformName === 'animeworld'
    ? { label: 'AW_PROXY', url: String(process.env.AW_PROXY || '').trim() }
    : platformName === 'animeunity'
    ? { label: 'AU_PROXY', url: String(process.env.AU_PROXY || '').trim() }
    : null;

  const chain = [
    ...(platform ? [platform] : []),
    { label: 'PROXY', url: String(process.env.PROXY || '').trim() },
  ];
  return chain.filter((entry, index, all) =>
    entry.url && all.findIndex((other) => other.url === entry.url) === index
  );
}

/**
 * Caches object — each provider should create its own via createCaches().
 * This interface mirrors the easystreams cache structure.
 */
export interface ProviderCaches {
  http: Map<string, CacheEntry>;
  mapping: Map<string, CacheEntry>;
  inflight: Map<string, Promise<any>>;
}

export interface FetchResourceOptions {
  /** TTL in ms for caching the response. 0 = no cache. */
  ttlMs?: number;
  /** Cache key override. Defaults to the URL. */
  cacheKey?: string;
  /** Response type. 'text' (default) or 'json'. */
  as?: 'text' | 'json';
  /** HTTP method. Defaults to 'GET'. */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Additional request headers. */
  headers?: Record<string, string>;
  /** Request body (for POST etc). */
  body?: string;
  /** Timeout in ms. Defaults to DEFAULT_FETCH_TIMEOUT. */
  timeoutMs?: number;
  /** Proxy Agent */
  agent?: any;
  /** Forza la piattaforma per la catena PROXY -> *_PROXY -> diretto (utile per CDN). */
  proxyPlatform?: ProxyPlatform;
}

/**
 * Fetch with AbortController-based timeout.
 * Ported 1:1 from easystreams fetchWithTimeout().
 */
export async function fetchWithTimeout(
  url: string,
  options: any = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT
): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  // Rimuovi agent e signal da options se presenti per gestirli manualmente
  const { agent, ...restOptions } = options;

  try {
    // node-fetch honors agent; native fetch only honors an undici dispatcher.
    if (agent instanceof SocksProxyAgent) {
      return await nodeFetch(url, { ...restOptions, agent, signal: controller.signal as any });
    }
    const init: any = { ...restOptions, signal: controller.signal };
    // Global fetch is a different undici copy on Node 22/24; its dispatcher must come from that copy.
    if (agent instanceof ProxyAgent) {
      return await undiciFetch(url, { ...init, dispatcher: agent });
    }
    init.agent = agent;
    const response = await fetchImpl(url, init);
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}


/**
 * Come fetchResource, ma restituisce la Response grezza (status, set-cookie)
 * applicando la stessa catena proxy: piattaforma -> PROXY -> diretto.
 */
export async function fetchResponseWithProxy(url: string, init: RequestInit = {}): Promise<Response> {
  const { timeoutMs, ...rest } = init as RequestInit & { timeoutMs?: number };
  const effectiveTimeout = Number(timeoutMs) || DEFAULT_FETCH_TIMEOUT;

  const chain = getProxyChain(url);
  for (const proxy of chain) {
    debug(4, 'Fetch', 'proxy hop', { label: proxy.label, url: redactUrl(url) });
    try {
      return await fetchWithTimeout(url, { ...rest, agent: getProxyAgent(proxy.url) }, effectiveTimeout) as Response;
    } catch (error) {
      debug(3, 'Fetch', 'proxy hop failed', {
        label: proxy.label,
        url: redactUrl(url),
        error: (error as any)?.message || String(error),
      });
      // Prova il prossimo hop.
    }
  }
  if (chain.length) debug(4, 'Fetch', 'direct fallback', redactUrl(url));
  return await fetchWithTimeout(url, { ...rest, agent: undefined }, effectiveTimeout) as Response;
}


/**
 * Cached, deduplicated fetch.
 * Ported 1:1 from easystreams fetchResource():
 * - Checks TTL cache first
 * - Deduplicates concurrent inflight requests for the same resource
 * - Stores successful responses in cache
 *
 * @param url      - The URL to fetch
 * @param caches   - The provider's cache maps
 * @param options  - Fetch options (ttl, as, headers, etc.)
 */
export async function fetchResource(
  url: string,
  caches: ProviderCaches,
  options: FetchResourceOptions = {}
): Promise<any> {
  const {
    ttlMs = 0,
    cacheKey = url,
    as = 'text',
    method = 'GET',
    headers = {},
    body = undefined,
    timeoutMs = DEFAULT_FETCH_TIMEOUT,
  } = options;

  debug(4, 'Fetch', 'request', {
    method,
    url: redactUrl(url),
    as,
    ttlMs,
    timeoutMs,
    proxyPlatform: options.proxyPlatform || 'auto',
  });

  // Proxy piattaforma -> proxy globale -> diretto. Ogni hop ha una cache
  // separata, così un fallback diretto non bypassa il proxy ai fetch successivi.
  const hasExplicitAgent = 'agent' in options && options.agent !== undefined;
  if (!hasExplicitAgent) {
    const chain = getProxyChain(url, options.proxyPlatform);
    if (chain.length > 0) {
      for (const proxy of chain) {
        debug(4, 'Fetch', 'proxy hop', { label: proxy.label, url: redactUrl(url) });
        try {
          return await fetchResource(url, caches, {
            ...options,
            agent: getProxyAgent(proxy.url),
            cacheKey: `${cacheKey}#${proxy.label}`,
          });
        } catch (error) {
          debug(3, 'Fetch', 'proxy hop failed', {
            label: proxy.label,
            url: redactUrl(url),
            error: (error as any)?.message || String(error),
          });
          // Prova il prossimo hop.
        }
      }
      debug(4, 'Fetch', 'direct fallback', redactUrl(url));
      return await fetchResource(url, caches, {
        ...options,
        agent: null,
        cacheKey: `${cacheKey}#diretto`,
      });
    }
  }

  const key = `${as}:${method}:${cacheKey}:${typeof body === 'string' ? body : ''}`;

  // 1. Check TTL cache
  if (ttlMs > 0) {
    const cached = getCached(caches.http, key);
    if (cached !== undefined) {
      debug(4, 'Fetch', 'cache hit', redactUrl(url));
      return cached;
    }
  }

  // 2. Inflight deduplication
  const inflightKey = `http:${key}`;
  const running = caches.inflight.get(inflightKey);
  if (running) {
    debug(4, 'Fetch', 'inflight dedup', redactUrl(url));
    return running;
  }

  // 3. Execute fetch
  const startedAt = Date.now();
  const task = (async () => {
    let resolvedAgent: any = undefined;

    // Se l'agent è stato passato esplicitamente nelle opzioni, usalo (anche null = diretto).
    if ('agent' in options && options.agent !== undefined) {
      resolvedAgent = options.agent || undefined;
    }

    const response = await fetchWithTimeout(
      url,
      {
        method,
        headers: {
          'user-agent': DEFAULT_USER_AGENT,
          'accept-language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
          ...headers,
        },
        body,
        agent: resolvedAgent,
        redirect: 'follow',
      },
      timeoutMs
    );

    if (!response.ok) {
      debug(2, 'Fetch', 'http error', {
        url: redactUrl(url),
        status: response.status,
        statusText: response.statusText,
        ms: Date.now() - startedAt,
      });
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }

    const payload = as === 'json' ? await response.json() : await response.text();
    if (ttlMs > 0) setCached(caches.http, key, payload, ttlMs);
    debug(4, 'Fetch', 'ok', {
      url: redactUrl(url),
      status: response.status,
      ms: Date.now() - startedAt,
      bytes: typeof payload === 'string' ? payload.length : undefined,
    });
    return payload;
  })();

  caches.inflight.set(inflightKey, task);
  try {
    return await task;
  } finally {
    caches.inflight.delete(inflightKey);
  }
}
