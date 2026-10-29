import stremioAddonSdk from "stremio-addon-sdk";
const { addonBuilder, getRouter } = stremioAddonSdk;
import type { Manifest, Stream } from "stremio-addon-sdk";
import { fileURLToPath } from 'node:url';
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
} from './config.js';
import { AnimeUnityProvider } from './providers/animeunity-provider.js';
import { providerLabel } from './utils/unifiedNames.js';
import { landingTemplate } from './landingPage.js';
import { toNumericId, parseRequestId } from './mapping/request.js';
import { getMappingVersion, refreshMappingFromUrl } from './mapping/index.js';
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

// Helper: compute Europe/Rome interpretation for eventStart even if timezone is missing
// ================= MANIFEST BASE (restored) =================
const baseManifest: Manifest = {
    id: "org.stremio.hanx",
    version: "1.0.4",
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
const PROVIDER_CACHE_TTL_MS = (() => {
    try {
        const n = parseInt(process.env.PROVIDER_CACHE_TTL_MS || '300000', 10);
        return Number.isFinite(n) && n > 0 ? n : 300000;
    } catch { return 300000; }
})();
const PROVIDER_CACHE_MAX_ENTRIES = (() => {
    try {
        const n = parseInt(process.env.PROVIDER_CACHE_MAX_ENTRIES || '500', 10);
        return Number.isFinite(n) && n > 10 ? n : 500;
    } catch { return 500; }
})();
const PROVIDER_CACHE_DISABLED: boolean = (() => {
    try {
        const v = (process?.env?.PROVIDER_CACHE_DISABLE || '').toString().toLowerCase();
        return v === '1' || v === 'true' || v === 'on' || v === 'yes';
    } catch { return false; }
})();
const _providerStreamCache = new Map<string, { streams: any[]; ts: number }>();

function _providerCacheGet(type: string, id: string, configDigest: string): any[] | null {
    if (PROVIDER_CACHE_DISABLED) return null;
    const k = providerCacheKey(type, id, configDigest);
    const e = _providerStreamCache.get(k);
    if (!e) return null;
    if (Date.now() - e.ts > PROVIDER_CACHE_TTL_MS) {
        _providerStreamCache.delete(k);
        return null;
    }
    return e.streams;
}
function _providerCacheSet(type: string, id: string, configDigest: string, streams: any[]): void {
    if (PROVIDER_CACHE_DISABLED) return;
    if (!Array.isArray(streams) || streams.length === 0) return; // never cache empty results
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
    _providerStreamCache.set(k, { streams: toStore, ts: Date.now() });
    debug(3, 'Addon/Cache', 'store', { type, id, streams: toStore.length });
    // Bounded LRU-ish: when over limit, drop expired first, then oldest.
    if (_providerStreamCache.size > PROVIDER_CACHE_MAX_ENTRIES) {
        const now = Date.now();
        for (const [key, val] of _providerStreamCache) {
            if (now - val.ts > PROVIDER_CACHE_TTL_MS) _providerStreamCache.delete(key);
        }
        if (_providerStreamCache.size > PROVIDER_CACHE_MAX_ENTRIES) {
            const keys = Array.from(_providerStreamCache.keys()).slice(0, _providerStreamCache.size - PROVIDER_CACHE_MAX_ENTRIES);
            for (const dk of keys) _providerStreamCache.delete(dk);
        }
    }
}

// Funzione per creare il builder con configurazione dinamica
function createBuilder() {
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

                const requestStarted = Date.now();
                debug(1, 'Addon', 'stream request', { type: normalizedType, id });

                // EasyProxy viene preso dalla config dell'utente (requestConfig)
                // Se l'utente non ha EasyProxy configurato, usa env vars come fallback (per installazioni locali)
                // MAI da una cache globale (che era il bug: veniva contaminata da altri utenti)
                let config: any = {};
                if (requestConfig && typeof requestConfig === 'string') {
                    // Edge case: SDK passed config as raw string (base64/JSON) instead of parsed object
                    try {
                        const parsed = parseConfigFromArgs(requestConfig);
                        if (isValidConfigObject(parsed) && Object.keys(parsed).length > 0) {
                            config = normalizeConfig(parsed);
                        }
                    } catch { }
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
                const easyProxyPassword = easyProxyUrl
                    ? String(config.easyProxyPassword || process.env.EASYPROXY_PASSWORD || '')
                    : '';

                const allStreams: Stream[] = [];
                let _providerConfigSig = ''; // Dichiarato qui per essere in scope nel cache-set finale
                let providerFailure = false;

                // === LOGICA ANIME/FILM (originale) ===
                // Per tutto il resto, usa solo easyProxyUrl/easyProxyPassword
                // Gestione AnimeUnity per ID Kitsu o MAL con fallback variabile ambiente

                const envFlag = (name: string) => normalizeBool(process.env[name]);

                const rc = requestConfig as any;
                const animeUnityEnabled = envFlag('ANIMEUNITY_ENABLED') ?? (isDirectAPICall || config.animeunityEnabled === true || rc?.animeunityEnabled === true);
                const animeSaturnEnabled = envFlag('ANIMESATURN_ENABLED') ?? (isDirectAPICall || config.animesaturnEnabled === true || rc?.animesaturnEnabled === true);
                const animeWorldEnabled = envFlag('ANIMEWORLD_ENABLED') ?? (isDirectAPICall || config.animeworldEnabled === true || rc?.animeworldEnabled === true);

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

                    const runProvider = async (name: string, enabled: boolean, handler: () => Promise<{ streams: Stream[] }>, streamName: string, timeoutMs: number | null = null): Promise<Stream[]> => {
                        if (!enabled) {
                            debug(3, 'Provider', 'disabled', name);
                            return [];
                        }
                        const startedAt = Date.now();
                        debug(2, 'Provider', 'start', name);
                        try {
                            let result;

                            if (timeoutMs !== null && timeoutMs > 0) {
                                // Provider con timeout personalizzato
                                let timer: ReturnType<typeof setTimeout> | undefined;
                                const timeoutPromise = new Promise<{ streams: Stream[] }>((_, reject) => {
                                    timer = setTimeout(() => reject(new Error(`${name} timeout after ${timeoutMs}ms`)), timeoutMs);
                                });
                                try {
                                    result = await Promise.race([handler(), timeoutPromise]);
                                } finally {
                                    if (timer !== undefined) clearTimeout(timer);
                                }
                            } else {
                                // Provider senza timeout (comportamento attuale)
                                result = await handler();
                            }

                            if (result && result.streams) {
                                const prepared = result.streams.map(s => ({ ...s, name: (s as any).name || streamName } as Stream));
                                const streams = unifyStreams(prepared, streamName);
                                debug(2, 'Provider', 'done', { name, streams: streams.length, ms: Date.now() - startedAt });
                                return streams;
                            }
                        } catch (error) {
                            providerFailure = true;
                            console.error(`🚨 ${name} error:`, error);
                            debug(1, 'Provider', 'failed', { name, ms: Date.now() - startedAt, error: (error as any)?.message || String(error) });
                        }
                        return [];
                    };
                    const scheduleProviderRun = (
                        name: string,
                        enabled: boolean,
                        handler: () => Promise<{ streams: Stream[] }>,
                        streamName: string,
                        timeoutMs: number | null = null
                    ): void => {
                        providerPromises.push(runProvider(name, enabled, handler, streamName, timeoutMs));
                    };
                    // AnimeUnity
                    scheduleProviderRun('AnimeUnity', animeUnityEnabled, async () => {
                        const animeUnityProvider = new AnimeUnityProvider(animeUnityConfig);
                        let res;
                        if (id.startsWith('kitsu:')) res = await animeUnityProvider.handleKitsuRequest(id);
                        else if (id.startsWith('mal:')) res = await animeUnityProvider.handleMalRequest(id);
                        else if (id.startsWith('tt')) res = await animeUnityProvider.handleImdbRequest(id, seasonNumber, episodeNumber, isMovie);
                        else if (id.startsWith('tmdb:')) res = await animeUnityProvider.handleTmdbRequest(toNumericId(id), seasonNumber, episodeNumber, isMovie);
                        else if (id.startsWith('tvdb:')) res = await animeUnityProvider.handleTvdbRequest(toNumericId(id), seasonNumber, episodeNumber, isMovie);
                        else res = { streams: [] };
                        return res;
                    }, providerLabel('animeunity'), 30000);  // AnimeUnity: timeout 30s

                    // AnimeSaturn
                    scheduleProviderRun('AnimeSaturn', animeSaturnEnabled, async () => {
                        const { AnimeSaturnProvider } = await import('./providers/animesaturn-provider.js');
                        const animeSaturnProvider = new AnimeSaturnProvider(animeSaturnConfig);
                        if (id.startsWith('kitsu:')) return animeSaturnProvider.handleKitsuRequest(id);
                        if (id.startsWith('mal:')) return animeSaturnProvider.handleMalRequest(id);
                        if (id.startsWith('tt')) return animeSaturnProvider.handleImdbRequest(id, seasonNumber, episodeNumber, isMovie);
                        if (id.startsWith('tmdb:')) return animeSaturnProvider.handleTmdbRequest(toNumericId(id), seasonNumber, episodeNumber, isMovie);
                        if (id.startsWith('tvdb:')) return animeSaturnProvider.handleTvdbRequest(toNumericId(id), seasonNumber, episodeNumber, isMovie);
                        return { streams: [] };
                    }, providerLabel('animesaturn'), 30000);  // AnimeSaturn: timeout 30s

                    // AnimeWorld
                    scheduleProviderRun('AnimeWorld', animeWorldEnabled, async () => {
                        const { AnimeWorldProvider } = await import('./providers/animeworld-provider.js');
                        const animeWorldProvider = new AnimeWorldProvider(animeWorldConfig);
                        if (id.startsWith('kitsu:')) return animeWorldProvider.handleKitsuRequest(id);
                        if (id.startsWith('mal:')) return animeWorldProvider.handleMalRequest(id);
                        if (id.startsWith('tt')) return animeWorldProvider.handleImdbRequest(id, seasonNumber, episodeNumber, isMovie);
                        if (id.startsWith('tmdb:')) return animeWorldProvider.handleTmdbRequest(toNumericId(id), seasonNumber, episodeNumber, isMovie);
                        if (id.startsWith('tvdb:')) return animeWorldProvider.handleTvdbRequest(toNumericId(id), seasonNumber, episodeNumber, isMovie);
                        return { streams: [] };
                    }, providerLabel('animeworld'), 30000);  // AnimeWorld: timeout 30s

                    const allProviderResults = await Promise.all(providerPromises);
                    for (const group of allProviderResults) {
                        for (const s of group) allStreams.push(s);
                    }

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
                } catch { }

                debug(1, 'Addon', 'stream response', {
                    type: normalizedType,
                    id,
                    streams: allStreams.length,
                    ms: Date.now() - requestStarted,
                });
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
    const manifest = withInstanceAssets(loadCustomConfig() as Record<string, any>, baseUrl);
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
                const newPath = oldPath.replace('/' + configString, '/' + encodedJsonConfig);
                req.url = req.url.replace(oldPath, newPath);
                // NOTE: req.path è read-only, ma il router Stremio SDK usa req.url, quindi basta riscrivere quello
                // Invalida la cache interna di Express per forzare il re-parsing
                (req as any)._parsedUrl = undefined;
                debug(4, 'Addon', '[Base64→JSON] Configuration segment rewritten');
            }
        }
    }

    // ...

    // PATCH: Inject full search query for AnimeWorld catalog search
    if (
        req.path === '/catalog/animeworld/anime/search.json' &&
        req.query && typeof req.query.query === 'string'
    ) {
        debug(3, 'Addon', '🔎 PATCH: Injecting full search query from req.query.query:', req.query.query);
        // Ensure req.query.extra is always an object
        let extraObj: any = {};
        if (req.query.extra) {
            if (typeof req.query.extra === 'string') {
                try {
                    extraObj = JSON.parse(req.query.extra);
                } catch (e) {
                    extraObj = {};
                }
            } else if (typeof req.query.extra === 'object') {
                extraObj = req.query.extra;
            }
        }
        extraObj.search = req.query.query;
        req.query.extra = extraObj;
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
        void sendHtmlResponse(req, res, landingTemplate(manifest, process.env, publicBaseUrl));
    } catch (e) {
        console.error('[Landing] error:', (e as any)?.message || e);
        res.status(500).send('Errore caricamento landing page');
    }
});

// Avvia il server Express
const PORT = parseInt(process.env.PORT || '7000', 10);
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 HanX addon listening on http://0.0.0.0:${PORT}`);
    // Indice mapping remoto: parte dopo il listen, non blocca l'avvio.
    void refreshMappingFromUrl();
    setInterval(() => void refreshMappingFromUrl(), 6 * 60 * 60 * 1000).unref();
});
