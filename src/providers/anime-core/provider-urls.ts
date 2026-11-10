/**
 * anime-core/provider-urls.ts
 * Dynamic provider URL resolution: env override, then local JSON file, then
 * config/domains.json.
 * Ported 1:1 from easystreams-main provider_urls.js.
 *
 * Reload strategy:
 * - Local JSON file checked every 1.5 s (stat mtime)
 * - Remote JSON refreshed every 10 s, usato solo per le chiavi assenti nel file
 *   locale: non sovrascrive mai l'override locale.
 */

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import * as fs from 'fs';
import * as path from 'path';
import { getDomain } from '../../utils/domains.js';
import { debug } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Configuration ──────────────────────────────────────────

const PROVIDER_URLS_FILE: string = process.env.PROVIDER_URLS_FILE
  ? path.resolve(process.env.PROVIDER_URLS_FILE)
  : path.resolve(__dirname, '..', '..', '..', 'config', 'provider_urls.json');

const RELOAD_INTERVAL_MS = Number.parseInt(process.env.PROVIDER_URLS_RELOAD_MS || '1500', 10) || 1500;

const DEFAULT_PROVIDER_URLS_URL =
  'https://raw.githubusercontent.com/realbestia1/easystreams/refs/heads/main/provider_urls.json';
const PROVIDER_URLS_URL = String(process.env.PROVIDER_URLS_URL || DEFAULT_PROVIDER_URLS_URL).trim();

const REMOTE_RELOAD_INTERVAL_MS =
  Number.parseInt(process.env.PROVIDER_URLS_REMOTE_RELOAD_MS || '10000', 10) || 10000;
const REMOTE_FETCH_TIMEOUT_MS =
  Number.parseInt(process.env.PROVIDER_URLS_REMOTE_TIMEOUT_MS || '5000', 10) || 5000;

// ─── Alias map (same as easystreams) ────────────────────────

const ALIASES: Record<string, string[]> = {
  animeunity: ['animeunuty', 'anime_unity'],
  animeworld: ['anime_world'],
  animesaturn: ['anime_saturn'],
};

const DOMAIN_KEY_MAP: Record<string, string> = {
  animeunity: 'animeunity',
  animeworld: 'animeworld',
  animesaturn: 'animesaturn',
};

// ─── Internal state ─────────────────────────────────────────

let lastCheckAt = 0;
let lastMtimeMs = -1;
let lastData: Record<string, string> = {};
let lastRemoteData: Record<string, string> = {};
let lastRemoteCheckAt = 0;
let remoteInFlight: Promise<void> | null = null;

// ─── Helpers ────────────────────────────────────────────────

function normalizeKey(key: string): string {
  return String(key || '').trim().toLowerCase();
}

function normalizeUrl(value: string | undefined): string {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/\/+$/, '');
}

/**
 * Loopback, reti private, link-local e CGNAT: non sono siti, sono SSRF.
 * Il JSON remoto (rifetchato ogni 10 s) diventa la base URL di ogni provider,
 * quindi il controllo sta qui e non nel chiamante.
 */
function isPrivateHost(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '::1' || host === '::') return true;
  // `::ffff:127.0.0.1` è loopback travestito. Il parser URL lo normalizza in
  // esadecimale (`::ffff:7f00:1`), quindi vanno gestite entrambe le forme.
  const mapped = /^::ffff:(.+)$/i.exec(host);
  if (mapped) {
    const rest = mapped[1];
    const dotted = /^(\d{1,3}(?:\.\d{1,3}){3})$/.exec(rest);
    if (dotted) return isPrivateHost(dotted[1]);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
    if (hex) {
      const hi = Number.parseInt(hex[1], 16);
      const lo = Number.parseInt(hex[2], 16);
      return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return true; // forma inattesa: si rifiuta
  }
  // Solo un letterale IPv6: un hostname come `fc2.com` inizia per "fc" ma è un
  // sito pubblico, e la vecchia regex lo bloccava.
  if (host.includes(':') && /^(?:fe80|fc|fd)/.test(host)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** http(s) verso un host pubblico. Tutto il resto non può diventare una base URL. */
export function isUsableBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return !isPrivateHost(url.hostname);
  } catch {
    return false;
  }
}

