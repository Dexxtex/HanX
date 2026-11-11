/**
 * anime-core/provider-urls.ts
 * Base URL dei tre provider: **solo** `config/domains.json`.
 *
 * Prima c'erano quattro livelli per la stessa informazione: env `*_BASE_URL`,
 * `config/provider_urls.json`, un JSON remoto di terzi rifetchato ogni 10 s, e
 * `domains.json`. Il workflow `update-domains` ne aggiornava due, e un override
 * poteva vincere su un dominio appena corretto. Resta il file dei domini: se un
 * sito cambia host, lo aggiorna quel workflow.
 */

import { getDomain } from '../../utils/domains.js';

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

function normalizeKey(key: string): string {
  return String(key || '').trim().toLowerCase();
}

/**
 * Loopback, reti private, link-local e CGNAT: non sono siti, sono SSRF.
 * Il file dei domini è versionato, ma un dominio sbagliato non deve poter
 * puntare il provider a `127.0.0.1`.
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

/** Base URL del provider, da `config/domains.json`. Stringa vuota = non risolto. */
export function getProviderUrl(providerKey: string): string {
  const key = normalizeKey(providerKey);
  for (const candidate of [key, ...(ALIASES[key] || [])].map(normalizeKey)) {
    const domainKey = DOMAIN_KEY_MAP[candidate];
    if (!domainKey) continue;
    const host = String(getDomain(domainKey) || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '');
    if (!host) continue;
    const url = `https://${host}`;
    return isUsableBaseUrl(url) ? url : '';
  }
  return '';
}
