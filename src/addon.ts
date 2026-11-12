import stremioAddonSdk from "stremio-addon-sdk";
const { addonBuilder, getRouter } = stremioAddonSdk;
import type { Manifest, Stream } from "stremio-addon-sdk";
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import * as fs from 'fs';
import * as path from 'path';
import express, { Request, Response as ExpressResponse, NextFunction } from 'express';
import {
    isValidConfigObject,
    normalizeBool,
    normalizeConfig,
    parseConfigFromArgs,
    providerCacheKey,
    providerConfigDigest,
    resolvePlaybackProxyUrl,
    type AddonConfig,
} from './config.js';
import { AnimeUnityProvider } from './providers/animeunity-provider.js';
import { dispatchRequest } from './providers/registry.js';
import { collectProviderStreams } from './stream.js';
import { providerRequestStore } from './providers/anime-core/fetch-resource.js';
import { cooldownSnapshot } from './providers/anime-core/net-policy.js';
import { providerLabel } from './utils/unifiedNames.js';
import { landingTemplate } from './landingPage.js';
import { toNumericId, parseRequestId } from './mapping/request.js';
import { getCatalogStatus } from './catalog/matcher.js';
import { getMappingStatus, getMappingVersion, MAPPING_REFRESH_INTERVAL_MS, MAPPING_STALE_MS, refreshMappingFromUrl } from './mapping/index.js';
import { CATALOG_REFRESH_INTERVAL_MS, refreshCatalogFromUrl } from './catalog/remote.js';
import { debug, DEBUG_LEVEL } from './utils/logger.js';
import { unifyStreams, providerRank } from './utils/streamTitle.js';
import { sendHtmlResponse } from './utils/http.js';
import { detectPublicBaseUrl, withInstanceAssets } from './utils/public-url.js';
import { hasConfigSegment, withoutConfigHints } from './utils/manifest.js';
import { AnimeUnityConfig } from './types/animeunity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ================= TYPES & INTERFACES =================

let warnedMissingTmdbKey = false;

// ===== STREAM ORDERING (Anime-only) =====
/**
 * Ordina gli stream per titolo in modo alfabetico (case-insensitive).
 * Modifica l'array in-place.
 * Nota: l'addon è dedicato esclusivamente agli anime, quindi
 * non servono priorità per sport/TV live.
 */
function sortStreamsByPriority(streams: { url?: string; title?: string }[]): void {
    streams.sort((a, b) => {
        const titleA = (a.title || '').toString().toLowerCase();
        const titleB = (b.title || '').toString().toLowerCase();
        return titleA.localeCompare(titleB);
    });
}

// ================= MANIFEST BASE (restored) =================
const baseManifest: Manifest = {
    id: "org.stremio.hanx",
    version: "1.1.40",
    name: "HanX",
    description: "HanX addon dedicato ad AnimeUnity, AnimeSaturn e AnimeWorld",
    types: ["movie", "series", "anime"],
    idPrefixes: ["tt", "kitsu", "mal", "tmdb", "tvdb"],
    catalogs: [],
    resources: [
        "stream"
    ],
    behaviorHints: { configurable: true },
    config: [
        { key: "tmdbApiKey", title: "TMDB API Key", type: "password" },
        { key: "tvdbApiKey", title: "TVDB API Key", type: "password" },
        { key: "tvdbPin", title: "TVDB PIN (opzionale)", type: "password" },
        { key: "easyProxyUrl", title: "☂️ EasyProxy URL", type: "text" },
        { key: "easyProxyPassword", title: "EasyProxy Password (opzionale)", type: "password" },
        { key: "animeunityEnabled", title: "Enable AnimeUnity", type: "checkbox" },
        { key: "animesaturnEnabled", title: "Enable AnimeSaturn", type: "checkbox" },
        { key: "animeworldEnabled", title: "Enable AnimeWorld", type: "checkbox" },
    ],
    stremioAddonsConfig: {
        issuer: "https://stremio-addons.net",
        signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..lq-o2JziPJNLx0ktbXf4Cg.4k4_nsv-K378IN3bdkw5AzfIMtQyhlw0v8lWwtAFNx9W0OdkP6lczmlPOYqKYQ6OA4dU6N3GicW08Wdxm78wreyU4Irtn_A_BAoVc-EGUIC-C9-N68V0J4wLvFWogSKY.OlNc0_M7cbDgDVSNBihFUQ"
    }
};

