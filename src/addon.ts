import { addonBuilder, getRouter, Manifest, Stream } from "stremio-addon-sdk";
import { buildUnifiedStreamName, providerLabel } from './utils/unifiedNames';
import * as fs from 'fs';
import { landingTemplate } from './landingPage';
import * as path from 'path';
import { createHash } from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import { AnimeUnityProvider } from './providers/animeunity-provider';
import { AnimeWorldProvider } from './providers/animeworld-provider';
import { KitsuProvider } from './providers/kitsu';
import { formatMediaFlowUrl } from './utils/mediaflow';
import fetchMod = require('node-fetch');
import { fetchPage } from './providers/flaresolverr';

// --- Lightweight declarations to avoid TS complaints if @types/node non installati ---
// (Non sostituiscono l'uso consigliato di @types/node, ma evitano errori bloccanti.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Buffer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function require(name: string): any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const global: any;
import { AnimeUnityConfig } from './types/animeunity';

// ================= TYPES & INTERFACES =================

interface AddonConfig {
    tmdbApiKey?: string;
    mediaFlowProxyUrl?: string;
    mediaFlowProxyPassword?: string;
    // Proxy backend toggle: false/undefined = EasyProxy (default), true = MediaFlow.
    useMediaFlow?: boolean;
    enableMpd?: boolean;
    animeunityEnabled?: boolean;
    animesaturnEnabled?: boolean;
    animeworldEnabled?: boolean;
    addonBase?: string;
}

// debugLog: gated by DEBUG_LOG env (default OFF) to evitare flood per-request in prod.
const DEBUG_LOG_ENABLED: boolean = (() => {
    try {
        const v = (process.env.DEBUG_LOG || '').toString().trim().toLowerCase();
        return v === '1' || v === 'true' || v === 'on' || v === 'yes';
    } catch { return false; }
})();
function debugLog(...args: any[]) { if (!DEBUG_LOG_ENABLED) return; try { console.log('[DEBUG]', ...args); } catch { } }

// Global runtime configuration cache
const configCache: AddonConfig = {};

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
    version: "12.4.23",
    name: "HanX | Elfhosted",
    description: "HanX addon dedicato ad AnimeUnity, AnimeSaturn e AnimeWorld",
    background: "https://raw.githubusercontent.com/Dexxtex/HanX/refs/heads/main/public/background.png",
    types: ["movie", "series", "anime"],
    idPrefixes: ["tt", "kitsu", "mal", "tmdb"],
    catalogs: [],
    resources: [
        "stream",
        "meta"
    ],
    behaviorHints: { configurable: true },
    config: [
        { key: "tmdbApiKey", title: "TMDB API Key", type: "text" },
        { key: "mediaFlowProxyUrl", title: "☂️ Proxy URL", type: "text" },
        { key: "mediaFlowProxyPassword", title: "Proxy Password (opzionale)", type: "text" },
        { key: "useMediaFlow", title: "Usa MediaFlow Proxy (default: EasyProxy)", type: "checkbox", default: false },
        { key: "animeunityEnabled", title: "Enable AnimeUnity", type: "checkbox" },
        { key: "animeunityDirect", title: "AnimeUnity Direct (solo installazione locale)", type: "checkbox" },
        { key: "animeunityDirectFhd", title: "AnimeUnity Synthetic FHD (solo installazione locale)", type: "checkbox" },
        { key: "animeunityProxy", title: "AnimeUnity Proxy (richiede Proxy, consigliato)", type: "checkbox" },
        { key: "animesaturnEnabled", title: "Enable AnimeSaturn", type: "checkbox" },
        { key: "animeworldEnabled", title: "Enable AnimeWorld", type: "checkbox" },
        // UI helper toggles (not used directly server-side but drive dynamic form logic)
        { key: "personalTmdbKey", title: "TMDB API KEY Personale", type: "checkbox" },
        { key: "mediaflowMaster", title: "MediaflowProxy", type: "checkbox" },
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

// Validazione: verifica che un valore JSON sia un oggetto config valido (non null, non array)
function isValidConfigObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
    );
}

// Helper: normalizza un valore booleano da qualsiasi formato.
// Restituisce undefined se il valore non è riconoscibile come booleano.
function normalizeBool(val: unknown): boolean | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    const s = String(val).toLowerCase().trim();
    if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
    return undefined;
}

// Normalizzazione: converte tutti i valori booleani/stringhe in booleani effettivi
// e normalizza URL rimuovendo trailing slash.
// Gestisce il caso problematico dove "false" come stringa diventa truthy.
function normalizeConfig(raw: Record<string, unknown>): AddonConfig {
    const result: AddonConfig = {};
    for (const [key, value] of Object.entries(raw)) {
        if (key === 'mediaFlowProxyUrl') {
            // Solo URL: rimuovi trailing slash
            if (typeof value === 'string') {
                const str = value.trim().replace(/\/+$/, '');
                if (str) (result as any)[key] = str;
            }
        } else if (key === 'tmdbApiKey') {
            // Chiave API: trimma ma non toccare slash
            if (typeof value === 'string') {
                const str = value.trim();
                if (str) (result as any)[key] = str;
            }
        } else if (key === 'mediaFlowProxyPassword') {
            // Password: preserva ESATTAMENTE come fornita (niente trim, niente replace)
            if (typeof value === 'string') {
                (result as any)[key] = value;
            }
        } else if (key === 'useMediaFlow' || key === 'enableMpd' ||
                   key === 'animeunityEnabled' || key === 'animesaturnEnabled' ||
                   key === 'animeworldEnabled' || key === 'animeunityDirect' ||
                   key === 'animeunityDirectFhd' || key === 'animeunityProxy' ||
                   key === 'personalTmdbKey' || key === 'mediaflowMaster') {
            // Normalizza booleani da qualsiasi formato (stringa, numero, bool)
            if (typeof value === 'boolean') {
                (result as any)[key] = value;
            } else if (typeof value === 'number') {
                (result as any)[key] = value !== 0;
            } else if (typeof value === 'string') {
                const lower = value.toLowerCase().trim();
                if (lower === 'true' || lower === '1' || lower === 'on' || lower === 'yes') {
                    (result as any)[key] = true;
                } else if (lower === 'false' || lower === '0' || lower === 'off' || lower === 'no') {
                    (result as any)[key] = false;
                }
            }
        } else if (key === 'addonBase') {
            const base = typeof value === 'string' ? value.trim() : '';
            if (base) result.addonBase = base;
        }
        // Altrimenti ignora campi non riconosciuti
    }
    return result;
}

function parseConfigFromArgs(args: any): AddonConfig {
    const config: AddonConfig = {};

    // Se non ci sono args o sono vuoti, ritorna configurazione vuota
    if (!args || args === '' || args === 'undefined' || args === 'null') {
        debugLog('No configuration provided, using defaults');
        return config;
    }

    // Se la configurazione è già un oggetto, validalo
    if (typeof args === 'object' && args !== null) {
        if (!isValidConfigObject(args)) {
            debugLog('Configuration object invalid (array or non-object)');
            return config;
        }
        debugLog('Configuration provided as valid object');
        return args as AddonConfig;
    }

    if (typeof args === 'string') {
        debugLog(`Config string length: ${args.length}`);

        // PASSO 1: Prova JSON diretto
        try {
            const parsed = JSON.parse(args);
            debugLog('Configuration parsed as direct JSON');
            if (!isValidConfigObject(parsed)) {
                debugLog('Parsed JSON is not a valid config object');
                return config;
            }
            return normalizeConfig(parsed);
        } catch (error) {
            debugLog('Not direct JSON, trying other methods');
        }

        // PASSO 2: Gestione URL encoded
        let decodedArgs = args;
        if (args.includes('%')) {
            try {
                decodedArgs = decodeURIComponent(args);
                debugLog('URL-decoded configuration');

                // Prova JSON dopo URL decode
                try {
                    const parsed = JSON.parse(decodedArgs);
                    debugLog('Configuration parsed from URL-decoded JSON');
                    if (!isValidConfigObject(parsed)) {
                        debugLog('URL-decoded JSON is not a valid config object');
                        return config;
                    }
                    return normalizeConfig(parsed);
                } catch (innerError) {
                    debugLog('URL-decoded content is not valid JSON');
                }
            } catch (error) {
                debugLog('URL decoding failed');
            }
        }

        // PASSO 3: Gestione Base64
        if (decodedArgs.startsWith('eyJ') || /^[A-Za-z0-9+\/=]+$/.test(decodedArgs)) {
            try {
                // Fix per caratteri = che potrebbero essere URL encoded
                const base64Fixed = decodedArgs
                    .replace(/%3D/g, '=')
                    .replace(/=+$/, ''); // Rimuove eventuali = alla fine

                // Assicura che la lunghezza sia multipla di 4 aggiungendo = se necessario
                let paddedBase64 = base64Fixed;
                while (paddedBase64.length % 4 !== 0) {
                    paddedBase64 += '=';
                }

                debugLog('Trying base64 decode');
                const decoded = Buffer.from(paddedBase64, 'base64').toString('utf-8');
                debugLog(`Base64 decoded length: ${decoded.length}`);

                if (decoded.includes('{') && decoded.includes('}')) {
                    try {
                        const parsed = JSON.parse(decoded);
                        debugLog('Configuration parsed from Base64');
                        if (!isValidConfigObject(parsed)) {
                            debugLog('Base64 JSON is not a valid config object');
                            return config;
                        }
                        return normalizeConfig(parsed);
                    } catch (jsonError) {
                        debugLog('Base64 content is not valid JSON');

                        // Prova a estrarre JSON dalla stringa decodificata
                        const jsonMatch = decoded.match(/({.*})/);
                        if (jsonMatch && jsonMatch[1]) {
                            try {
                                const extractedJson = jsonMatch[1];
                                const parsed = JSON.parse(extractedJson);
                                debugLog('Extracted JSON from Base64 decoded string');
                                if (!isValidConfigObject(parsed)) {
                                    debugLog('Extracted JSON is not a valid config object');
                                    return config;
                                }
                                return normalizeConfig(parsed);
                            } catch (extractError) {
                                debugLog('Extracted JSON parsing failed');
                            }
                        }
                    }
                }
            } catch (error) {
                debugLog('Base64 decoding failed');
            }
        }

        debugLog('All parsing methods failed, using default configuration');
    }

    return config;
}

