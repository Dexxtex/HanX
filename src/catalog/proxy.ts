import { ProxyAgent, type Dispatcher } from 'undici';

/**
 * Dispatcher per il crawl: undici 8 gestisce http(s) e socks5 in proprio
 * (`Socks5ProxyAgent` interno). `socks5h://` (DNS risolto dal proxy) si
 * normalizza a `socks5://`: undici manda comunque il nome host al proxy.
 * Vuoto = nessun proxy.
 */
export function proxyDispatcher(raw: string | null | undefined): Dispatcher | undefined {
  const value = String(raw || '').trim();
  if (!value) return undefined;
  if (/^socks4a?:\/\//i.test(value)) {
    throw new Error('socks4 non è supportato: usa socks5:// (o socks5h://)');
  }
  const uri = value.replace(/^socks5h:\/\//i, 'socks5://');
  if (!/^(?:https?|socks5?):\/\//i.test(uri)) {
    throw new Error(`proxy non riconosciuto: serve http(s)://, socks:// o socks5:// (${uri.split(':')[0]}:)`);
  }
  return new ProxyAgent(uri);
}

/** Le credenziali del proxy non devono finire nei log. */
export function redactProxy(text: string): string {
  return String(text || '').replace(/\/\/[^/@\s]+@/g, '//***@');
}
