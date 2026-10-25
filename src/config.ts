/**
 * config.ts
 * Parsing e normalizzazione della config utente + chiave della cache provider.
 * Estratto da addon.ts per poterlo importare nei test senza avviare il server.
 */

import { createHash } from 'node:crypto';
import { debug } from './utils/logger.js';

export interface AddonConfig {
    tmdbApiKey?: string;
    tvdbApiKey?: string;
    tvdbPin?: string;
    easyProxyUrl?: string;
    easyProxyPassword?: string;
    animeunityEnabled?: boolean;
    animeunityDirect?: boolean;
    animeunityProxy?: boolean;
    animesaturnEnabled?: boolean;
    animeworldEnabled?: boolean;
    /** Scelta Direct della landing: la riproduzione ignora EasyProxy, anche quello dell'env. */
    directPlayback?: boolean;
}

// Validazione: verifica che un valore JSON sia un oggetto config valido (non null, non array)
export function isValidConfigObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
    );
}

// Helper: normalizza un valore booleano da qualsiasi formato.
// Restituisce undefined se il valore non è riconoscibile come booleano.
export function normalizeBool(val: unknown): boolean | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    const s = String(val).toLowerCase().trim();
    if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false;
    return undefined;
}

/**
 * Proxy di riproduzione effettivo. Stesso peso per link ed env: vince il valore
 * del link, EASYPROXY_URL riempie solo quando il link non lo porta. La modalità
 * Direct della landing (directPlayback) spegne tutto, env compreso.
 */
export function resolvePlaybackProxyUrl(
    directPlayback: unknown,
    configUrl: unknown,
    envUrl: string | undefined
): string {
    if (normalizeBool(directPlayback) === true) return '';
    const fromLink = typeof configUrl === 'string' ? configUrl.trim() : '';
    return (fromLink || envUrl || '').trim().replace(/\/+$/, '');
}

// Normalizzazione: converte tutti i valori booleani/stringhe in booleani effettivi
// e normalizza URL rimuovendo trailing slash.
// Gestisce il caso problematico dove "false" come stringa diventa truthy.
export function normalizeConfig(raw: Record<string, unknown>): AddonConfig {
    const result: AddonConfig = {};
    for (const [key, value] of Object.entries(raw)) {
        if (key === 'easyProxyUrl') {
            // Solo URL: rimuovi trailing slash
            if (typeof value === 'string') {
                const str = value.trim().replace(/\/+$/, '');
                if (str) (result as any)[key] = str;
            }
        } else if (key === 'tmdbApiKey' || key === 'tvdbApiKey' || key === 'tvdbPin') {
            // Chiavi API: trimma ma non toccare slash
            if (typeof value === 'string') {
                const str = value.trim();
                if (str) (result as any)[key] = str;
            }
        } else if (key === 'easyProxyPassword') {
            // Password: preserva ESATTAMENTE come fornita (niente trim, niente replace)
            if (typeof value === 'string') {
                (result as any)[key] = value;
            }
        } else if (key === 'animeunityEnabled' || key === 'animesaturnEnabled' ||
                   key === 'animeworldEnabled' || key === 'animeunityDirect' ||
                   key === 'animeunityProxy' || key === 'directPlayback') {
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
        }
        // Altrimenti ignora campi non riconosciuti
    }
    return result;
}

