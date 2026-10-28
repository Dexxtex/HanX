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

/**
 * Builds the public origin from proxy headers when they are present.
 * Returns '' when the request has no port/proxy information: the browser
 * origin is a better source in that case.
 */
export function detectPublicBaseUrl(input: PublicUrlHeaders): string {
  const forwardedHost = firstHeader(input.forwardedHost);
  const host = forwardedHost || firstHeader(input.host);
  if (!host) return '';

  const forwardedPort = firstHeader(input.forwardedPort);
  const hasPort = /:\d+$/.test(host) || /^\[[^\]]+\]:\d+$/.test(host);
  if (!forwardedHost && !forwardedPort && !hasPort) return '';

  const proto = firstHeader(input.forwardedProto) || String(input.protocol || 'https').trim() || 'https';
  const defaultPort = proto === 'https' ? '443' : '80';
  const port = forwardedPort && forwardedPort !== defaultPort ? forwardedPort : '';
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