// ✅ DICHIARAZIONE delle variabili globali del builder
let globalBuilder: any;
let globalAddonInterface: any;
let globalRouter: any;


try {
    // ✅ INIZIALIZZA IL ROUTER GLOBALE
    console.log('🔧 Initializing global router after loading TV channels...');
    globalBuilder = createBuilder(configCache);
    globalAddonInterface = globalBuilder.getInterface();
    globalRouter = getRouter(globalAddonInterface);
    console.log('✅ Global router initialized successfully');
} catch (error) {
    console.error('❌ Errore nell\'inizializzazione del router:', error);
}

// Funzione per determinare le categorie di un canale

function normalizeProxyUrl(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

// Provider extraction cache for anime requests.
// CPU profile showed the dominant CPU consumer was provider URL extraction
// (cheerio+parse5 HTML parsing) on anime stream requests. The same
// imdbId gets clicked by many users in quick succession, each click re-runs
// the full provider fan-out. Caching the resulting Stream[] for 5 min
// coalesces repeat plays.
//
// Cache key includes the user config that affects output (MFP creds + the
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

function _providerCacheKey(type: string, id: string, configDigest: string): string {
    // SHA-256 digest of the effective config ensures different passwords
    // and every flag that changes stream output produce different cache entries.
    return `${type}|${id}|${configDigest}`;
}
function _providerCacheGet(type: string, id: string, configDigest: string): any[] | null {
    if (PROVIDER_CACHE_DISABLED) return null;
    const k = _providerCacheKey(type, id, configDigest);
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
    const k = _providerCacheKey(type, id, configDigest);
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
function createBuilder(initialConfig: AddonConfig = {}) {
    const manifest = loadCustomConfig();
    const builder = new addonBuilder(manifest);

    // === HANDLER META ===
    builder.defineMetaHandler(async ({ type, id, config: requestConfig }: { type: string; id: string; config?: any }) => {
        // Gated behind DEBUG_LOG (per-request).
        debugLog(`📺 META REQUEST: type=${type}, id=${id}`);

        // Meta handler per film/serie (logica originale)
        return { meta: null };
    });

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

                // Gated behind DEBUG_LOG (per-request).
                debugLog(`🔍 Stream request: ${normalizedType}/${id}`);

                // FIX DEFINITIVO: L'MFP viene preso dalla config dell'utente (requestConfig)
                // Se l'utente non ha MFP configurato, usa env vars come fallback (per installazioni locali)
                // MAI dalla configCache globale (che era il bug - veniva contaminata da altri utenti)
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

                // MFP: prima dalla config utente, poi da env vars (per installazioni locali)
                // NORMALIZZA: rimuovi trailing slash per evitare doppi slash in URL tipo /proxy/...
                const mfpUrl = String(config.mediaFlowProxyUrl || process.env.MFP_URL || '').trim().replace(/\/+$/, '');
                // NOTA: uso ?? per preservare stringhe vuote esplicitamente fornite dall'utente;
                // solo undefined/null attivano il fallback alle env var.
                const mfpPsw = config.mediaFlowProxyPassword ?? process.env.MFP_PSW ?? process.env.MFP_PASSWORD ?? '';

                // Backend del proxy: false/undefined = EasyProxy (default), true = MediaFlow.
                // Quando MediaFlow alcuni endpoint custom non esistono e gli host
                // resolver-based (VixCloud, Mixdrop, Sportsonline, Vavoo) richiedono /extractor/video.m3u8.
                // IMPORTANTE: la config dell'utente prevale sull'ambiente (false esplicito > env var)
                const useMediaFlow = (() => {
                    const userVal = normalizeBool(config.useMediaFlow);
                    if (userVal !== undefined) return userVal;
                    const env = (process.env.PROXY_BACKEND || process.env.MFP_BACKEND || '').toLowerCase();
                    if (env === 'mediaflow' || env === 'mfp') return true;
                    return false;
                })();

                const allStreams: Stream[] = [];
                let _providerConfigSig = ''; // Dichiarato qui per essere in scope nel cache-set finale

                // === LOGICA ANIME/FILM (originale) ===
                // Per tutto il resto, usa solo mediaFlowProxyUrl/mediaFlowProxyPassword
                // Gestione AnimeUnity per ID Kitsu o MAL con fallback variabile ambiente

                // API Mode detection: when config has NO explicit provider settings, assume direct API call
                // Direct API call = curl to /stream/movie/xxx.json without any config
                // User with config (even without MFP) should NOT trigger API mode
                const hasAnyProviderSetting = (() => {
                    const cfg = config as any;
                    const providerKeys = [
                        'animesaturnEnabled', 'animeworldEnabled', 'animeunityEnabled'
                    ];
                    return providerKeys.some(k => cfg[k] !== undefined);
                })();
                const isDirectAPICall = !hasAnyProviderSetting;

                const envFlag = (name: string) => {
                    const v = process.env[name];
                    if (v == null) return undefined;
                    return v.toLowerCase() === 'true';
                };

                const rc = requestConfig as any;
                const animeUnityEnabled = envFlag('ANIMEUNITY_ENABLED') ?? (isDirectAPICall || config.animeunityEnabled === true || rc?.animeunityEnabled === true);
                const animeSaturnEnabled = envFlag('ANIMESATURN_ENABLED') ?? (isDirectAPICall || config.animesaturnEnabled === true || rc?.animesaturnEnabled === true);
                const animeWorldEnabled = envFlag('ANIMEWORLD_ENABLED') ?? (isDirectAPICall || config.animeworldEnabled === true || rc?.animeworldEnabled === true);

                if ((id.startsWith('kitsu:') || id.startsWith('mal:') || id.startsWith('tt') || id.startsWith('tmdb:')) && (animeUnityEnabled || animeSaturnEnabled || animeWorldEnabled)) {
                    // === Rilevamento addonBase PRIMA della cache key ===
                    // Deve essere calcolato prima di effectiveCacheConfig per usare il valore effettivo
                    let auAddonBase = (process?.env?.ADDON_BASE_URL || '').trim();
                    if (!auAddonBase) auAddonBase = (config as any).addonBase || '';
                    const finalAddonBase = auAddonBase || '';

                    // === CACHE KEY CONSTRUCTION ===
                    // Costruita dai valori NORMALIZZATI che vengono realmente passati ai provider.
                    // Include TUTTI i campi che influenzano gli stream restituiti.
                    // Usa SHA-256 per evitare collisioni tra configurazioni diverse.
                    const effectiveCacheConfig = {
                        type: normalizedType,
                        mfpUrl: mfpUrl || '',
                        mfpPswHash: mfpPsw ? createHash('sha256').update(mfpPsw).digest('hex').slice(0, 16) : '',
                        useMediaFlow: useMediaFlow,
                        tmdbKey: config.tmdbApiKey || process.env.TMDB_API_KEY || '',
                        addonBase: finalAddonBase || '',
                        animeunityEnabled: !!animeUnityEnabled,
                        animesaturnEnabled: !!animeSaturnEnabled,
                        animeworldEnabled: !!animeWorldEnabled,
                        animeunityDirect: normalizeBool(config.animeunityDirect),
                        animeunityDirectFhd: normalizeBool(config.animeunityDirectFhd),
                        animeunityProxy: normalizeBool(config.animeunityProxy),
                    };
                    _providerConfigSig = createHash('sha256')
                        .update(JSON.stringify(effectiveCacheConfig))
                        .digest('hex');

                    // Cache check before the expensive fan-out.
                    const _cachedStreams = _providerCacheGet(normalizedType, id, _providerConfigSig);
                    if (_cachedStreams) {
                        debugLog(`⚡ Provider cache HIT for ${normalizedType}/${id} (${_cachedStreams.length} streams)`);
                        return { streams: _cachedStreams };
                    }

                    const tmdbKey = config.tmdbApiKey || process.env.TMDB_API_KEY || '';
                    const defaultTmdbKey = '40a9faa1f6741afb2c0c40238d85f8d0';

                    const animeUnityConfig = {
                        enabled: animeUnityEnabled,
                        mfpUrl: mfpUrl,
                        mfpPassword: mfpPsw,
                        useMediaFlow: useMediaFlow,
                        tmdbApiKey: tmdbKey || defaultTmdbKey,
                        addonBase: finalAddonBase || undefined,
                        animeunityDirect: normalizeBool(config.animeunityDirect),
                        animeunityDirectFhd: normalizeBool(config.animeunityDirectFhd),
                        animeunityProxy: normalizeBool(config.animeunityProxy),
                    } as AnimeUnityConfig;
                    const animeSaturnConfig = {
                        enabled: animeSaturnEnabled,
                        mfpUrl: mfpUrl,
                        mfpPassword: mfpPsw,
                        useMediaFlow: useMediaFlow,
                        mfpProxyUrl: mfpUrl,
                        mfpProxyPassword: mfpPsw,
                        tmdbApiKey: tmdbKey || defaultTmdbKey
                    };
                    const animeWorldConfig = {
                        enabled: animeWorldEnabled,
                        mfpUrl: mfpUrl,
                        mfpPassword: mfpPsw,
                        useMediaFlow: useMediaFlow,
                        tmdbApiKey: tmdbKey || defaultTmdbKey
                    };
                    // Parsing stagione/episodio per IMDB/TMDB
                    let seasonNumber: number | null = null;
                    let episodeNumber: number | null = null;
                    let isMovie = false;
                    if (id.startsWith('tt') || id.startsWith('tmdb:')) {
                        // Esempio: tt1234567:1:2 oppure tmdb:12345:1:2
                        const parts = id.split(':');
                        // IMDB: tt12345 (1 part) = movie, tt12345:S:E (3 parts) = series
                        // TMDB: tmdb:12345 (2 parts) = movie, tmdb:12345:S:E (4 parts) = series
                        if (id.startsWith('tt')) {
                            if (parts.length === 1) {
                                isMovie = true;
                            } else if (parts.length === 2) {
                                episodeNumber = parseInt(parts[1]);
                            } else if (parts.length === 3) {
                                seasonNumber = parseInt(parts[1]);
                                episodeNumber = parseInt(parts[2]);
                            }
                        } else if (id.startsWith('tmdb:')) {
                            if (parts.length === 2) {
                                // tmdb:12345 = movie
                                isMovie = true;
                            } else if (parts.length === 3) {
                                // tmdb:12345:E
                                episodeNumber = parseInt(parts[2]);
                            } else if (parts.length === 4) {
                                // tmdb:12345:S:E
                                seasonNumber = parseInt(parts[2]);
                                episodeNumber = parseInt(parts[3]);
                            }
                        }
                    }
                    const providerPromises: Promise<Stream[]>[] = [];
                    const isAnimeFastRequest = type === 'anime' || id.startsWith('kitsu:') || id.startsWith('mal:');
                    const providerTasks: Record<string, Promise<Stream[]>> = {};

                    // Map legacy streamName label (used for ordering) to internal provider key
                    const reverseProviderKey = (label: string): string => {
                        const l = label.toLowerCase();
                        if (l.includes('anime unity')) return 'animeunity';
                        if (l.includes('anime saturn')) return 'animesaturn';
                        if (l.includes('anime world')) return 'animeworld';
                        return 'generic';
                    };
                    const unifyStreams = (original: Stream[], providerLabelName: string): Stream[] => {
                        const providerKey = reverseProviderKey(providerLabelName);
                        // Pre-scan for canonical base title (vixsrc) excluding synthetic placeholder names
                        let canonicalVixBase: string | null = null;
                        if (providerKey === 'vixsrc') {
                            for (const st of original) {
                                const first = (st.title || '').toString().split('\n')[0];
                                if (first && !/Synthetic FHD|Proxy FHD/i.test(first)) {
                                    canonicalVixBase = first
                                        .replace(/^\s*🎬\s*/, '')
                                        .replace(/\[?(ITA|SUB)\]?/ig, '')
                                        .replace(/🔒|🔓FHD?|🔓/g, '')
                                        .replace(/\s*•\s*/g, ' ')
                                        .replace(/\s{2,}/g, ' ')
                                        .trim();
                                    if (canonicalVixBase) break;
                                }
                            }
                            // Se non trovato (tutte placeholder), prova a prendere originalName dai synthetic
                            if (!canonicalVixBase) {
                                for (const st of original) {
                                    const orig = (st as any).originalName;
                                    if (orig && typeof orig === 'string') { canonicalVixBase = orig; break; }
                                }
                            }
                        }
                        const hostMap: Record<string, string> = {
                            'mixdrop': 'Mixdrop', 'dropload': 'Dropload', 'streamtape': 'Streamtape', 'supervideo': 'SuperVideo', 'doodstream': 'Doodstream', 'deltabit': 'Deltabit', 'delta bit': 'Deltabit', 'loadm': 'LoadM', 'maxstream': 'Maxstream', 'streamhg': 'StreamHG', 'audinifer': 'StreamHG'
                        };
                        return original.map(st => {
                            const url = (st as any).url || '';
                            const rawTitle: string = (st.title || '').toString();
                            const lines = rawTitle.split('\n');
                            let baseLine = lines[0] || '';
                            // Remove duplicated leading icons / tags
                            baseLine = baseLine.replace(/^\s*🎬\s*/, '');
                            for (let i = 0; i < 3; i++) baseLine = baseLine.replace(/^\s*\[[^\]]+\]\s*/, '').trim();
                            // Strip language markers or bullet language artifacts from base line
                            baseLine = baseLine
                                .replace(/\s*[•▪]\s*\[?(ITA|SUB)\]?/ig, '')
                                .replace(/\s*\b(ITA|SUB)\b/ig, '')
                                .replace(/\s*•\s*\[SUB ITA\]/ig, '')
                                .replace(/\s{2,}/g, ' ') // collapse spaces
                                .trim();
                            // Replace synthetic placeholder names with canonical title
                            if (providerKey === 'vixsrc' && /^(Synthetic FHD|Proxy FHD)$/i.test(baseLine)) {
                                if (canonicalVixBase) {
                                    baseLine = canonicalVixBase;
                                } else if ((st as any).originalName) {
                                    baseLine = (st as any).originalName;
                                }
                            }
                            // Extra cleanup for VixSrc: rimuovi eventuali marker lingua / lock rimasti nel baseLine
                            if (providerKey === 'vixsrc') {
                                baseLine = baseLine
                                    .replace(/\[?(ITA|SUB)\]?/ig, '')
                                    .replace(/🔒|🔓FHD?|🔓/g, '')
                                    .replace(/\s*•\s*/g, ' ')
                                    .replace(/\s{2,}/g, ' ')
                                    .trim();
                            }
                            // Cleanup universale aggiuntivo: rimuovi eventuali [ITA]/[SUB] residui attaccati senza spazio e lock icon per qualsiasi provider
                            baseLine = baseLine
                                .replace(/\[ITA\]/ig, '')
                                .replace(/\[SUB\]/ig, '')
                                .replace(/🔒|🔓FHD?|🔓/g, '')
                                .replace(/\s{2,}/g, ' ')
                                .replace(/\s+$/, '')
                                .trim();
                            // Language detection (from whole raw title)
                            const isSub = /\bsub\b|\[sub\]/i.test(rawTitle);
                            // Proxy detection (broadened):
                            //  - /proxy/ path segment
                            //  - presence of api_password= (MediaFlow proxy wrapper)
                            //  - extractor/video path (our mfp encapsulation pattern)
                            //  - behaviorHints.proxyHeaders flag
                            const proxyOn = /\/proxy\//i.test(url)
                                || /api_password=/i.test(url)
                                || /extractor\/video/i.test(url);
                            // Player host detection (not for vixsrc)
                            let playerName: string | undefined;
                            let sizeHuman: string | undefined; // already formatted (e.g. 1.58Gb / 850MB)
                            let resHuman: string | undefined;  // e.g. 1080p
                            if (providerKey !== 'vixsrc') {
                                const lowerAll = rawTitle.toLowerCase();
                                for (const k of Object.keys(hostMap)) {
                                    if (lowerAll.includes(k)) { playerName = hostMap[k]; break; }
                                }
                                // Try to preserve existing player name line if not found
                                if (!playerName) {
                                    for (const l of lines) {
                                        if (l.includes('▶️')) {
                                            playerName = l.replace('▶️', '').trim();
                                            break;
                                        }
                                    }
                                }
                                // Try to parse existing size/res lines produced by extractors (line starting with 💾)
                                // Patterns we expect from extractors: "💾 <SIZE> • <RES>", "💾 <SIZE>", "💾 <SIZE> • <somethingp>", or combined tokens separated by spaces or bullets.
                                for (const l of lines) {
                                    if (/^\s*💾/i.test(l)) {
                                        // Remove leading icon
                                        let rest = l.replace(/^\s*💾\s*/, '').trim();
                                        // Split by separators (bullet • or whitespace)
                                        const parts = rest.split(/\s*[•|]\s*|\s+/).filter(Boolean);
                                        // Heuristics: first part maybe size (contains MB/GB), any part matching \d{3,4}p is resolution
                                        for (const p of parts) {
                                            if (!sizeHuman && /([0-9]+(?:\.[0-9]+)?\s*(?:GB|MB))/i.test(p)) sizeHuman = p.replace(/gb$/i, 'GB').replace(/mb$/i, 'MB');
                                            if (!resHuman && /^(\d{3,4})p$/i.test(p)) resHuman = p.toLowerCase();
                                        }
                                    }
                                }
                            }
                            // If resolution appears split like "1080p" inside raw title second line without 💾, catch it
                            if (!resHuman) {
                                const m = rawTitle.match(/\b(\d{3,4})p\b/);
                                if (m) resHuman = m[1] + 'p';
                            }
                            // HD flag ONLY if synthetic flag propagated
                            const isSynthetic = !!(st as any).isSyntheticFhd;
                            const isFhdOrDual = providerKey === 'vixsrc' && isSynthetic;
                            // Assemble lines manually per new spec:
                            // 1 Title (🎬 prefix added later by builder or we add manually)
                            // 2 Language line 🗣 [ITA|SUB]
                            // 3 Player line ▶️ <Player> (if any)
                            // 4 Size/Res line (💾 <SIZE> 🎦 <RES> | only if at least one present)
                            // 5 Proxy line 🌐 Proxy (ON|OFF)
                            // (Provider label removed from multiline)
                            const outLines: string[] = [];
                            outLines.push(`🎬 ${baseLine}`);
                            // Language line: per VixSrc, preserva la riga 🗣 originale (contiene flag 🇮🇹/🇬🇧 da finalize).
                            // Per gli altri provider, usa la logica legacy [ITA]/[SUB].
                            let langLine = `🗣 [${isSub ? 'SUB' : 'ITA'}]`;
                            if (providerKey === 'vixsrc') {
                                const existingLangLine = lines.find(l => /^🗣\s/.test(l));
                                if (existingLangLine) langLine = existingLangLine;
                            }
                            outLines.push(langLine);
                            // VixSrc: preserva la riga 🎦 originale da finalize() (es. 🎦 🅵🅷🅳 o 🎦 1080p)
                            if (providerKey === 'vixsrc') {
                                const existingQualityLine = lines.find(l => /^🎦\s/.test(l));
                                if (existingQualityLine) outLines.push(existingQualityLine);
                            }
                            if (playerName) outLines.push(`▶️ ${playerName}`);
                            // Build size/res combined line before proxy if present
                            let sizeResLine = '';
                            if (sizeHuman || resHuman) {
                                if (sizeHuman && resHuman) {
                                    sizeResLine = `💾 ${sizeHuman.replace(/B$/, 'B')} 🎦 ${resHuman}`;
                                } else if (sizeHuman) {
                                    sizeResLine = `💾 ${sizeHuman.replace(/B$/, 'B')}`;
                                } else if (resHuman) {
                                    sizeResLine = `🎦 ${resHuman}`; // resolution only
                                }
                            }
                            if (sizeResLine) outLines.push(sizeResLine);
                            outLines.push(`🌐 Proxy (${proxyOn ? 'ON' : 'OFF'})`);
                            const unifiedTitle = outLines.join('\n');
                            // ---------------- BINGE GROUP LOGIC (CUSTOM MAP) ----------------
                            // animeunity/animeworld/animesaturn: std-ita | std-sub
                            // vixsrc: direct | directFHD | proxy | proxyFHD
                            // Altri provider (fallback): providerKey-std
                            let bingeGroup: string;
                            if (providerKey === 'vixsrc') {
                                // Manteniamo la logica esistente per le 4 varianti
                                let variant = 'base';
                                const isFhdVariant = isSynthetic || /FHD/i.test(rawTitle) || /1080p/i.test(rawTitle);
                                if (isFhdVariant) variant = proxyOn ? 'proxyFHD' : 'directFHD';
                                else variant = proxyOn ? 'proxy' : 'direct';
                                bingeGroup = `${providerKey}-${variant}`;
                            } else {
                                switch (providerKey) {
                                    case 'animeunity':
                                    case 'animeworld':
                                    case 'animesaturn':
                                        bingeGroup = `${providerKey}-std-${isSub ? 'sub' : 'ita'}`;
                                        break;
                                    default:
                                        bingeGroup = `${providerKey}-std`;
                                }
                            }
                            const existingHints = (st as any).behaviorHints || {};
                            const mergedHints = { ...existingHints, bingeGroup };
                            return { ...st, title: unifiedTitle, name: providerLabel(providerKey, isFhdOrDual), behaviorHints: mergedHints } as Stream;
                        });
                    };
                    const runProvider = async (name: string, enabled: boolean, handler: () => Promise<{ streams: Stream[] }>, streamName: string, isMixdropSensitive = false, timeoutMs: number | null = null): Promise<Stream[]> => {
                        if (!enabled) return [];
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
                                const prepared = result.streams.map(s => {
                                    if (isMixdropSensitive) {
                                        const isMixdrop = s.title ? /\b(mixdrop|streamtape)\b/i.test(s.title) : false;
                                        return { ...s, name: isMixdrop ? streamName.replace(' 🔓', '') : streamName } as Stream;
                                    }
                                    return { ...s, name: streamName } as Stream;
                                });
                                return unifyStreams(prepared, streamName);
                            }
                        } catch (error) {
                            console.error(`🚨 ${name} error:`, error);
                        }
                        return [];
                    };
                    const scheduleProviderRun = async (
                        name: string,
                        enabled: boolean,
                        handler: () => Promise<{ streams: Stream[] }>,
                        streamName: string,
                        isMixdropSensitive = false,
                        timeoutMs: number | null = null
                    ): Promise<void> => {
                        const providerKey = reverseProviderKey(streamName);
                        const task = runProvider(name, enabled, handler, streamName, isMixdropSensitive, timeoutMs);
                        if (!providerTasks[providerKey]) providerTasks[providerKey] = task;
                        providerPromises.push(task);
                    };
                    const getFastPriority = (): string[] => {
                        if (isAnimeFastRequest) return ['animeunity', 'animeworld', 'animesaturn'];
                        return [];
                    };
                    // AnimeUnity
                    scheduleProviderRun('AnimeUnity', animeUnityEnabled, async () => {
                        const animeUnityProvider = new AnimeUnityProvider(animeUnityConfig);
                        let res;
                        if (id.startsWith('kitsu:')) res = await animeUnityProvider.handleKitsuRequest(id);
                        else if (id.startsWith('mal:')) res = await animeUnityProvider.handleMalRequest(id);
                        else if (id.startsWith('tt')) res = await animeUnityProvider.handleImdbRequest(id, seasonNumber, episodeNumber, isMovie);
                        else if (id.startsWith('tmdb:')) res = await animeUnityProvider.handleTmdbRequest(id.replace('tmdb:', ''), seasonNumber, episodeNumber, isMovie);
                        else res = { streams: [] };
                        // Uniforma pattern VixSrc: non manipolare multi-line title qui; providerLabel userà isSyntheticFhd
                        return res;
                    }, providerLabel('animeunity'), false, 30000);  // AnimeUnity: timeout 30s

                    // AnimeSaturn
                    scheduleProviderRun('AnimeSaturn', animeSaturnEnabled, async () => {
                        const { AnimeSaturnProvider } = await import('./providers/animesaturn-provider');
                        const animeSaturnProvider = new AnimeSaturnProvider(animeSaturnConfig);
                        if (id.startsWith('kitsu:')) return animeSaturnProvider.handleKitsuRequest(id);
                        if (id.startsWith('mal:')) return animeSaturnProvider.handleMalRequest(id);
                        if (id.startsWith('tt')) return animeSaturnProvider.handleImdbRequest(id, seasonNumber, episodeNumber, isMovie);
                        if (id.startsWith('tmdb:')) return animeSaturnProvider.handleTmdbRequest(id.replace('tmdb:', ''), seasonNumber, episodeNumber, isMovie);
                        return { streams: [] };
                    }, providerLabel('animesaturn'), false, 30000);  // AnimeSaturn: timeout 30s

                    // AnimeWorld
                    scheduleProviderRun('AnimeWorld', animeWorldEnabled, async () => {
                        const { AnimeWorldProvider } = await import('./providers/animeworld-provider');
                        const animeWorldProvider = new AnimeWorldProvider(animeWorldConfig);
                        if (id.startsWith('kitsu:')) return animeWorldProvider.handleKitsuRequest(id);
                        if (id.startsWith('mal:')) return animeWorldProvider.handleMalRequest(id);
                        if (id.startsWith('tt')) return animeWorldProvider.handleImdbRequest(id, seasonNumber, episodeNumber, isMovie);
                        if (id.startsWith('tmdb:')) return animeWorldProvider.handleTmdbRequest(id.replace('tmdb:', ''), seasonNumber, episodeNumber, isMovie);
                        return { streams: [] };
                    }, providerLabel('animeworld'), false, 30000);  // AnimeWorld: timeout 30s

                    const allProviderResults = await Promise.all(providerPromises);
                    for (const group of allProviderResults) {
                        for (const s of group) allStreams.push(s);
                    }

                    // Post-process AnimeUnity streams to apply FHD badge similarly to VixSrc
                    try {
                        let auAdjusted = 0;
                        for (const s of allStreams) {
                            const lowerName = (s.name || s.title || '').toLowerCase();
                            if (lowerName.includes('anime unity')) {
                                const isFhd = !!((s as any).isSyntheticFhd || s.behaviorHints?.animeunityQuality === 'FHD' || /fhd/.test(s.title || ''));
                                const before = s.name;
                                s.name = providerLabel('animeunity', isFhd);
                                if (isFhd) auAdjusted++;
                                if (isFhd) {
                                    try { console.log('[AnimeUnity][LabelPass] Marked FHD stream name:', before, '->', s.name); } catch { }
                                }
                            }
                        }
                        if (auAdjusted) console.log(`[AnimeUnity][LabelPass] FHD badge applied to ${auAdjusted} stream(s)`);
                        else console.log('[AnimeUnity][LabelPass] Nessun stream FHD marcato (controllare estrazione variante)');
                    } catch (e) {
                        console.warn('[AnimeUnity][LabelPass] errore post-process badge FHD:', (e as any)?.message || e);
                    }

                }

                // === ORDINAMENTO STREAM PER PRIORITÀ ===
                // Applica ordinamento priorità (prima di ordinamento provider)
                try {
                    if (allStreams.length > 1) {
                        sortStreamsByPriority(allStreams);
                        debugLog(`[StaticStreams] Stream ordinati per priorità: ${allStreams.length} totali`);
                    }
                } catch (sortErr) {
                    debugLog(`[StaticStreams] Errore ordinamento:`, String((sortErr as any)?.message || sortErr));
                }
                // Global provider ordering - per serie/film
                try {
                    const rank = (n: string): number => {
                        const l = n.toLowerCase();
                        if (l.includes('anime unity')) return 1;
                        if (l.includes('anime saturn')) return 2;
                        if (l.includes('anime world')) return 3;
                        return 50;
                    };
                    // Ordina per provider (movie/series mantengono ordinamento provider)
                    {
                        allStreams.sort((a, b) => rank((a.name || a.title || '').toString()) - rank((b.name || b.title || '').toString()));
                    }
                } catch { }

                console.log(`✅ Total streams returned: ${allStreams.length}`);
                // Cache the fan-out result for repeat plays. Only the
                // imdb/tmdb/kitsu/mal id branch reaches here with a non-empty
                // _providerConfigSig; tv:* ids have their own short-circuits
                // above so _providerConfigSig isn't always in scope — guard.
                if (typeof _providerConfigSig === 'string' && (id.startsWith('tt') || id.startsWith('tmdb:') || id.startsWith('kitsu:') || id.startsWith('mal:'))) {
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

// Server Express (minimale — usato da VixSynthetic in SF19b)
const app = express();

// Endpoint sintetico: genera mini-master con sola variante video massima e traccia AUDIO italiana
// Supporta sia /vixsynthetic che /vixsynthetic.m3u8 per compatibilità player

// SSRF protection: whitelist di domini autorizzati
const ALLOWED_VIXSYNTHETIC_HOSTS = new Set([
    'vixsrc.to', 'vixcloud.cc', 'vixcloud.co',
    'mixdrop.to', 'mixdrop.co', 'mixdrop.si',
    'streamtape.com', 'doodstream.com', 'dood.to',
    'streamhg.com', 'maxstream.org', 'maxstream.xyz',
    'supervideo.tv', 'loadm.net', 'dropload.cc',
    'audinifer.com', 'deltabit.net', 'deltabit.xyz',
]);

function isAllowedHost(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    // Accetta se è nella whitelist esatta o è un sottodominio
    for (const allowed of ALLOWED_VIXSYNTHETIC_HOSTS) {
        if (host === allowed || host.endsWith(`.${allowed}`)) return true;
    }
    return false;
}

// Proxy host autorizzati via variabile d'ambiente (es. ALLOWED_PROXY_HOSTS=proxy1.example.com,proxy2.example.com)
const ALLOWED_PROXY_HOSTS = new Set(
    String(process.env.ALLOWED_PROXY_HOSTS || '')
        .split(',')
        .map((host: string) => host.trim().toLowerCase())
        .filter(Boolean)
);

/**
 * Verifica se un URL è una destinazione sicura:
 * - protocollo HTTPS
 * - nessuna credenziale nell'URL
 * - host nella whitelist principale OPPURE in ALLOWED_PROXY_HOSTS
 */
/**
 * Verifica che l'hostname sia un IP privato/loopback (senza risoluzione DNS).
 * Utile per controlli rapidi prima di fare lookup DNS.
 */
function isPrivateHostname(hostname: string): boolean {
    const h = hostname.toLowerCase();
    return /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|\[::1\]|\[::\]|\[::ffff:127\.0\.0\.1\])$/i.test(h)
        || /^\[(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\]$/.test(h) // ::1 compressed
        || /^\[(?:[0-9a-fA-F]{1,4}:){1,7}:\]$/.test(h);
}

/**
 * Verifica che un indirizzo IP non sia privato/loopback/link-local.
 * Chiamare dopo la risoluzione DNS per prevenire SSRF via DNS.
 * Gestisce IPv4, IPv6 puro e IPv4-mapped IPv6 (forma decimale ed esadecimale).
 */
function isIpSafe(ip: string): boolean {
    let raw = ip.toLowerCase().trim();

    // ── IPv4-mapped/compat: ::ffff:a.b.c.d  (decimale) ──
    let asIPv4: string | null = null;

    const decMapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (decMapped) {
        asIPv4 = decMapped[1];
    }

    // ── IPv4-mapped in forma esadecimale ::ffff:x:x ──
    // Esempio: ::ffff:ac10:1  →  172.16.0.1
    if (!asIPv4) {
        const parts6 = expandIPv6(raw);
        if (parts6) {
            const words = parts6.map(s => parseInt(s, 16));

            // Riconosci ::ffff:a:b (5 zeri + ffff + 2 parole IPv4)
            const isMapped =
                words.slice(0, 5).every(n => n === 0) &&
                words[5] === 0xffff;

            if (isMapped) {
                // Estrai i 4 byte dall'ultimo segmento a 16 bit
                const ipv4 = [
                    words[6] >>> 8,
                    words[6] & 0xff,
                    words[7] >>> 8,
                    words[7] & 0xff,
                ].join('.');
                asIPv4 = ipv4;
            }
        }
    }

    if (asIPv4) {
        return !isPrivateIPv4(asIPv4);
    }

    // ── IPv4 puro ──
    if (/^\d+\.\d+\.\d+\.\d+$/.test(raw)) {
        return !isPrivateIPv4(raw);
    }

    // ── IPv6 puro ──
    const parts6 = expandIPv6(raw);
    if (!parts6) return false;

    const words = parts6.map(s => parseInt(s, 16));

    // Unspecified ::
    if (words.every(n => n === 0)) return false;

    // Loopback ::1
    if (words.slice(0, 7).every(n => n === 0) && words[7] === 1) return false;

    const first = words[0];

    // Link-local fe80::/10  (maschera 0xffc0 == 0xfe80)
    if ((first & 0xffc0) === 0xfe80) return false;

    // Unique local fc00::/7  (maschera 0xfe00 == 0xfc00)
    if ((first & 0xfe00) === 0xfc00) return false;

    // Multicast ff00::/8
    if ((first & 0xff00) === 0xff00) return false;

    // Reserved / undocumented — blocca tutto il resto non classificato come global unicast
    // Global unicast inizia da 2000::/3 (primi 3 bit = 001)
    // Se i primi 3 bit non sono 001, è riservato
    if ((first & 0xe000) !== 0x2000) return false;

    return true;
}

/**
 * Espande un indirizzo IPv6 nella sua forma completa (8 segmenti hex a 4 cifre).
 * Restituisce null se il formato non è valido (doppio ::, segmenti non hex, ecc.).
 */
function expandIPv6(addr: string): string[] | null {
    const a = addr.toLowerCase().replace(/\[|\]/g, '');

    // Blocca :::: (triplice) e doppi :: (es. 1::2::3)
    if (a.includes(':::')) return null;
    if ((a.indexOf('::') !== -1 && a.indexOf('::', a.indexOf('::') + 2) !== -1)) {
        return null;
    }

    // Gestione di ::
    if (a.includes('::')) {
        const idx = a.indexOf('::');
        const left = idx > 0 ? a.slice(0, idx).split(':').filter(Boolean) : [];
        const right = idx + 2 < a.length ? a.slice(idx + 2).split(':').filter(Boolean) : [];
        const missing = 8 - left.length - right.length;
        // :: deve comprimere almeno un segmento (missing >= 1)
        if (missing <= 0) return null;
        // Valida tutti i segmenti prima di restituire
        const all = [...left, ...right];
        for (const s of all) {
            if (!/^[0-9a-f]{1,4}$/.test(s)) return null;
        }
        return [...left, ...Array(missing).fill('0').map(z => z.padStart(4, '0')), ...right];
    }

    const segs = a.split(':');
    if (segs.length !== 8) return null;
    for (const s of segs) {
        if (!/^[0-9a-f]{1,4}$/.test(s)) return null;
    }
    return segs.map(s => s.padStart(4, '0'));
}

/**
 * Restituisce true se l'IPv4 è privato/riservato.
 */
function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.some(n => isNaN(n) || n < 0 || n > 255)) return true; // invalido → blocca

    if (parts[0] === 0) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    if (parts[0] >= 240) return true;
    // CGNAT 100.64.0.0/10 (100.64.0.0 – 100.127.255.255)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
}