// Load custom configuration if available
function loadCustomConfig(): Manifest {
    try {
        const configPath = path.join(__dirname, '..', 'addon-config.json');

        if (fs.existsSync(configPath)) {
            const customConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

            return {
                ...baseManifest,
                id: customConfig.addonId || baseManifest.id,
                name: customConfig.addonName || baseManifest.name,
                description: customConfig.addonDescription || baseManifest.description,
                version: customConfig.addonVersion || baseManifest.version,
                logo: customConfig.addonLogo || baseManifest.logo,
                icon: customConfig.addonLogo || baseManifest.icon,
                favicon: customConfig.addonFavicon || customConfig.addonLogo || baseManifest.logo,
                background: baseManifest.background
            };
        }
    } catch (error) {
        console.error('Error loading custom configuration:', error);
    }

    return baseManifest;
}

// ✅ DICHIARAZIONE delle variabili globali del builder
let globalBuilder: any;
let globalAddonInterface: any;
let globalRouter: any;


try {
    // ✅ INIZIALIZZA IL ROUTER GLOBALE
    console.log('🔧 Initializing global router...');
    globalBuilder = createBuilder();
    globalAddonInterface = globalBuilder.getInterface();
    globalRouter = getRouter(globalAddonInterface);
    console.log('✅ Global router initialized successfully');
} catch (error) {
    console.error('❌ Errore nell\'inizializzazione del router:', error);
}

// Provider extraction cache for anime requests.
// CPU profile showed the dominant CPU consumer was provider URL extraction
// (cheerio+parse5 HTML parsing) on anime stream requests. The same
// imdbId gets clicked by many users in quick succession, each click re-runs
// the full provider fan-out. Caching the resulting Stream[] for 5 min
// coalesces repeat plays.
//
// Cache key includes the user config that affects output (EasyProxy creds + the
// enabled-provider set + fastMode + a few other toggles) so different user
// setups don't share entries. Within the same shared-config group, repeat
// plays hit the cache.
//
// IMPORTANT: cached values are JSON-roundtripped to flatten V8 sliced
// strings. Without this, Stream.title/url/name from provider extractors
// often hold sliced-string views of the source upstream HTML pages — a
// heap snapshot showed each cached entry pinning ~2 MB of HTML in heap
// (59 cached entries → ~120 MB leaked).
//
// Disable with PROVIDER_CACHE_DISABLE=1.
// 15 minuti, non 5: una voce costa ~1,1 KB (4 stream) e il fan-out a freddo
// costa ~4 s su 3 host. La finestra serve alla riapertura dello stesso episodio
// (chiudi e riprendi, cambio stream), non alla durata della riproduzione:
// Stremio risolve una volta e il player usa quell'URL fino alla fine.
const PROVIDER_CACHE_TTL_MS = 15 * 60 * 1000;
// 5.000 voci = ~5,5 MB misurati: con 500 una serie da 100 episodi la svuota
// gia' a meta'. Il container tiene 13 MB di mapping e 6 MB di catalogo, quindi
// 5 MB di cache non sposta niente.
const PROVIDER_CACHE_MAX_ENTRIES = 5000;
const PROVIDER_CACHE_DISABLED: boolean = (() => {
    try {
        const v = (process?.env?.PROVIDER_CACHE_DISABLE || '').toString().toLowerCase();
        return v === '1' || v === 'true' || v === 'on' || v === 'yes';
    } catch { return false; }
})();
// Tetto per provider. Il default sta qui e non al call site: con `null` un
// provider nuovo che dimentica il quinto argomento blocca `Promise.all` e la
// risposta non parte mai.
const PROVIDER_TIMEOUT_MS = 30000;
// Una risposta vuota non è un guasto: è "questo titolo non c'è". Cacharla per
// pochi minuti evita che ogni play ripaghi il fan-out intero (3 host x 3-4 hop).
// Corto di proposito: un titolo appena aggiunto al sito deve comparire subito.
// 5 minuti, non 90 s: un titolo che non c'e' costa un fan-out intero (~4 s) a
// ogni play, e un titolo appena aggiunto al sito compare comunque entro 5'.
const PROVIDER_NEGATIVE_TTL_MS = 5 * 60 * 1000;
const _providerStreamCache = new Map<string, { streams: Stream[]; ts: number; ttl: number }>();

