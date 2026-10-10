import { addonBuilder, getRouter, Manifest, Stream } from "stremio-addon-sdk";
import { buildUnifiedStreamName, providerLabel } from './utils/unifiedNames';
import * as fs from 'fs';
import { landingTemplate } from './landingPage';
import * as path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import fetch from 'node-fetch';
import { AnimeUnityProvider } from './providers/animeunity-provider';
import { AnimeWorldProvider } from './providers/animeworld-provider';
import { KitsuProvider } from './providers/kitsu';
import { formatMediaFlowUrl } from './utils/mediaflow';

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
import { fetchPage } from './providers/flaresolverr';

// ================= TYPES & INTERFACES =================

interface AddonConfig {
    tmdbApiKey?: string;
    mediaFlowProxyUrl?: string;
    mediaFlowProxyPassword?: string;
    // Proxy backend toggle: false/undefined = EasyProxy (default), true = MediaFlow Proxy.
    useMediaFlow?: boolean;
    enableMpd?: boolean;
    animeunityEnabled?: boolean;
    animesaturnEnabled?: boolean;
    animeworldEnabled?: boolean;
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

// ===== STREAM PRIORITY ORDERING SYSTEM =====
/**
 * Calcola la priorità di uno stream basandosi su titolo e URL.
 * Priorità più BASSA = mostrato prima (1 = primo, 13 = ultimo)
 *
 * Ordine desiderato:
 * 1. Vavoo clean (senza MFP)
 * 2. Proxy italiani (CF)
 * 3. Freeshot / MediaHosting
 * 4. Stream MPD statici
 * 5. Daddy/Proxy italiani
 * 6. Vavoo MFP
 * 7. GDplayer
 * 8. SportZX / SPON / SPSO
 * 9. Stream residuali
 */
function getStreamPriority(stream: { url: string; title: string }): number {
    const title = (stream.title || '').toString();
    const url = (stream.url || '').toString();

    // 1. Vavoo clean (senza wrapper MFP, contiene "Vavoo" ma NON contiene mfp/proxy nel URL)
    if (/vavoo/i.test(title) && !/mfp|mediaflow|proxy.*stream/i.test(url)) return 1;

    // 2. D_CF (🇮🇹🔄 con dlhd.m3u8 )
    if (/🇮🇹🔄/.test(title) && (/\/dlhd\.m3u8\?src=/i.test(url) || /proxy\.stremio\.dpdns\.org/i.test(url))) return 2;

    // 3. Freeshot (cerca [🏟 Free] o freeshot)
    if (/freeshot|\[🏟\s*Free\]|🏟.*free/i.test(title)) return 3;

    // 3.2. pa.cc (cerca [pa.cc])
    if (/\[pa\.cc\]/i.test(title)) return 3.2;

    // 3.5. MediaHosting [MH] (subito dopo Freeshot)
    if (/\[MH\]/i.test(title)) return 3.5;

    // 3.9. staticUrlMpdh (🎬MPDh - SkyFHD source) - PRIMO tra i MPD
    if (/\[🎬MPDh\]/i.test(title)) return 3.9;

    // 4. staticUrlMpd (🎬MPD - canali statici con MPD iniettati dinamicamente)
    if (/\[🎬MPD\]/i.test(title)) return 4;

    // 4.5. staticUrlMpd2 (🎬MPD2 - seconda sorgente RM)
    if (/\[🎬MPD2\]/i.test(title)) return 4.5;

    // 4.6. staticUrlMpdz (🎬MPDz -  source)
    if (/\[🎬MPDz\]/i.test(title)) return 4.6;

    // 4.7. staticUrlMpdp (🎬MPDp - PSky source)
    if (/\[🎬MPDp\]/i.test(title)) return 4.7;

    // 6. Daddy con 🇮🇹 (estratti, wrappati MFP o diretti ma NON 🔄 e NON [Player Esterno])
    if (/^🇮🇹(?!🔄)/.test(title) && !/\[Player Esterno\]/i.test(title) && /dlhd\.pk|mfp.*dlhd/i.test(url)) return 6;

    // 7. Vavoo MFP (contiene "Vavoo" E contiene mfp/mediaflow nel URL)
    if (/vavoo/i.test(title) && /mfp|mediaflow|proxy.*stream/i.test(url)) return 7;

    // 8. GDplayer
    if (/\[🌐Gd\]|\bGd\b|gdplayer/i.test(title)) return 8;

    // 9.5. SPON
    if (/\[?SPON\]?/i.test(title)) return 9.5;

    // 9.8. SportzX [SPZX]
    if (/\[SPZX\]/i.test(title)) return 9.8;

    // 9.9. Sports99 [SP99]
    if (/\[SP99\]/i.test(title)) return 9.9;

    // 13. Altri daddy FAST dynamic (estratti ma non italiani, non leftover)
    if (!/\[Player Esterno\]/i.test(title) && /dlhd\.pk|mfp.*dlhd/i.test(url)) return 13;

    // 14. [Player Esterno] daddy leftover (oltre CAP)
    if (/\[Player Esterno\]/i.test(title) && /dlhd\.pk|mfp.*dlhd/i.test(url)) return 14;

    // Default: altri stream non categorizzati (mettiamo dopo i daddy ma prima dei leftover)
    return 13.5;
}

/**
 * Ordina un array di stream secondo le priorità definite.
 * Modifica l'array in-place.
 */
function sortStreamsByPriority(streams: { url?: string; title?: string }[]): void {
    streams.sort((a, b) => {
        const streamA = { url: a.url || '', title: a.title || '' };
        const streamB = { url: b.url || '', title: b.title || '' };

        // DVR category: -2 = active recording, -1 = completed, 0 = live, 1 = record entry
        const getDvrCategory = (title: string): number => {
            if (title.includes('Recording...') || title.includes('Stop & Watch')) return -2;
            if (title.includes('[DVR]') && !title.includes('REC')) return -1;
            if (title.startsWith('🔴 REC')) return 1;
            return 0; // Live stream
        };

        const catA = getDvrCategory(streamA.title);
        const catB = getDvrCategory(streamB.title);

        // Different categories - sort by category
        if (catA !== catB) {
            return catA - catB;
        }

        // Same category - use stream priority
        // For DVR "REC" entries, extract the stream title and use that for priority
        let prioStreamA = streamA;
        let prioStreamB = streamB;

        if (catA === 1) {
            // Extract stream info from "🔴 REC (4h) <stream_title>"
            const extractTitle = (t: string) => t.replace(/^🔴 REC \(\d+h\) /, '');
            prioStreamA = { url: streamA.url, title: extractTitle(streamA.title) };
            prioStreamB = { url: streamB.url, title: extractTitle(streamB.title) };
        }

        const prioA = getStreamPriority(prioStreamA);
        const prioB = getStreamPriority(prioStreamB);
        if (prioA !== prioB) return prioA - prioB;

        // Same priority - alphabetical
        return prioStreamA.title.localeCompare(prioStreamB.title);
    });
}

// Helper: compute Europe/Rome interpretation for eventStart even if timezone is missing
// ================= MANIFEST BASE (restored) =================
const baseManifest: Manifest = {
    id: "org.stremio.vixcloud",
    version: "12.4.23",
    name: "StreamViX | Elfhosted",
    description: "StreamViX addon dedicato ad AnimeUnity, AnimeSaturn e AnimeWorld",
    background: "https://raw.githubusercontent.com/qwertyuiop8899/StreamViX/refs/heads/main/public/backround.png",
    types: ["anime"],
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

// Funzione per parsare la configurazione dall'URL
function parseConfigFromArgs(args: any): AddonConfig {
    const config: AddonConfig = {};

    // Se non ci sono args o sono vuoti, ritorna configurazione vuota
    if (!args || args === '' || args === 'undefined' || args === 'null') {
        debugLog('No configuration provided, using defaults');
        return config;
    }

    // Se la configurazione è già un oggetto, usala direttamente
    if (typeof args === 'object' && args !== null) {
        debugLog('Configuration provided as object');
        return args;
    }

    if (typeof args === 'string') {
        debugLog(`Configuration string: ${args.substring(0, 50)}... (length: ${args.length})`);

        // PASSO 1: Prova JSON diretto
        try {
            const parsed = JSON.parse(args);
            debugLog('Configuration parsed as direct JSON');
            return parsed;
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
                    return parsed;
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

                debugLog(`Trying base64 decode: ${paddedBase64.substring(0, 20)}...`);
                const decoded = Buffer.from(paddedBase64, 'base64').toString('utf-8');
                debugLog(`Base64 decoded result: ${decoded.substring(0, 50)}...`);

                if (decoded.includes('{') && decoded.includes('}')) {
                    try {
                        const parsed = JSON.parse(decoded);
                        debugLog('Configuration parsed from Base64');
                        return parsed;
                    } catch (jsonError) {
                        debugLog('Base64 content is not valid JSON');

                        // Prova a estrarre JSON dalla stringa decodificata
                        const jsonMatch = decoded.match(/({.*})/);
                        if (jsonMatch && jsonMatch[1]) {
                            try {
                                const extractedJson = jsonMatch[1];
                                const parsed = JSON.parse(extractedJson);
                                debugLog('Extracted JSON from Base64 decoded string');
                                return parsed;
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

function _providerFnv1aHash(s: string): string {
    // Small FNV-1a 32-bit hash for stable, short cache keys.
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h = (h ^ s.charCodeAt(i)) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}
function _providerCacheKey(id: string, configHashInput: string): string {
    return `${id}|${_providerFnv1aHash(configHashInput)}`;
}
function _providerCacheGet(id: string, configHashInput: string): any[] | null {
    if (PROVIDER_CACHE_DISABLED) return null;
    const k = _providerCacheKey(id, configHashInput);
    const e = _providerStreamCache.get(k);
    if (!e) return null;
    if (Date.now() - e.ts > PROVIDER_CACHE_TTL_MS) {
        _providerStreamCache.delete(k);
        return null;
    }
    return e.streams;
}
function _providerCacheSet(id: string, configHashInput: string, streams: any[]): void {
    if (PROVIDER_CACHE_DISABLED) return;
    if (!Array.isArray(streams) || streams.length === 0) return; // never cache empty results
    const k = _providerCacheKey(id, configHashInput);
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
                        if (Object.keys(parsed).length > 0) config = parsed;
                    } catch { }
                } else if (requestConfig && typeof requestConfig === 'object' && Object.keys(requestConfig).length > 0) {
                    config = { ...requestConfig };
                }
                console.log(`[CONFIG-DEBUG] requestConfig type=${typeof requestConfig}`);

                // NOTE: Il middleware ora converte Base64→JSON prima che l'SDK processi la request,
                // quindi requestConfig dovrebbe sempre contenere la config utente correttamente.

                // MFP: prima dalla config utente, poi da env vars (per installazioni locali)
                // NORMALIZZA: rimuovi trailing slash per evitare doppi slash in URL tipo /proxy/...
                const mfpUrl = (config.mediaFlowProxyUrl || process.env.MFP_URL || '').toString().trim().replace(/\/+$/, '');
                const mfpPsw = (config.mediaFlowProxyPassword || process.env.MFP_PSW || process.env.MFP_PASSWORD || '').toString().trim();
                // Backend del proxy: false/undefined = EasyProxy (default), true = MediaFlow.
                // Quando MediaFlow alcuni endpoint custom non esistono e gli host
                // resolver-based (VixCloud, Mixdrop, Sportsonline, Vavoo) richiedono /extractor/video.m3u8.
                const useMediaFlow = (() => {
                    const v: any = (config as any).useMediaFlow;
                    if (v === true || v === 'true' || v === 'on' || v === 1 || v === '1') return true;
                    const env = (process.env.PROXY_BACKEND || process.env.MFP_BACKEND || '').toLowerCase();
                    if (env === 'mediaflow' || env === 'mfp') return true;
                    return false;
                })();
                console.log(`🔧 [MFP] User config: url=${mfpUrl || '(none)'} pass=${mfpPsw ? 'SET' : '(none)'} backend=${useMediaFlow ? 'MediaFlow' : 'EasyProxy'}`);

                const allStreams: Stream[] = [];

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
                // Cache key for the movie/series provider extraction cache.
                // Includes every user-facing flag that affects which providers
                // run and the URL shape they produce. Same imdb/tmdb id with
                // same config = same cache entry.
                const _providerConfigSig = JSON.stringify([
                    !!animeUnityEnabled, !!animeSaturnEnabled, !!animeWorldEnabled,
                    mfpUrl || '', mfpPsw ? 'mfppsw' : '',
                    (config as any).animeunityDirect ? '1' : '0',
                    (config as any).animeunityDirectFhd ? '1' : '0',
                    (config as any).animeunityProxy ? '1' : '0',
                ]);
                if ((id.startsWith('kitsu:') || id.startsWith('mal:') || id.startsWith('tt') || id.startsWith('tmdb:')) && (animeUnityEnabled || animeSaturnEnabled || animeWorldEnabled)) {
                    // Cache check before the expensive fan-out.
                    const _cachedStreams = _providerCacheGet(id, _providerConfigSig);
                    if (_cachedStreams) {
                        debugLog(`⚡ Provider cache HIT for ${id} (${_cachedStreams.length} streams)`);
                        return { streams: _cachedStreams };
                    }
                    // Rilevamento addonBase per AnimeUnity (stessa logica VixSrc)
                    let auAddonBase = '';
                    try {
                        const lastReqAu: any = (global as any).lastExpressRequest;
                        if (lastReqAu) {
                            const proto = lastReqAu.protocol || 'https';
                            const host = lastReqAu.get('host') || lastReqAu.headers?.host || '';
                            if (host) auAddonBase = `${proto}://${host}`;
                        }
                    } catch { /* ignore */ }
                    if (!auAddonBase) auAddonBase = (process?.env?.ADDON_BASE_URL || '').trim();
                    if (!auAddonBase) auAddonBase = (config as any).addonBase || '';
                    const animeUnityConfig = {
                        enabled: animeUnityEnabled,
                        mfpUrl: mfpUrl,
                        mfpPassword: mfpPsw,
                        tmdbApiKey: config.tmdbApiKey || process.env.TMDB_API_KEY || '40a9faa1f6741afb2c0c40238d85f8d0',
                        addonBase: auAddonBase || undefined,
                        animeunityDirect: (() => { const v = (config as any).animeunityDirect; if (v === undefined) return undefined; return v === true || v === 'true' || v === 'on' || v === 1; })(),
                        animeunityDirectFhd: (() => { const v = (config as any).animeunityDirectFhd; if (v === undefined) return undefined; return v === true || v === 'true' || v === 'on' || v === 1; })(),
                        animeunityProxy: (() => { const v = (config as any).animeunityProxy; if (v === undefined) return undefined; return v === true || v === 'true' || v === 'on' || v === 1; })(),
                    } as AnimeUnityConfig;
                    const animeSaturnConfig = {
                        enabled: animeSaturnEnabled,
                        mfpUrl: mfpUrl,
                        mfpPassword: mfpPsw,
                        mfpProxyUrl: mfpUrl,
                        mfpProxyPassword: mfpPsw,
                        tmdbApiKey: config.tmdbApiKey || process.env.TMDB_API_KEY || '40a9faa1f6741afb2c0c40238d85f8d0'
                    };
                    const animeWorldConfig = {
                        enabled: animeWorldEnabled,
                        mfpUrl: mfpUrl,
                        mfpPassword: mfpPsw,
                        tmdbApiKey: config.tmdbApiKey || process.env.TMDB_API_KEY || '40a9faa1f6741afb2c0c40238d85f8d0'
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
                                const timeoutPromise = new Promise<{ streams: Stream[] }>((_, reject) => {
                                    setTimeout(() => reject(new Error(`${name} timeout after ${timeoutMs}ms`)), timeoutMs);
                                });
                                result = await Promise.race([handler(), timeoutPromise]);
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
                    _providerCacheSet(id, _providerConfigSig, allStreams);
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
app.get(['/vixsynthetic', '/vixsynthetic.m3u8'], async (req: Request, res: Response) => {
    try {
        const src = typeof req.query.src === 'string' ? req.query.src : '';
        if (!src) return res.status(400).send('#EXTM3U\n# Missing src');
        const langPref = ((req.query.lang as string) || 'it').toLowerCase();
        const multiFlag = (() => {
            const m = String(req.query.multi || '').toLowerCase();
            if (['1', 'true', 'on', 'yes', 'all'].includes(m)) return true;
            if (String(req.query.languages || '').toLowerCase() === 'all') return true;
            return false;
        })();
        if (multiFlag) console.log('[vixsynthetic] multi-language mode attivo');
        // Rileva se src è già un URL proxato (EasyProxy/MFP) — non servono header VixSrc
        const isProxiedSrc = /proxy\/hls|mediaflow/i.test(src) && !/vixsrc\.to/i.test(new URL(src).hostname);
        const fetchHeaders = isProxiedSrc
            ? { 'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, */*' }
            : { 'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, */*', 'Referer': 'https://vixsrc.to/', 'Origin': 'https://vixsrc.to' };
        if (isProxiedSrc) console.log('[vixsynthetic] src è URL proxato, skip header VixSrc');
        const r = await fetch(src, { headers: fetchHeaders as any });
        if (!r.ok) return res.status(502).send('#EXTM3U\n# Upstream error');
        const text = await r.text();
        // Se non è master, restituisci com'è
        if (!/#EXT-X-STREAM-INF:/i.test(text)) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            return res.send(text);
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
                // Resolve relative
                let vUrl = next.trim();
                try { vUrl = new URL(vUrl, src).toString(); } catch { }
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
        const copyTags = ['#EXT-X-VERSION', '#EXT-X-INDEPENDENT-SEGMENTS'];
        for (const t of copyTags) { if (text.includes(t)) header.push(t); }

        if (multiFlag) {
            // In modalità multi includiamo tutte le righe #EXT-X-MEDIA (AUDIO e SUBTITLES) e manteniamo il GROUP-ID originale.
            const audioGroupsEncountered: Set<string> = new Set();
            const subtitleGroupsEncountered: Set<string> = new Set();
            for (const m of media) {
                const type = (m.attrs['TYPE'] || '').toUpperCase();
                if (type === 'AUDIO') {
                    header.push(m.line);
                    if (m.attrs['GROUP-ID']) audioGroupsEncountered.add(m.attrs['GROUP-ID']);
                } else if (type === 'SUBTITLES') {
                    header.push(m.line);
                    if (m.attrs['GROUP-ID']) subtitleGroupsEncountered.add(m.attrs['GROUP-ID']);
                }
            }
            // Forziamo la variante best ad usare il primo gruppo audio se presente
            let streamInf = best.info;
            if (audioGroupsEncountered.size) {
                const firstAudio = [...audioGroupsEncountered][0];
                if (/AUDIO="/.test(streamInf)) streamInf = streamInf.replace(/AUDIO="[^"]+"/, `AUDIO="${firstAudio}"`);
                else streamInf = streamInf.replace('#EXT-X-STREAM-INF:', `#EXT-X-STREAM-INF:AUDIO="${firstAudio}",`);
            }
            header.push(streamInf);
            header.push(best.url);
        } else {
            // Modalità singola (compatibile precedente): seleziona solo la traccia richiesta (langPref)
            let chosenGroup: string | null = null;
            let chosenMediaLine: string | null = null;
            for (const m of media) {
                const type = (m.attrs['TYPE'] || '').toUpperCase();
                if (type !== 'AUDIO') continue;
                const lang = (m.attrs['LANGUAGE'] || '').toLowerCase();
                const name = (m.attrs['NAME'] || '').toLowerCase();
                if (lang === langPref || name.includes(langPref)) {
                    chosenGroup = m.attrs['GROUP-ID'] || null;
                    chosenMediaLine = m.line;
                    break;
                }
            }
            if (!chosenGroup && media.length) {
                const firstAudio = media.find(m => (m.attrs['TYPE'] || '').toUpperCase() === 'AUDIO');
                if (firstAudio) { chosenGroup = firstAudio.attrs['GROUP-ID'] || null; chosenMediaLine = firstAudio.line; }
            }
            if (chosenMediaLine && chosenGroup) header.push(chosenMediaLine);
            let streamInf = best.info;
            if (chosenGroup) {
                if (/AUDIO="/.test(streamInf)) streamInf = streamInf.replace(/AUDIO="[^"]+"/, `AUDIO="${chosenGroup}"`);
                else streamInf = streamInf.replace('#EXT-X-STREAM-INF:', `#EXT-X-STREAM-INF:AUDIO="${chosenGroup}",`);
            }
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

// ✅ Middleware semplificato che usa sempre il router globale
app.use((req: Request, res: Response, next: NextFunction) => {
    debugLog(`Incoming request: ${req.method} ${req.path}`);
    debugLog(`Full URL: ${req.url}`);
    debugLog(`Path segments:`, req.path.split('/'));

    const configString = req.path.split('/')[1];
    debugLog(`Config string extracted: "${configString}" (length: ${configString ? configString.length : 0})`);

    // Parse configuration from URL path segment once (before TV logic)
    // FIX DEFINITIVO: NON scrivere MAI la config dell'utente nella cache globale!
    // Ogni utente ha la sua config nel URL, non deve inquinare quella degli altri.
    // La configCache è per settings del SERVER (env vars), non per config utente.
    if (configString && configString.length > 10 && !configString.startsWith('stream') && !configString.startsWith('meta') && !configString.startsWith('manifest')) {
        const parsedConfig = parseConfigFromArgs(configString);
        if (Object.keys(parsedConfig).length > 0) {
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
                debugLog(`🔄 [Base64→JSON] Rewritten URL for SDK: ${configString.substring(0, 30)}... → ${encodedJsonConfig.substring(0, 50)}...`);
            }
        }
    }

    // Per le richieste di stream TV, assicurati che la configurazione proxy sia sempre presente
    if (req.url.includes('/stream/tv/') || req.url.includes('/stream/tv%3A')) {
        debugLog('📺 TV Stream request detected, ensuring MFP configuration');
        // Non applicare più nessun fallback hardcoded
        // if (!configCache.mfpProxyUrl || !configCache.mfpProxyPassword) { ... } // RIMOSSO
        debugLog('📺 Current proxy config for TV streams:', configCache);
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
    console.log(`🚀 StreamVix addon listening on http://0.0.0.0:${PORT}`);
});