export function parseConfigFromArgs(args: any): AddonConfig {
    const config: AddonConfig = {};

    // Se non ci sono args o sono vuoti, ritorna configurazione vuota
    if (!args || args === '' || args === 'undefined' || args === 'null') {
        debug(4, 'Addon', 'No configuration provided, using defaults');
        return config;
    }

    // Se la configurazione è già un oggetto, validalo
    if (typeof args === 'object' && args !== null) {
        if (!isValidConfigObject(args)) {
            debug(4, 'Addon', 'Configuration object invalid (array or non-object)');
            return config;
        }
        debug(4, 'Addon', 'Configuration provided as valid object');
        return args as AddonConfig;
    }

    if (typeof args === 'string') {
        debug(4, 'Addon', `Config string length: ${args.length}`);

        // PASSO 1: Prova JSON diretto
        try {
            const parsed = JSON.parse(args);
            debug(4, 'Addon', 'Configuration parsed as direct JSON');
            if (!isValidConfigObject(parsed)) {
                debug(4, 'Addon', 'Parsed JSON is not a valid config object');
                return config;
            }
            return normalizeConfig(parsed);
        } catch (error) {
            debug(4, 'Addon', 'Not direct JSON, trying other methods');
        }

        // PASSO 2: Gestione URL encoded
        let decodedArgs = args;
        if (args.includes('%')) {
            try {
                decodedArgs = decodeURIComponent(args);
                debug(4, 'Addon', 'URL-decoded configuration');

                // Prova JSON dopo URL decode
                try {
                    const parsed = JSON.parse(decodedArgs);
                    debug(4, 'Addon', 'Configuration parsed from URL-decoded JSON');
                    if (!isValidConfigObject(parsed)) {
                        debug(4, 'Addon', 'URL-decoded JSON is not a valid config object');
                        return config;
                    }
                    return normalizeConfig(parsed);
                } catch (innerError) {
                    debug(4, 'Addon', 'URL-decoded content is not valid JSON');
                }
            } catch (error) {
                debug(4, 'Addon', 'URL decoding failed');
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

                debug(4, 'Addon', 'Trying base64 decode');
                const decoded = Buffer.from(paddedBase64, 'base64').toString('utf-8');
                debug(4, 'Addon', `Base64 decoded length: ${decoded.length}`);

                if (decoded.includes('{') && decoded.includes('}')) {
                    try {
                        const parsed = JSON.parse(decoded);
                        debug(4, 'Addon', 'Configuration parsed from Base64');
                        if (!isValidConfigObject(parsed)) {
                            debug(4, 'Addon', 'Base64 JSON is not a valid config object');
                            return config;
                        }
                        return normalizeConfig(parsed);
                    } catch (jsonError) {
                        debug(4, 'Addon', 'Base64 content is not valid JSON');

                        // Prova a estrarre JSON dalla stringa decodificata
                        const jsonMatch = decoded.match(/({.*})/);
                        if (jsonMatch && jsonMatch[1]) {
                            try {
                                const extractedJson = jsonMatch[1];
                                const parsed = JSON.parse(extractedJson);
                                debug(4, 'Addon', 'Extracted JSON from Base64 decoded string');
                                if (!isValidConfigObject(parsed)) {
                                    debug(4, 'Addon', 'Extracted JSON is not a valid config object');
                                    return config;
                                }
                                return normalizeConfig(parsed);
                            } catch (extractError) {
                                debug(4, 'Addon', 'Extracted JSON parsing failed');
                            }
                        }
                    }
                }
            } catch (error) {
                debug(4, 'Addon', 'Base64 decoding failed');
            }
        }

        debug(4, 'Addon', 'All parsing methods failed, using default configuration');
    }

    return config;
}

export function providerCacheKey(type: string, id: string, configDigest: string): string {
    // SHA-256 digest of the effective config ensures different passwords
    // and every flag that changes stream output produce different cache entries.
    return `${type}|${id}|${configDigest}`;
}

export interface ProviderCacheConfigInput {
    type: string;
    id: string;
    proxyUrl: string;
    proxyPassword: string;
    tmdbApiKey: string;
    tvdbApiKey: string;
    tvdbPin: string;
    animeunityEnabled: boolean;
    animesaturnEnabled: boolean;
    animeworldEnabled: boolean;
    animeunityDirect?: unknown;
    animeunityProxy?: unknown;
    mappingVersion: string;
}

/** SHA-256 della config che influenza gli stream: password diverse, entry diverse. */
export function providerConfigDigest(input: ProviderCacheConfigInput): string {
    const secretHash = (value: string): string => value
        ? createHash('sha256').update(value).digest('hex').slice(0, 16)
        : '';
    return createHash('sha256').update(JSON.stringify({
        type: input.type,
        proxyUrl: input.proxyUrl || '',
        proxyPswHash: secretHash(input.proxyPassword),
        tmdbKeyHash: secretHash(input.tmdbApiKey),
        tvdbKeyHash: secretHash(input.tvdbApiKey),
        tvdbPinHash: secretHash(input.tvdbPin),
        animeunityEnabled: !!input.animeunityEnabled,
        animesaturnEnabled: !!input.animesaturnEnabled,
        animeworldEnabled: !!input.animeworldEnabled,
        animeunityDirect: normalizeBool(input.animeunityDirect),
        animeunityProxy: normalizeBool(input.animeunityProxy),
        tvdb: input.id.startsWith('tvdb:'),
        mappingVersion: input.mappingVersion,
    })).digest('hex');
}