function _providerCacheGet(type: string, id: string, configDigest: string): any[] | null {
    if (PROVIDER_CACHE_DISABLED) return null;
    const k = providerCacheKey(type, id, configDigest);
    const e = _providerStreamCache.get(k);
    if (!e) return null;
    if (Date.now() - e.ts > e.ttl) {
        _providerStreamCache.delete(k);
        return null;
    }
    return e.streams;
}
function _providerCacheSet(type: string, id: string, configDigest: string, streams: any[]): void {
    if (PROVIDER_CACHE_DISABLED) return;
    if (!Array.isArray(streams)) return;
    const ttl = streams.length === 0 ? PROVIDER_NEGATIVE_TTL_MS : PROVIDER_CACHE_TTL_MS;
    if (ttl <= 0) return;
    const k = providerCacheKey(type, id, configDigest);
    // Flatten cached streams to break V8 sliced-string retention of upstream
    // HTML. Without this, Stream.title/url often hold sliced-string views of
    // the source HTML page, pinning megabytes per cache entry. JSON roundtrip
    // materializes every string into a fresh contiguous buffer.
    let toStore: any[];
    try {
        toStore = JSON.parse(JSON.stringify(streams));
    } catch (_e) {
        // Stream may contain non-JSON-safe values (Buffer in proxyHeaders).
        // Fall back to a shallow flatten of common string fields.
        toStore = streams.map((s: any) => {
            if (!s || typeof s !== 'object') return s;
            const out: any = { ...s };
            for (const field of ['title', 'name', 'url', 'description']) {
                if (typeof out[field] === 'string' && out[field].length > 0) {
                    out[field] = Buffer.from(out[field], 'utf8').toString('utf8');
                }
            }
            return out;
        });
    }
    _providerStreamCache.delete(k);
    _providerStreamCache.set(k, { streams: toStore, ts: Date.now(), ttl });
    debug(3, 'Addon/Cache', 'store', { type, id, streams: toStore.length });
    // Bounded LRU-ish: when over limit, drop expired first, then oldest.
    if (_providerStreamCache.size > PROVIDER_CACHE_MAX_ENTRIES) {
        const now = Date.now();
        for (const [key, val] of _providerStreamCache) {
            if (now - val.ts > val.ttl) _providerStreamCache.delete(key);
        }
        if (_providerStreamCache.size > PROVIDER_CACHE_MAX_ENTRIES) {
            const keys = Array.from(_providerStreamCache.keys()).slice(0, _providerStreamCache.size - PROVIDER_CACHE_MAX_ENTRIES);
            for (const dk of keys) _providerStreamCache.delete(dk);
        }
    }
}

