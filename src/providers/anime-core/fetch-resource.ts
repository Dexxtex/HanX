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
import { cooldownFor, exitKeyFor, hostOf, isCoolingDown, paceHost, QueueFullError } from './net-policy.js';

// Riesportati: i test e il barrel li prendevano da qui.
export { minHostIntervalMs, paceHost, hostOf } from './net-policy.js';

// Un UA solo, uguale per tutti: e' quello che il sito si aspetta da un browser.
// Gli override per sito erano decorativi (il WAF guarda il resto) e sono stati
// tolti.
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// 10 s: e' un tetto, non una taratura. Le risposte dei siti e di TMDB stanno
// sotto il secondo; il tetto serve a non tenere appesa una socket. Era
// `ANIME_FETCH_TIMEOUT_MS` (e tre varianti per provider, tutte allo stesso
// valore): una leva che poteva solo rompere, non migliorare.
export const DEFAULT_FETCH_TIMEOUT = 10000;

/**
 * Tetto per provider: l'handler vive dentro una Promise.race con questo
 * timeout (addon.ts). Un'unica casa, perché i retry interni dei provider
 * devono starci: fuori, il loro risultato viene buttato dal race.
 */
export const PROVIDER_TIMEOUT_MS = 30000;

/**
 * Stato del provider-run in corso: `runProvider` (addon.ts) esegue l'handler
 * dentro questo store e legge `failed` per non cachare una lista parziale.
 * Unica istanza nel processo, una per provider-run.
 */
export const providerRequestStore = new AsyncLocalStorage<{ failed: boolean; signal?: AbortSignal }>();

/** Marca il provider-run corrente come fallito; fuori da uno store è un no-op. */
export function markProviderFetchFailure(): void {
  const store = providerRequestStore.getStore();
  if (store) store.failed = true;
}

// Riusa lo stesso agent: crearne uno per richiesta lascia pool di connessioni aperti.
const proxyAgents = new Map<string, any>();

export function proxyAgentFor(proxyUrl: string): any {
  const cached = proxyAgents.get(proxyUrl);
  if (cached) return cached;
  debug(4, 'Fetch', 'proxy agent created', redactUrl(proxyUrl));
  // keepAlive: senza, ogni richiesta paga TCP + SOCKS5 + TLS (100-320 ms).
  // ProxyAgent (undici) ha già il pooling attivo; SocksProxyAgent no.
  const agent = proxyUrl.startsWith('socks')
    ? new SocksProxyAgent(proxyUrl, { keepAlive: true })
    : new ProxyAgent(proxyUrl);
  proxyAgents.set(proxyUrl, agent);
  return agent;
}

type ProxyPlatform = 'animeunity' | 'animesaturn' | 'animeworld';

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
  /** Annullamento esterno (provider-run in timeout): si somma al timeout. */
  signal?: AbortSignal;
  /** Proxy Agent */
  agent?: any;
  /** Forza la piattaforma per la catena PROXY -> *_PROXY -> diretto (utile per CDN). */
  proxyPlatform?: ProxyPlatform;
  /** Uscita di questa richiesta (hop di proxy o 'diretto'): cooldown separato. */
  exitLabel?: string;
  /**
   * Header che dipendono dall'uscita. Serve ai cookie legati all'IP: un cookie
   * preso uscendo dal proxy non vale uscendo diretti, e con un solo slot i due
   * si sovrascrivevano a vicenda.
   */
  headersForExit?: (exitLabel: string) => Record<string, string>;
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
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? (AbortSignal as any).any([options.signal, timeoutSignal]) : timeoutSignal;

  // Rimuovi agent e signal da options se presenti per gestirli manualmente
  const { agent, signal: _ignored, ...restOptions } = options;

  // node-fetch honors agent; native fetch only honors an undici dispatcher.
  if (agent instanceof SocksProxyAgent) {
    return await nodeFetch(url, { ...restOptions, agent, signal: signal as any });
  }
  const init: any = { ...restOptions, signal };
  // Global fetch is a different undici copy on Node 22/24; its dispatcher must come from that copy.
  if (agent instanceof ProxyAgent) {
    return await undiciFetch(url, { ...init, dispatcher: agent });
  }
  init.agent = agent;
  return await fetchImpl(url, init);
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
            agent: proxyAgentFor(proxy.url),
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
    const exitKey = exitKeyFor(options.exitLabel, host);
    if (isCoolingDown(exitKey)) {
      // Non è un 403 del sito: è il nostro cooldown, e la richiesta non è mai
      // uscita. Scriverlo come "HTTP 403" faceva sembrare un blocco WAF vivo
      // una pausa che stiamo imponendo noi.
      throw new Error(`cooldown ${exitKey} for ${redactUrl(url)} (nessuna richiesta inviata)`);
    }

    // Cancellazione del provider-run (timeout del fan-out): senza, l'handler
    // continuava a infilare richieste in coda per una risposta che nessuno
    // avrebbe letto, e la coda restava occupata da lavoro morto.
    //
    // Si ferma solo il lavoro NUOVO, non la fetch già partita: `caches.inflight`
    // è condivisa fra tutte le richieste dello stesso provider, quindi annullare
    // quella promise farebbe fallire anche l'utente che la sta aspettando. Una
    // fetch in volo è comunque limitata dal suo timeout (10 s).
    const runSignal = providerRequestStore.getStore()?.signal;
    if (runSignal?.aborted) throw new Error(`richiesta annullata: ${redactUrl(url)}`);

    // 3. Execute fetch
    const startedAt = Date.now();
    const task = paceHost(host, async () => {
      // Riletto qui: il contesto ALS si propaga al `.then` di paceHost, quindi
      // una richiesta accodata prima del timeout vede l'abort al suo turno.
      if (providerRequestStore.getStore()?.signal?.aborted) {
        throw new Error(`richiesta annullata in coda: ${redactUrl(url)}`);
      }
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
            ...(options.headersForExit ? options.headersForExit(options.exitLabel || 'diretto') : {}),
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
        cooldownFor(exitKey, response.status);
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${redactUrl(url)}`);
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
    // La coda satura è una nostra saturazione, non un guasto del sito: se la
    // marcassimo, il risultato non verrebbe cachato e si ripagherebbe tutto.
    if (isFinalAttempt && !(error instanceof QueueFullError)) markProviderFetchFailure();
    throw error;
  }
}