/**
 * Risultato della verifica DNS: sicurezza + indirizzi risolti.
 */
interface DnsSafetyResult {
    safe: boolean;
    addresses: any[];
}

/**
 * Risolve l'hostname in indirizzi IP e verifica che tutti siano pubblici.
 * Ritorna { safe: true, addresses } se tutti gli IP sono validi.
 * Ritorna { safe: false, addresses: [] } se qualche IP è privato o la risoluzione fallisce.
 * L'abortSignal interrompe l'attesa se il timeout scade.
 */
async function verifyDnsSafety(
    hostname: string,
    abortSignal?: AbortSignal
): Promise<DnsSafetyResult> {
    try {
        // Controlla abort PRIMA di avviare il lookup
        if (abortSignal?.aborted) {
            return { safe: false, addresses: [] };
        }

        const dns = await import('dns');

        // Ricontrolla abort dopo l'import (potrebbe essere scattato durante)
        if (abortSignal?.aborted) {
            return { safe: false, addresses: [] };
        }

        return new Promise<DnsSafetyResult>((resolve) => {
            const promise = dns.promises.lookup(hostname, { all: true });

            // Listener abort: si rimuove da solo al completamento
            const onAbort = () => {
                abortSignal?.removeEventListener('abort', onAbort);
                resolve({ safe: false, addresses: [] });
            };

            if (abortSignal) {
                abortSignal.addEventListener('abort', onAbort);
                // Cleanup: rimuovi listener al completamento
                promise.then(
                    () => abortSignal.removeEventListener('abort', onAbort),
                    () => abortSignal.removeEventListener('abort', onAbort)
                );
            }

            promise
                .then((addresses: any[]) => {
                    // Nessun indirizzo risolto → consideriamo insicuro
                    if (!addresses || addresses.length === 0) {
                        resolve({ safe: false, addresses: [] });
                        return;
                    }
                    // Tutti gli IP risolti devono essere pubblici
                    const allSafe = addresses.every((addr: any) => isIpSafe(addr.address));
                    resolve(allSafe ? { safe: true, addresses } : { safe: false, addresses: [] });
                })
                .catch(() => {
                    // Errore DNS → insicuro (non autorizziamo per default)
                    resolve({ safe: false, addresses: [] });
                });
        });
    } catch {
        // dns module non disponibile → insicuro
        return { safe: false, addresses: [] };
    }
}