// Funzione per creare il builder con configurazione dinamica
export function createBuilder() {
    const manifest = loadCustomConfig();
    const builder = new addonBuilder(manifest);

    // === HANDLER STREAM ===
    builder.defineStreamHandler(
        async ({
            id,
            type,
            config: requestConfig
        }: {
            id: string;
            type: string;
            config?: any;
        }): Promise<{
            streams: Stream[];
        }> => {
            try {
                // Normalize type: handle Italian endpoint names (film->movie, serie->series)
                let normalizedType = type;
                if (type === 'film') normalizedType = 'movie';
                if (type === 'serie') normalizedType = 'series';
                // Use normalized type for all downstream logic
                type = normalizedType;

                // `type` è un segmento URL e finisce nella chiave della cache del
                // fan-out: senza il confronto col manifest, ogni variante inventata
                // crea una chiave nuova e rifà le richieste ai tre siti.
                if (!baseManifest.types.includes(normalizedType)) {
                    debug(2, 'Addon', 'tipo non dichiarato nel manifest', { type: normalizedType });
                    return { streams: [] };
                }

                const requestStarted = Date.now();
                debug(1, 'Addon', 'stream request', { type: normalizedType, id });

                // EasyProxy viene preso dalla config dell'utente (requestConfig)
                // Se l'utente non ha EasyProxy configurato, usa env vars come fallback (per installazioni locali)
                // MAI da una cache globale (che era il bug: veniva contaminata da altri utenti)
                let config: AddonConfig = {};
                if (requestConfig && typeof requestConfig === 'string') {
                    // Edge case: SDK passed config as raw string (base64/JSON) instead of parsed object
                    try {
                        const parsed = parseConfigFromArgs(requestConfig);
                        if (isValidConfigObject(parsed) && Object.keys(parsed).length > 0) {
                            config = normalizeConfig(parsed);
                        }
                    } catch {
                        // Ignore unparseable raw config
                    }
                } else if (requestConfig && typeof requestConfig === 'object' && isValidConfigObject(requestConfig) && Object.keys(requestConfig).length > 0) {
                    // Normalizza e valida la config prima di usarla
                    config = normalizeConfig(requestConfig);
                }

                // NOTE: Il middleware ora converte Base64→JSON prima che l'SDK processi la request,
                // quindi requestConfig dovrebbe sempre contenere la config utente correttamente.

                // API Mode detection: when config has NO explicit provider settings, assume direct API call
                // Direct API call = curl to /stream/movie/xxx.json without any config
                // User with config (even without EasyProxy) should NOT trigger API mode
                const hasAnyProviderSetting = (() => {
                    const cfg = config as any;
                    const providerKeys = [
                        'animesaturnEnabled', 'animeworldEnabled', 'animeunityEnabled'
                    ];
                    return providerKeys.some(k => cfg[k] !== undefined);
                })();
                const isDirectAPICall = !hasAnyProviderSetting;

                // EasyProxy: stessa regola delle altre variabili condivise con l'env
                // (chiave del link, altrimenti EASYPROXY_URL). La modalità Direct
                // della landing la disattiva in modo esplicito, env compreso.
                const easyProxyUrl = resolvePlaybackProxyUrl(
                    config.directPlayback,
                    config.easyProxyUrl,
                    process.env.EASYPROXY_URL
                );
                // La password del server si usa quando il proxy attivo è quello del server:
                // un proxy personalizzato dell'utente usa solo la propria password.
                // Non è un confine di sicurezza: `EASYPROXY_URL` è pubblicato in chiaro
                // sulla landing, quindi chi legge `/` può chiedere lo stesso proxy e
                // ottenere la password del server. Per tenerla privata va tolto il
                // fallback, non cambiato questo confronto.
                const isServerProxy = Boolean(
                    easyProxyUrl &&
                    process.env.EASYPROXY_URL &&
                    easyProxyUrl.replace(/\/+$/, '') === process.env.EASYPROXY_URL.trim().replace(/\/+$/, '')
                );
                const easyProxyPassword = easyProxyUrl
                    ? String(config.easyProxyPassword || (isServerProxy ? process.env.EASYPROXY_PASSWORD : '') || '')
                    : '';

                const allStreams: Stream[] = [];
                let _providerConfigSig = ''; // Dichiarato qui per essere in scope nel cache-set finale
                let providerFailure = false;

                // === LOGICA ANIME/FILM (originale) ===
                // Per tutto il resto, usa solo easyProxyUrl/easyProxyPassword
                // Gestione AnimeUnity per ID Kitsu o MAL con fallback variabile ambiente

                const envFlag = (name: string) => normalizeBool(process.env[name]);

                const rc = requestConfig as any;
                // L'env è solo un kill switch: `false` toglie il provider, `true` o
                // assente lasciano decidere la configurazione dell'utente. Con `??`
                // un `=true` in env.example rendeva inerti le checkbox della landing.
                const enabledBy = (envName: string, fromConfig: boolean | undefined, fromRequest: boolean | undefined) =>
                    envFlag(envName) === false ? false : (isDirectAPICall || fromConfig === true || fromRequest === true);
                const animeUnityEnabled = enabledBy('ANIMEUNITY_ENABLED', config.animeunityEnabled, rc?.animeunityEnabled);
                const animeSaturnEnabled = enabledBy('ANIMESATURN_ENABLED', config.animesaturnEnabled, rc?.animesaturnEnabled);
                const animeWorldEnabled = enabledBy('ANIMEWORLD_ENABLED', config.animeworldEnabled, rc?.animeworldEnabled);

                debug(2, 'Addon', 'providers resolved', {
                    directApiCall: isDirectAPICall,
                    animeUnityEnabled: !!animeUnityEnabled,
                    animeSaturnEnabled: !!animeSaturnEnabled,
                    animeWorldEnabled: !!animeWorldEnabled,
                    easyProxyPlayback: !!easyProxyUrl,
                    scrapingProxy: !!(process.env.PROXY || process.env.AU_PROXY || process.env.AS_PROXY || process.env.AW_PROXY),
                });

                if ((id.startsWith('kitsu:') || id.startsWith('mal:') || id.startsWith('tt') || id.startsWith('tmdb:') || id.startsWith('tvdb:')) && (animeUnityEnabled || animeSaturnEnabled || animeWorldEnabled)) {
                    // === CACHE KEY CONSTRUCTION ===
                    // Costruita dai valori NORMALIZZATI che vengono realmente passati ai provider.
                    // Include TUTTI i campi che influenzano gli stream restituiti.
                    // Usa SHA-256 per evitare collisioni tra configurazioni diverse.
                    const tmdbKey = String(config.tmdbApiKey || process.env.TMDB_API_KEY || '').trim();
                    const tvdbApiKey = String(config.tvdbApiKey || process.env.TVDB_API_KEY || '').trim();
                    const tvdbPin = String(config.tvdbPin || process.env.TVDB_PIN || '').trim();
                    _providerConfigSig = providerConfigDigest({
                        type: normalizedType,
                        id,
                        proxyUrl: easyProxyUrl,
                        proxyPassword: easyProxyPassword,
                        tmdbApiKey: tmdbKey,
                        tvdbApiKey,
                        tvdbPin,
                        animeunityEnabled: !!animeUnityEnabled,
                        animesaturnEnabled: !!animeSaturnEnabled,
                        animeworldEnabled: !!animeWorldEnabled,
                        animeunityDirect: config.animeunityDirect,
                        animeunityProxy: config.animeunityProxy,
                        mappingVersion: getMappingVersion(),
                    });

                    // Cache check before the expensive fan-out.
                    const _cachedStreams = _providerCacheGet(normalizedType, id, _providerConfigSig);
                    if (_cachedStreams) {
                        debug(2, 'Addon', 'provider cache hit', { type: normalizedType, id, streams: _cachedStreams.length });
                        // Anche la cache hit è un esito: senza questa riga il caso
                        // "nessuno stream" dalla cache negativa spariva dai log.
                        console.log(`[stream] ${normalizedType}/${id} → ${_cachedStreams.length} stream in ${Date.now() - requestStarted}ms (cache)`);
                        return { streams: _cachedStreams };
                    }
                    debug(3, 'Addon', 'provider cache miss', { type: normalizedType, id });

                    if (!tmdbKey && !warnedMissingTmdbKey) {
                        warnedMissingTmdbKey = true;
                        console.warn('[Config] TMDB_API_KEY missing: TMDB/IMDb mapping and title fallbacks are disabled (Kitsu/TVDB still work).');
                    }

                    const animeUnityConfig = {
                        enabled: animeUnityEnabled,
                        proxyUrl: easyProxyUrl,
                        proxyPassword: easyProxyPassword,
                        tmdbApiKey: tmdbKey,
                        tvdbApiKey,
                        tvdbPin,
                        animeunityDirect: normalizeBool(config.animeunityDirect),
                        animeunityProxy: normalizeBool(config.animeunityProxy),
                    } as AnimeUnityConfig;
                    const animeSaturnConfig = {
                        enabled: animeSaturnEnabled,
                        proxyUrl: easyProxyUrl,
                        proxyPassword: easyProxyPassword,
                        tmdbApiKey: tmdbKey,
                        tvdbApiKey,
                        tvdbPin
                    };
                    const animeWorldConfig = {
                        enabled: animeWorldEnabled,
                        proxyUrl: easyProxyUrl,
                        proxyPassword: easyProxyPassword,
                        tmdbApiKey: tmdbKey,
                        tvdbApiKey,
                        tvdbPin
                    };
                    // Parsing stagione/episodio per IMDB/TMDB/TVDB/MAL
                    const parsedRequest = parseRequestId(id);
                    const seasonNumber: number | null = parsedRequest?.season ?? null;
                    const episodeNumber: number | null = parsedRequest?.episode ?? null;
                    const isMovie = parsedRequest?.isMovie ?? false;
                    const providerPromises: Promise<Stream[]>[] = [];

                    debug(2, 'Addon', 'provider fan-out', {
                        id,
                        season: seasonNumber,
                        episode: episodeNumber,
                        isMovie,
                    });
                    // Titolo/lingua/proxy/bingeGroup: logica pura in utils/streamTitle.ts

                    const runProvider = async (name: string, enabled: boolean, handler: () => Promise<{ streams: Stream[] }>, streamName: string, timeoutMs: number | null = PROVIDER_TIMEOUT_MS): Promise<Stream[]> => {
                        if (!enabled) {
                            debug(3, 'Provider', 'disabled', name);
                            return [];
                        }
                        const startedAt = Date.now();
                        debug(2, 'Provider', 'start', name);
                        // Lo store vive quanto il provider-run: fetchResource marca
                        // `failed` quando una fetch provider-site fallisce, e legge
                        // `signal` per annullare le fetch rimaste in coda.
                        const controller = new AbortController();
                        const store: { failed: boolean; signal?: AbortSignal } = { failed: false, signal: controller.signal };
                        try {
                            let result: { streams: Stream[] } | undefined;

                            if (timeoutMs !== null && timeoutMs > 0) {
                                // Provider con timeout personalizzato
                                let timer: ReturnType<typeof setTimeout> | undefined;
                                const timeoutPromise = new Promise<{ streams: Stream[] }>((_, reject) => {
                                    timer = setTimeout(() => {
                                        // Il race senza abort lasciava l'handler a girare:
                                        // annullarlo è il punto, non un dettaglio.
                                        controller.abort();
                                        reject(new Error(`${name} timeout after ${timeoutMs}ms`));
                                    }, timeoutMs);
                                });
                                try {
                                    result = await Promise.race([providerRequestStore.run(store, () => handler()), timeoutPromise]);
                                } finally {
                                    if (timer !== undefined) clearTimeout(timer);
                                }
                            } else {
                                // Provider senza timeout (comportamento attuale)
                                result = await providerRequestStore.run(store, () => handler());
                            }

                            if (store.failed) providerFailure = true;

                            if (result && result.streams) {
                                const prepared = result.streams.map(s => ({ ...s, name: (s as any).name || streamName } as Stream));
                                const streams = unifyStreams(prepared, streamName);
                                debug(2, 'Provider', 'done', { name, streams: streams.length, ms: Date.now() - startedAt });
                                return streams;
                            }
                        } catch (error) {
                            providerFailure = true;
                            const message = (error as any)?.message || String(error);
                            const ms = Date.now() - startedAt;
                            // Un timeout è atteso e non merita uno stack: i campi sì,
                            // sempre. Prima i campi utili stavano in un debug spento
                            // e in produzione restava solo lo stack.
                            if (/timeout after \d+ms/.test(message)) console.warn(`🚨 ${name} timeout (${ms}ms): ${message}`);
                            else console.error(`🚨 ${name} error (${ms}ms): ${message}`, error);
                        }
                        return [];
                    };
                    const scheduleProviderRun = (
                        name: string,
                        enabled: boolean,
                        handler: () => Promise<{ streams: Stream[] }>,
                        streamName: string,
                        timeoutMs: number | null = PROVIDER_TIMEOUT_MS
                    ): void => {
                        providerPromises.push(runProvider(name, enabled, handler, streamName, timeoutMs));
                    };
                    // AnimeUnity
                    scheduleProviderRun('AnimeUnity', animeUnityEnabled, async () =>
                        dispatchRequest(new AnimeUnityProvider(animeUnityConfig), id, seasonNumber, episodeNumber, isMovie),
                        providerLabel('animeunity'));

                    // AnimeSaturn
                    scheduleProviderRun('AnimeSaturn', animeSaturnEnabled, async () => {
                        const { AnimeSaturnProvider } = await import('./providers/animesaturn-provider.js');
                        return dispatchRequest(new AnimeSaturnProvider(animeSaturnConfig), id, seasonNumber, episodeNumber, isMovie);
                    }, providerLabel('animesaturn'));

                    // AnimeWorld
                    scheduleProviderRun('AnimeWorld', animeWorldEnabled, async () => {
                        const { AnimeWorldProvider } = await import('./providers/animeworld-provider.js');
                        return dispatchRequest(new AnimeWorldProvider(animeWorldConfig), id, seasonNumber, episodeNumber, isMovie);
                    }, providerLabel('animeworld'));

                    // Si aspettano tutti: consegnare una lista tagliata toglie i
                    // provider lenti, e su una serie mai vista sono 7-10 s.
                    // L'attesa sta in stream.ts perché è il punto dove è già
                    // passato il bug del budget di risposta.
                    allStreams.push(...(await collectProviderStreams(providerPromises)));

                }

                // === ORDINAMENTO STREAM PER PRIORITÀ ===
                // Applica ordinamento priorità (prima di ordinamento provider)
                try {
                    if (allStreams.length > 1) {
                        sortStreamsByPriority(allStreams);
                        debug(3, 'Addon', `[StaticStreams] Stream ordinati per priorità: ${allStreams.length} totali`);
                    }
                } catch (sortErr) {
                    debug(3, 'Addon', `[StaticStreams] Errore ordinamento:`, String((sortErr as any)?.message || sortErr));
                }
                // Global provider ordering - per serie/film
                try {
                    // Ordina per provider (movie/series mantengono ordinamento provider)
                    {
                        allStreams.sort((a, b) => providerRank((a.name || a.title || '').toString()) - providerRank((b.name || b.title || '').toString()));
                    }
                } catch {
                    // Fallback to unsorted streams if provider sorting fails
                }

                // Una riga per richiesta, sempre: senza, "non vedo stream per X"
                // non lascia traccia né dell'arrivo né dell'esito.
                console.log(`[stream] ${normalizedType}/${id} → ${allStreams.length} stream in ${Date.now() - requestStarted}ms`);
                // Zero stream con un cooldown attivo non è "titolo assente": va detto,
                // altrimenti l'operatore cerca un problema di matching che non c'è.
                if (allStreams.length === 0) {
                    const cooling = cooldownSnapshot();
                    if (cooling.length) {
                        console.warn(`[stream] nessuno stream e ${cooling.length} uscite in cooldown: ${cooling.map((c) => c.exitKey).join(', ')}`);
                    }
                }
                // Cache the fan-out result for repeat plays, but never when a
                // provider failed or timed out: a partial list would hide it for
                // 5 minutes.
                if (!providerFailure && _providerConfigSig && (id.startsWith('tt') || id.startsWith('tmdb:') || id.startsWith('tvdb:') || id.startsWith('kitsu:') || id.startsWith('mal:'))) {
                    _providerCacheSet(normalizedType, id, _providerConfigSig, allStreams);
                }
                return { streams: allStreams };
            } catch (error) {
                console.error('Stream extraction failed:', error);
                return { streams: [] };
            }
        }
    );

    return builder;
}