function toNormalizedMap(raw: any, validate = false): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const nk = normalizeKey(key);
    const nv = normalizeUrl(value as string);
    if (!nk || !nv) continue;
    // Solo il JSON remoto è non fidato: il file locale è dell'operatore e può
    // puntare a un mirror in LAN (è la ragione per cui esiste PROVIDER_URLS_FILE).
    if (validate && !isUsableBaseUrl(nv)) {
      debug(1, 'ProviderUrls', 'base URL rifiutata: schema non http(s) o host privato', { key: nk });
      continue;
    }
    out[nk] = nv;
  }
  return out;
}

// ─── Local file reload ──────────────────────────────────────

function reloadProviderUrlsIfNeeded(force = false): void {
  const now = Date.now();
  if (!force && now - lastCheckAt < RELOAD_INTERVAL_MS) return;
  lastCheckAt = now;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(PROVIDER_URLS_FILE);
  } catch {
    if (lastMtimeMs !== -1) {
      lastMtimeMs = -1;
      lastData = {};
    }
    return;
  }

  if (!force && stat.mtimeMs === lastMtimeMs) return;

  try {
    const raw = fs.readFileSync(PROVIDER_URLS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    lastData = toNormalizedMap(parsed);
    lastMtimeMs = stat.mtimeMs;
  } catch {
    lastData = {};
    lastMtimeMs = stat.mtimeMs;
  }
}

// ─── Remote refresh ─────────────────────────────────────────

async function refreshProviderUrlsFromRemoteIfNeeded(force = false): Promise<void> {
  if (!PROVIDER_URLS_URL) return;
  if (remoteInFlight) return;

  const now = Date.now();
  if (!force && now - lastRemoteCheckAt < REMOTE_RELOAD_INTERVAL_MS) return;
  lastRemoteCheckAt = now;

  remoteInFlight = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(PROVIDER_URLS_URL, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response || !response.ok) return;
      const payload = await response.json();
      const parsed = toNormalizedMap(payload, true);
      if (Object.keys(parsed).length > 0) {
        lastRemoteData = parsed;
      }
    } catch {
      // Ignore remote refresh errors — keep last known values.
    } finally {
      clearTimeout(timeoutId);
      remoteInFlight = null;
    }
  })();
}

// ─── Public API ─────────────────────────────────────────────

function findFromJson(providerKey: string): string {
  reloadProviderUrlsIfNeeded(false);

  const key = normalizeKey(providerKey);
  const candidates = [key, ...(ALIASES[key] || [])].map(normalizeKey);
  for (const candidate of candidates) {
    const value = normalizeUrl(lastData[candidate]);
    if (value) return value;
  }
  // Solo se il file locale non copre la chiave: il remoto è un fallback e non
  // deve sovrascrivere un override locale.
  for (const candidate of candidates) {
    const value = normalizeUrl(lastRemoteData[candidate]);
    if (value) return value;
  }
  refreshProviderUrlsFromRemoteIfNeeded(false);
  return '';
}

function findFromEnv(envKeys: string[] = []): string {
  for (const envKey of envKeys) {
    const value = normalizeUrl(process.env[envKey]);
    if (value) return value;
  }
  return '';
}

function findFromDomains(providerKey: string): string {
  const key = normalizeKey(providerKey);
  const candidates = [key, ...(ALIASES[key] || [])].map(normalizeKey);
  for (const candidate of candidates) {
    const domainKey = DOMAIN_KEY_MAP[candidate];
    if (!domainKey) continue;
    const host = String(getDomain(domainKey) || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (!host) continue;
    return `https://${host}`;
  }
  return '';
}

/**
 * Resolve a provider URL.
 * Precedenza: env esplicito -> file JSON locale -> config/domains.json.
 */
export function getProviderUrl(providerKey: string, envKeys: string[] = []): string {
  const safeEnvKeys = Array.isArray(envKeys) ? envKeys : [];
  const fromEnv = findFromEnv(safeEnvKeys);
  if (fromEnv) return fromEnv;
  const fromJson = findFromJson(providerKey);
  if (fromJson) return fromJson;
  const fromDomains = findFromDomains(providerKey);
  if (fromDomains) return fromDomains;
  return '';
}
