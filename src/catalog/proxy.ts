import { ProxyAgent, type Dispatcher } from 'undici';

/**
 * Dispatcher per il crawl: undici 8 gestisce http(s) e socks5 in proprio
 * (`Socks5ProxyAgent` interno). `socks5h://` si normalizza a `socks5://` perché
 * con undici sono equivalenti: manda sempre il nome host al proxy (ATYP=3),
 * quindi il DNS lo risolve il proxy. Test: tests/catalog/proxy.test.mjs.
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
  const raw = String(text || '');
  // Una password con `@` spezzava la vecchia regex al primo `@` e ne lasciava
  // leggibile la coda. `new URL` prende l'ultimo `@` come separatore vero.
  try {
    const url = new URL(raw);
    if (!url.username && !url.password) return raw;
    url.username = '***';
    url.password = '';
    return url.toString();
  } catch {
    return raw.replace(/\/\/.*@/, '//***@');
  }
}