// Server Express (minimale)
const app = express();

// Serve la cartella public.
app.use(
    '/public',
    express.static(path.join(__dirname, '..', 'public'), { dotfiles: 'allow' /* Express 5: preserve v4 behavior */ })
);

// Manifest con icona e sfondo presi da questa istanza: un repo GitHub privato
// non può ospitarli (i raw URL rispondono 404 ai client Stremio/Nuvio).
app.use((req: Request, res: ExpressResponse, next: NextFunction) => {
    if (!req.path.endsWith('/manifest.json')) return next();
    const baseUrl = detectPublicBaseUrl({
        host: req.get('host'),
        forwardedHost: req.get('x-forwarded-host'),
        forwardedPort: req.get('x-forwarded-port'),
        forwardedProto: req.get('x-forwarded-proto'),
        protocol: req.protocol,
    }) || `${req.protocol}://${req.get('host') || ''}`;
    const manifest = withInstanceAssets(loadCustomConfig() as Record<string, unknown>, baseUrl);
    // Con la config nel percorso il manifest non è più "configurabile": senza
    // questo l'app desktop apre la configurazione invece di installare.
    if (hasConfigSegment(req.path)) {
        const installed = withoutConfigHints(manifest);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.type('application/json').send(JSON.stringify(installed));
        return;
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.type('application/json').send(JSON.stringify(manifest));
});

// Diagnostica runtime: niente config utente, segreti o valori di env.
// Prima del middleware qui sotto per non passare dal parsing config e dal
// router Stremio (che farebbe next() → 404).
app.get('/status.json', (_req: Request, res: ExpressResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/json').send(JSON.stringify({
        addon: {
            version: loadCustomConfig().version,
            uptimeMs: Math.round(process.uptime() * 1000),
        },
        mapping: getMappingStatus(),
        // Il catalogo ha la stessa soglia di "vecchio" del mapping: due pipeline,
        // una sola idea di quando un file è da rifare.
        catalog: getCatalogStatus(MAPPING_STALE_MS),
        // Quale uscita è in pausa e fino a quando: senza, "siamo sotto WAF?"
        // si poteva solo dedurre da righe d'errore a livello 2.
        cooldown: cooldownSnapshot(),
        cache: {
            entries: _providerStreamCache.size,
            maxEntries: PROVIDER_CACHE_MAX_ENTRIES,
            ttlMs: PROVIDER_CACHE_TTL_MS,
            disabled: PROVIDER_CACHE_DISABLED,
        },
    }));
});

