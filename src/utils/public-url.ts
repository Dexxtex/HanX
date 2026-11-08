export interface PublicUrlHeaders {
  host?: string;
  forwardedHost?: string;
  forwardedPort?: string;
  forwardedProto?: string;
  protocol?: string;
}

function firstHeader(value: string | undefined): string {
  return String(value || '').split(',')[0].trim();
}

const HOST_RE = /^(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+(?::\d{1,5})?$|^\[[0-9a-fA-F:]+\](?::\d{1,5})?$/;

/**
 * Builds the public origin from proxy headers when they are present.
 * Returns '' when the request has no port/proxy information: the browser
 * origin is a better source in that case.
 */
export function detectPublicBaseUrl(input: PublicUrlHeaders): string {
  const forwardedHost = firstHeader(input.forwardedHost);
  const host = forwardedHost || firstHeader(input.host);
  if (!host || !HOST_RE.test(host)) return '';

  const hostPort = host.match(/:(\d+)$/);
  if (hostPort) {
    const p = Number.parseInt(hostPort[1], 10);
    if (p < 1 || p > 65535) return '';
  }

  const forwardedPort = firstHeader(input.forwardedPort);
  const hasPort = /:\d+$/.test(host) || /^\[[^\]]+\]:\d+$/.test(host);
  if (!forwardedHost && !forwardedPort && !hasPort) return '';

  const rawProto = (firstHeader(input.forwardedProto) || String(input.protocol || 'https')).trim().toLowerCase();
  const proto = rawProto === 'http' || rawProto === 'https' ? rawProto : 'https';

  let port = '';
  if (forwardedPort) {
    const p = Number.parseInt(forwardedPort, 10);
    if (Number.isInteger(p) && p >= 1 && p <= 65535) {
      const defaultPort = proto === 'https' ? 443 : 80;
      if (p !== defaultPort) port = String(p);
    }
  }

  return `${proto}://${host}${!hasPort && port ? `:${port}` : ''}`;
}

/**
 * Icona e sfondo serviti da questa istanza: l'immagine contiene `public/`,
 * mentre i raw URL di GitHub rispondono 404 ai client se il repo è privato.
 * Un valore già presente nel manifest (addon-config.json) resta quello scelto.
 */
export function withInstanceAssets<T extends Record<string, any>>(manifest: T, baseUrl: string): T {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return manifest;
  const icon = `${base}/public/icon.png`;
  return {
    ...manifest,
    logo: manifest.logo || icon,
    icon: manifest.icon || icon,
    favicon: manifest.favicon || icon,
    background: manifest.background || `${base}/public/background.png`,
  };
}
