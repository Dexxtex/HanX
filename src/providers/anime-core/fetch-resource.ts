/**
 * anime-core/fetch-resource.ts
 * HTTP fetching with TTL cache, inflight request dedup, and configurable timeout.
 * Ported 1:1 from easystreams-main fetchResource() + fetchWithTimeout().
 */

import { AsyncLocalStorage } from 'node:async_hooks';
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

/**
 * Stato del provider-run in corso: `runProvider` (addon.ts) esegue l'handler
 * dentro questo store e legge `failed` per non cachare una lista parziale.
 * Unica istanza nel processo, una per provider-run.
 */
export const providerRequestStore = new AsyncLocalStorage<{ failed: boolean }>();

/** Marca il provider-run corrente come fallito; fuori da uno store è un no-op. */
export function markProviderFetchFailure(): void {
  const store = providerRequestStore.getStore();
  if (store) store.failed = true;
}

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

// Un host alla volta, con un minimo tra due richieste: le raffiche (un titolo
// costa fino a 15 richieste in meno di un secondo) fanno scattare il WAF, e
// l'uscita condivisa si brucia. 0 disattiva l'intervallo.
const hostTails = new Map<string, Promise<unknown>>();
const hostLastAt = new Map<string, number>();

/** Letto a ogni chiamata: i test lo azzerano senza toccare il resto. */
function minHostIntervalMs(): number {
  const raw = process.env.ANIME_HOST_MIN_INTERVAL_MS;
  if (raw === undefined) return 2000;
  return Math.max(0, Number.parseInt(raw, 10) || 0);
}

function paceHost<T>(host: string, task: () => Promise<T>): Promise<T> {
  const interval = minHostIntervalMs();
  if (!host || interval === 0) return task();
  const previous = hostTails.get(host) || Promise.resolve();
  const run = previous.then(async () => {
    const wait = (hostLastAt.get(host) || 0) + interval - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    hostLastAt.set(host, Date.now());
    return task();
  });
  // La coda non deve trascinare gli errori: la richiesta dopo parte comunque.
  hostTails.set(host, run.catch(() => undefined));
  return run;
}

// 403 = WAF, 429 = troppe richieste: insistere prolunga il blocco. Il cooldown
// e' per host E uscita: un 403 via proxy non deve spegnere anche il diretto.
const blockedHosts = new Map<string, number>();
const BLOCK_403_MS = 10 * 60 * 1000;
const BLOCK_429_MS = 60 * 1000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}


/**
 * Ordine richiesto: proxy della piattaforma, poi proxy globale, poi diretto.
 * I proxy valgono appena sono impostati: coprono ricerca e fetch delle pagine
 * di riproduzione, senza un interruttore separato.
 */
function getProxyChain(url: string, platformOverride?: ProxyPlatform): { label: string; url: string }[] {
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
  /** Uscita di questa richiesta (hop di proxy o 'diretto'): cooldown separato. */
  exitLabel?: string;
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
            exitLabel: proxy.label,
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
  // Un hop di proxy fallito non è un fallimento del provider: marca solo il
  // tentativo finale (diretto), cioè senza agent esplicito o con `agent: null`.
  const isFinalAttempt = !hasExplicitAgent || options.agent === null;
  try {
    const running = caches.inflight.get(inflightKey);
    if (running) {
      debug(4, 'Fetch', 'inflight dedup', redactUrl(url));
      // `await` obbligatorio: con `return running` il rifiuto della promise
      // condivisa non passerebbe dal catch e l'osservatore non marcherebbe.
      return await running;
    }

    // Uscita respinta poco fa: nessuna rete, insistere rinnova il blocco.
    const host = hostOf(url);
    const exitKey = `${options.exitLabel || 'diretto'}:${host}`;
    if ((blockedHosts.get(exitKey) || 0) > Date.now()) {
      throw new Error(`HTTP 403 (${exitKey} in cooldown) for ${url}`);
    }

    // 3. Execute fetch
    const startedAt = Date.now();
    const task = paceHost(host, async () => {
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
        if (response.status === 403 || response.status === 429) {
          blockedHosts.set(exitKey, Date.now() + (response.status === 403 ? BLOCK_403_MS : BLOCK_429_MS));
        }
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
    });

    caches.inflight.set(inflightKey, task);
    try {
      return await task;
    } finally {
      caches.inflight.delete(inflightKey);
    }
  } catch (error) {
    if (isFinalAttempt) markProviderFetchFailure();
    throw error;
  }
}