// ✅ Middleware semplificato che usa sempre il router globale
app.use((req: Request, res: ExpressResponse, next: NextFunction) => {
    debug(3, 'Addon', `Incoming request: ${req.method}`);

    const configString = req.path.split('/')[1];
    debug(4, 'Addon', `Config segment length: ${configString ? configString.length : 0}`);

    // Parse configuration from URL path segment once (before TV logic)
    // FIX DEFINITIVO: NON scrivere MAI la config dell'utente nella cache globale!
    // Ogni utente ha la sua config nel URL, non deve inquinare quella degli altri.
    // La configurazione del server è separata da quella dell'utente.
    if (configString && configString.length > 10 && !configString.startsWith('stream') && !configString.startsWith('meta') && !configString.startsWith('manifest')) {
        const parsedConfig = parseConfigFromArgs(configString);
        // VALIDAZIONE: Object.keys() su null/array/string/number causa crash
        if (!isValidConfigObject(parsedConfig)) {
            debug(3, 'Addon', `⚠️ Invalid config type in URL: ${typeof parsedConfig}, ignoring`);
            // Continua con la richiesta senza config (default)
        } else if (Object.keys(parsedConfig).length > 0) {
            debug(3, 'Addon', '🔧 Found valid config in URL (NOT updating global cache - user-specific)');
            // NON fare più merge della config utente in uno stato globale.

            // ✅ FIX: Se la config era Base64, riscrivi l'URL con JSON per l'SDK Stremio
            // L'SDK Stremio fa JSON.parse() diretto sul segmento, quindi dobbiamo dargli JSON valido
            if (!configString.startsWith('{') && !configString.startsWith('%7B')) {
                // Era Base64, riscrivi URL con JSON
                const jsonConfig = JSON.stringify(parsedConfig);
                const encodedJsonConfig = encodeURIComponent(jsonConfig);
                const oldPath = req.path;
                const newPath = oldPath.replace(`/${configString}`, `/${encodedJsonConfig}`);
                req.url = req.url.replace(oldPath, newPath);
                // NOTE: req.path è read-only, ma il router Stremio SDK usa req.url, quindi basta riscrivere quello
                // Invalida la cache interna di Express per forzare il re-parsing
                (req as any)._parsedUrl = undefined;
                debug(4, 'Addon', '[Base64→JSON] Configuration segment rewritten');
            }
        }
    }

    // ✅ Inizializza il router globale se non è ancora stato fatto
    if (!globalRouter) {
        console.log('🔧 Initializing global router...');
        globalBuilder = createBuilder();
        globalAddonInterface = globalBuilder.getInterface();
        globalRouter = getRouter(globalAddonInterface);
        console.log('✅ Global router initialized');
    }

    // USA SEMPRE il router globale
    globalRouter(req, res, next);
});