function isAllowedDestination(url: URL): boolean {
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (isAllowedHost(url)) return true;
    return ALLOWED_PROXY_HOSTS.has(host);
}

app.get(['/vixsynthetic', '/vixsynthetic.m3u8'], async (req: Request, res: Response) => {
    try {
        const src = typeof req.query.src === 'string' ? req.query.src : '';
        if (!src) return res.status(400).send('#EXTM3U\n# Missing src');

        // SSRF PROTECTION: valida la destinazione prima di fare la richiesta
        let parsedSrc: URL;
        try {
            parsedSrc = new URL(src);
        } catch {
            return res.status(400).send('#EXTM3U\n# Invalid URL');
        }

        // Blocca schemi non-HTTPS
        if (parsedSrc.protocol !== 'https:') {
            return res.status(403).send('#EXTM3U\n# Only HTTPS allowed');
        }

        // Blocca IP privati/loopback prima della risoluzione DNS
        const hostname = parsedSrc.hostname;
        if (/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|\[::1\]|\[::\]|\[::ffff:127\.0\.0\.1\])$/i.test(hostname)) {
            return res.status(403).send('#EXTM3U\n# Localhost access denied');
        }

        // Verifica whitelist domini + protocollo + nessuna credenziale
        if (!isAllowedDestination(parsedSrc)) {
            return res.status(403).send('#EXTM3U\n# Destination not allowed');
        }

        // Timeout + SSRF redirect protection con AbortController
        // CREATO PRIMA del primo DNS lookup: copre tutta l'operazione
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);

        // Verifica DNS: risolvi l'hostname e controlla che gli IP non siano privati
        const dnsResult = await verifyDnsSafety(hostname, controller.signal);
        if (!dnsResult.safe) {
            clearTimeout(timer);
            if (controller.signal.aborted) {
                return res.status(504).send('#EXTM3U\n# Timeout');
            }
            return res.status(403).send('#EXTM3U\n# DNS destination rejected');
        }

        const langPref = ((req.query.lang as string) || 'it').toLowerCase();
        const multiFlag = (() => {
            const m = String(req.query.multi || '').toLowerCase();
            if (['1', 'true', 'on', 'yes', 'all'].includes(m)) return true;
            if (String(req.query.languages || '').toLowerCase() === 'all') return true;
            return false;
        })();
        if (multiFlag) console.log('[vixsynthetic] multi-language mode attivo');
        // Rileva se src è già un URL proxato (EasyProxy/MFP) — non servono header VixSrc
        const isProxiedSrc = /proxy\/hls|mediaflow/i.test(src) && !/vixsrc\.to/i.test(parsedSrc.hostname);
        const fetchHeaders = isProxiedSrc
            ? { 'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, */*' }
            : { 'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, */*', 'Referer': 'https://vixsrc.to/', 'Origin': 'https://vixsrc.to' };
        if (isProxiedSrc) console.log('[vixsynthetic] src è URL proxato, skip header VixSrc');

        // Crea un https.Agent con lookup vincolato agli IP verificati.
        // La funzione lookup restituisce SOLO gli indirizzi pre-verificati,
        // impedendo al DNS di risolvere un IP diverso (DNS rebinding).
        // L'hostname originale viene passato a hostname per TLS SNI.
        function makePinnedAgent(host: string, addresses: any[]): any {
            if (!addresses || addresses.length === 0) {
                throw new Error(`[vixsynthetic] No validated addresses for ${host}`);
            }
            const https = require('https');
            return new https.Agent({
                lookup: (hostname: string, options: any, callback: any) => {
                    // Verifica che la richiesta sia per l'hostname atteso (SNI)
                    if (hostname.toLowerCase() !== host.toLowerCase()) {
                        return callback(new Error(`[vixsynthetic] Unexpected lookup hostname: ${hostname} (expected ${host})`));
                    }

                    const family =
                        typeof options === 'number'
                            ? options
                            : options?.family ?? 0;

                    const candidates = addresses.filter(
                        (a: any) => !family || a.family === family
                    );

                    if (candidates.length === 0) {
                        return callback(new Error(`[vixsynthetic] No validated address for family ${family}`));
                    }

                    console.log(`[vixsynthetic] DNS bind: ${host} → ${candidates.map((a: any) => a.address).join(', ')} (SNI: ${host})`);

                    // Node richiede formati diversi a seconda di options.all
                    if (typeof options === 'object' && options?.all) {
                        return callback(null, candidates);
                    }

                    const selected = candidates[0];
                    return callback(null, selected.address, selected.family);
                },
            });
        }

        // Agent per la destinazione iniziale
        let currentAgent = makePinnedAgent(parsedSrc.hostname, dnsResult.addresses);

        let redirectCount = 0;
        const MAX_REDIRECTS = 5;
        let currentUrl = src;
        let r: fetchMod.Response;
        let upstreamBase = src;
        let text = '';
        try {
            while (true) {
                const response = await fetchMod(currentUrl, {
                    headers: fetchHeaders as any,
                    signal: controller.signal as any,
                    redirect: 'manual',
                    size: 2 * 1024 * 1024,
                    agent: currentAgent,
                }) as fetchMod.Response;

                // Se redirect, valida la nuova destinazione PRIMA di seguirla
                if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
                    redirectCount++;
                    if (redirectCount > MAX_REDIRECTS) {
                        (response.body as any)?.destroy?.();
                        clearTimeout(timer);
                        return res.status(400).send('#EXTM3U\n# Too many redirects');
                    }
                    const location = response.headers.get('location')!;
                    try {
                        const redirectUrl = new URL(location, currentUrl).toString();
                        const redirectParsed = new URL(redirectUrl);

                        // Blocca IP privati anche nei redirect
                        const redirectHost = redirectParsed.hostname;
                        if (/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|\[::1\]|\[::\]|\[::ffff:127\.0\.0\.1\])$/i.test(redirectHost)) {
                            (response.body as any)?.destroy?.();
                            clearTimeout(timer);
                            return res.status(403).send('#EXTM3U\n# Localhost access denied on redirect');
                        }

                        // Verifica whitelist anche sui redirect (protocollo + credenziali + host)
                        if (!isAllowedDestination(redirectParsed)) {
                            (response.body as any)?.destroy?.();
                            clearTimeout(timer);
                            return res.status(403).send('#EXTM3U\n# Redirect destination not allowed');
                        }

                        // Verifica DNS anche sulla nuova destinazione del redirect
                        const redirectDns = await verifyDnsSafety(redirectParsed.hostname, controller.signal);
                        if (!redirectDns.safe) {
                            (response.body as any)?.destroy?.();
                            clearTimeout(timer);
                            if (controller.signal.aborted) {
                                return res.status(504).send('#EXTM3U\n# Timeout');
                            }
                            return res.status(403).send('#EXTM3U\n# Redirect DNS destination rejected');
                        }

                        // Ricrea l'agent con gli IP verificati per il nuovo hostname
                        currentAgent = makePinnedAgent(redirectParsed.hostname, redirectDns.addresses);
                        currentUrl = redirectUrl;
                        // node-fetch v2 body è un Stream, non ReadableStream
                        (response.body as any)?.destroy?.();
                        continue;
                    } catch {
                        (response.body as any)?.destroy?.();
                        clearTimeout(timer);
                        return res.status(400).send('#EXTM3U\n# Invalid redirect URL');
                    }
                }

                r = response;
                // Traccia l'URL effettivo (dopo eventuali redirect) come base per le URI relative
                upstreamBase = (r as any).url || currentUrl;
                break;
            }

            if (!r.ok) {
                clearTimeout(timer);
                return res.status(502).send('#EXTM3U\n# Upstream error');
            }

            text = await r.text();
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                return res.status(504).send('#EXTM3U\n# Timeout');
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }

        // Se non è master, riscrivi tutte le URI relative (sia in attributi che righe nude)
        if (!/#EXT-X-STREAM-INF:/i.test(text)) {
            const rewritten = text.split(/\r?\n/).map((line: string) => {
                const trimmed = line.trim();
                if (!trimmed) return line;
                // Righe non-comment: sono URI di segmenti
                if (!trimmed.startsWith('#')) {
                    try {
                        return new URL(trimmed, upstreamBase).toString();
                    } catch {
                        return line;
                    }
                }
                // Attributi URI="..." nelle righe commentate
                return line.replace(/\bURI="([^"]+)"/g, (_match: string, uri: string) => {
                    try {
                        return `URI="${new URL(uri, upstreamBase).toString()}"`;
                    } catch {
                        return `URI="${uri}"`;
                    }
                });
            }).join('\n');
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(rewritten);
        }
        const lines = text.split(/\r?\n/);
        interface Variant { url: string; height: number; bandwidth: number; info: string; };
        const variants: Variant[] = [];
        const media: { line: string; attrs: Record<string, string>; }[] = [];
        const parseAttrs = (l: string): Record<string, string> => {
            const out: Record<string, string> = {}; l.replace(/([A-Z0-9-]+)=(("[^"]+")|([^,]+))/g, (_m, k, v) => { const val = String(v).replace(/^"|"$/g, ''); out[k] = val; return ''; }); return out;
        };
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (l.startsWith('#EXT-X-MEDIA:')) {
                media.push({ line: l, attrs: parseAttrs(l) });
            }
            if (l.startsWith('#EXT-X-STREAM-INF:')) {
                const info = l;
                const next = lines[i + 1] || '';
                if (!next || next.startsWith('#')) continue;
                const attrs = parseAttrs(info);
                let h = 0; let bw = 0;
                if (attrs['RESOLUTION']) {
                    const m = attrs['RESOLUTION'].match(/(\d+)x(\d+)/); if (m) h = parseInt(m[2], 10) || 0;
                }
                if (attrs['BANDWIDTH']) bw = parseInt(attrs['BANDWIDTH'], 10) || 0;
                // Resolve relative URI rispetto all'upstream (dopo redirect)
                let vUrl = next.trim();
                try { vUrl = new URL(vUrl, upstreamBase).toString(); } catch { }
                variants.push({ url: vUrl, height: h, bandwidth: bw, info });
            }
        }
        if (!variants.length) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(text);
        }
        variants.sort((a, b) => (b.height - a.height) || (b.bandwidth - a.bandwidth));
        const best = variants[0];
        // Fix: per URL proxati, le rendition video usano segment.ts (proxy raw bytes)
        // ma servono manifest.m3u8 (che riscrive gli URL dei segmenti interni)
        if (isProxiedSrc && best.url.includes('/proxy/hls/segment.ts?')) {
            best.url = best.url.replace('/proxy/hls/segment.ts?', '/proxy/hls/manifest.m3u8?');
            console.log('[vixsynthetic] Fix rendition URL: segment.ts → manifest.m3u8');
        }
        const header: string[] = ['#EXTM3U'];
        // FIX: Preserva #EXT-X-VERSION con il numero (es. #EXT-X-VERSION:6)
        // e #EXT-X-INDEPENDENT-SEGMENTS come riga intera, non come tag nudo
        for (const line of lines) {
            if (line.startsWith('#EXT-X-VERSION:') || line === '#EXT-X-INDEPENDENT-SEGMENTS') {
                header.push(line);
            }
        }

        // Helper: risolve URI relativi nelle righe #EXT-X-MEDIA rispetto alla playlist upstream
        function resolveMediaUri(mediaLine: string, upstreamBase: string): string {
            return mediaLine.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
                try {
                    const resolved = new URL(uri, upstreamBase).toString();
                    return `URI="${resolved}"`;
                } catch {
                    return `URI="${uri}"`;
                }
            });
        }

        // Estrai i GROUP-ID AUDIO e SUBTITLES references dalla variante best (se presenti)
        const bestAttrs = parseAttrs(best.info);
        const bestAudioGroupId = bestAttrs['AUDIO'] || null;
        const bestSubtitleGroupId = bestAttrs['SUBTITLES'] || null;

        // Separa audio e sottotitoli per il GROUP-ID della variante best
        const relevantAudio = bestAudioGroupId
            ? media.filter(m =>
                (m.attrs['TYPE'] || '').toUpperCase() === 'AUDIO' &&
                m.attrs['GROUP-ID'] === bestAudioGroupId
            )
            : [];

        const relevantSubtitles = bestSubtitleGroupId
            ? media.filter(m =>
                (m.attrs['TYPE'] || '').toUpperCase() === 'SUBTITLES' &&
                m.attrs['GROUP-ID'] === bestSubtitleGroupId
            )
            : [];

        // Verifica che i gruppi referenziati dalla variante esistano realmente
        // Se un gruppo è referenziato ma non trovato, il master è incoerente → rifiuta
        if ((bestAudioGroupId && relevantAudio.length === 0) ||
            (bestSubtitleGroupId && relevantSubtitles.length === 0)) {
            const missing: string[] = [];
            if (bestAudioGroupId && relevantAudio.length === 0) missing.push(`AUDIO="${bestAudioGroupId}"`);
            if (bestSubtitleGroupId && relevantSubtitles.length === 0) missing.push(`SUBTITLES="${bestSubtitleGroupId}"`);
            return res.status(502).send(`#EXTM3U\n# Invalid upstream rendition groups: ${missing.join(', ')}`);
        }

        if (multiFlag) {
            // In modalità multi includiamo tutte le righe #EXT-X-MEDIA (AUDIO e SUBTITLES) del gruppo corretto
            // e manteniamo i GROUP-ID originali della variante. Risolviamo gli URI relativi.
            const audioGroupsEncountered: Set<string> = new Set();
            const subtitleGroupsEncountered: Set<string> = new Set();
            for (const m of [...relevantAudio, ...relevantSubtitles]) {
                const type = (m.attrs['TYPE'] || '').toUpperCase();
                const resolvedLine = resolveMediaUri(m.line, upstreamBase);
                if (type === 'AUDIO') {
                    header.push(resolvedLine);
                    if (m.attrs['GROUP-ID']) audioGroupsEncountered.add(m.attrs['GROUP-ID']);
                } else if (type === 'SUBTITLES') {
                    header.push(resolvedLine);
                    if (m.attrs['GROUP-ID']) subtitleGroupsEncountered.add(m.attrs['GROUP-ID']);
                }
            }
            // Mantieni i GROUP-ID originali della variante best
            let streamInf = best.info;
            header.push(streamInf);
            header.push(best.url);
        } else {
            // Modalità singola (compatibile precedente): seleziona solo la traccia audio richiesta (langPref)
            // Cerca SOLO nel GROUP-ID della variante best (se specificato)
            let chosenGroup: string | null = null;
            let chosenMediaLine: string | null = null;

            if (relevantAudio.length > 0) {
                // Cerca traccia con lingua preferita nel gruppo corretto
                const found = relevantAudio.find(m => {
                    const lang = (m.attrs['LANGUAGE'] || '').toLowerCase();
                    const name = (m.attrs['NAME'] || '').toLowerCase();
                    return lang === langPref || name.includes(langPref);
                });
                if (found) {
                    chosenGroup = found.attrs['GROUP-ID'] || null;
                    chosenMediaLine = resolveMediaUri(found.line, upstreamBase);
                }
            }

            // Fallback: prima traccia nel gruppo corretto (NON sull'intero master)
            if (!chosenGroup && relevantAudio.length > 0) {
                chosenGroup = relevantAudio[0].attrs['GROUP-ID'] || null;
                chosenMediaLine = resolveMediaUri(relevantAudio[0].line, upstreamBase);
            }

            if (chosenMediaLine && chosenGroup) header.push(chosenMediaLine);
            let streamInf = best.info;
            if (chosenGroup) {
                if (/AUDIO="/.test(streamInf)) streamInf = streamInf.replace(/AUDIO="[^"]*"/, `AUDIO="${chosenGroup}"`);
                else streamInf = streamInf.replace('#EXT-X-STREAM-INF:', `#EXT-X-STREAM-INF:AUDIO="${chosenGroup}",`);
            }
            // FIX: Rimuovi SUBTITLES dalla streamInf mantenendo la virgola separatore corretta
            streamInf = streamInf.replace(
                /(,)?\s*SUBTITLES="[^"]*"(,)?\s*/g,
                (_match, before, after) => {
                    // Se ci sono virgole da entrambi i lati, ne conservo una come separatore
                    return before && after ? ',' : '';
                }
            );
            header.push(streamInf);
            header.push(best.url);
        }
        const mini = header.join('\n') + '\n';
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-store');
        res.send(mini);
    } catch (e) {
        console.error('[vixsynthetic] error:', (e as any)?.message || e);
        res.status(500).send('#EXTM3U\n# internal error');
    }
});