console.log(`✅ Addon active on port ${process.env.PORT || 7000}`);
debug(1, 'Addon', 'debug level', DEBUG_LEVEL);

// Landing page per configurazione web
app.get('/', (req: Request, res: ExpressResponse) => {
    try {
        const manifest = loadCustomConfig();
        const publicBaseUrl = detectPublicBaseUrl({
            host: req.get('host'),
            forwardedHost: req.get('x-forwarded-host'),
            forwardedPort: req.get('x-forwarded-port'),
            forwardedProto: req.get('x-forwarded-proto'),
            protocol: req.protocol,
        });
        void sendHtmlResponse(req, res, landingTemplate(manifest, process.env, publicBaseUrl, getMappingStatus()));
    } catch (e) {
        console.error('[Landing] error:', (e as any)?.message || e);
        res.status(500).send('Errore caricamento landing page');
    }
});

// Avvia il server Express solo se questo modulo è l'entry point. Importarlo da
// un test non deve legare una porta né armare i timer: è la condizione per
// poter provare il fan-out a comportamento invece che con una regex.
const isEntryPoint = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

const PORT = parseInt(process.env.PORT || '7000', 10);
const server = isEntryPoint ? app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 HanX addon listening on http://0.0.0.0:${PORT}`);
    // L'indice mapping (13 MB) si carica qui e non alla prima richiesta: dopo un
    // refresh lo snapshot è nullo, e il primo utente pagherebbe parse + hash.
    void getMappingVersion();
    // Indice mapping remoto: parte dopo il listen, non blocca l'avvio.
    void refreshMappingFromUrl();
    setInterval(() => void refreshMappingFromUrl(), MAPPING_REFRESH_INTERVAL_MS).unref();
    // Catalogo dei titoli (branch `data`): stesso schema, non blocca l'avvio.
    void refreshCatalogFromUrl();
    setInterval(() => void refreshCatalogFromUrl(), CATALOG_REFRESH_INTERVAL_MS).unref();
}) : null;

let isShuttingDown = false;
const onShutdown = (signal: string) => {
    if (isShuttingDown) process.exit(0);
    isShuttingDown = true;
    debug(1, 'Server', `Ricevuto segnale ${signal}, chiusura server...`);
    const forceTimer = setTimeout(() => process.exit(0), 5000);
    forceTimer.unref();
    (server as any)?.closeIdleConnections?.();
    if (!server) process.exit(0);
    server.close(() => process.exit(0));
};
process.on('SIGTERM', () => onShutdown('SIGTERM'));
process.on('SIGINT', () => onShutdown('SIGINT'));