// Serve la cartella public.
app.use(
    '/public',
    express.static(path.join(__dirname, '..', 'public'))
);

// ✅ Middleware semplificato che usa sempre il router globale
app.use((req: Request, res: Response, next: NextFunction) => {
    debugLog(`Incoming request: ${req.method}`);

    const configString = req.path.split('/')[1];
    debugLog(`Config segment length: ${configString ? configString.length : 0}`);

    // Parse configuration from URL path segment once (before TV logic)
    // FIX DEFINITIVO: NON scrivere MAI la config dell'utente nella cache globale!
    // Ogni utente ha la sua config nel URL, non deve inquinare quella degli altri.
    // La configCache è per settings del SERVER (env vars), non per config utente.
    if (configString && configString.length > 10 && !configString.startsWith('stream') && !configString.startsWith('meta') && !configString.startsWith('manifest')) {
        const parsedConfig = parseConfigFromArgs(configString);
        // VALIDAZIONE: Object.keys() su null/array/string/number causa crash
        if (!isValidConfigObject(parsedConfig)) {
            debugLog(`⚠️ Invalid config type in URL: ${typeof parsedConfig}, ignoring`);
            // Continua con la richiesta senza config (default)
        } else if (Object.keys(parsedConfig).length > 0) {
            debugLog('🔧 Found valid config in URL (NOT updating global cache - user-specific)');
            // NON FARE PIÙ: Object.assign(configCache, parsedConfig);

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
                debugLog('[Base64→JSON] Configuration segment rewritten');
            }
        }
    }

    // Per le richieste di stream TV, assicurati che la configurazione proxy sia sempre presente
    if (req.url.includes('/stream/tv/') || req.url.includes('/stream/tv%3A')) {
        debugLog('📺 TV Stream request detected');
        // Non applicare più nessun fallback hardcoded
        // Non loggare più configCache: potrebbe contenere credenziali
    }

    // ...

    // PATCH: Inject full search query for AnimeWorld catalog search
    if (
        req.path === '/catalog/animeworld/anime/search.json' &&
        req.query && typeof req.query.query === 'string'
    ) {
        debugLog('🔎 PATCH: Injecting full search query from req.query.query:', req.query.query);
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
        globalBuilder = createBuilder(configCache);
        globalAddonInterface = globalBuilder.getInterface();
        globalRouter = getRouter(globalAddonInterface);
        console.log('✅ Global router initialized');
    }

    // USA SEMPRE il router globale
    globalRouter(req, res, next);
});

console.log(`✅ Addon active on port ${process.env.PORT || 7000}`);

// Landing page per configurazione web
app.get('/', (req: Request, res: Response) => {
    try {
        const manifest = loadCustomConfig();
        const html = landingTemplate(manifest);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (e) {
        console.error('[Landing] error:', (e as any)?.message || e);
        res.status(500).send('Errore caricamento landing page');
    }
});

// Avvia il server Express
const PORT = parseInt(process.env.PORT || '7000', 10);
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 HanX addon listening on http://0.0.0.0:${PORT}`);
});
