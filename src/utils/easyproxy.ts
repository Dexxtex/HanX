export type EasyProxyHeaders = Record<string, string | undefined>;

function buildEasyProxyUrl(
  path: string,
  targetUrl: string,
  proxyUrl: string,
  proxyPassword: string,
  headers?: EasyProxyHeaders
): string {
  if (!targetUrl || !proxyUrl.trim()) return targetUrl;

  const base = proxyUrl.trim().replace(/\/+$/, '');
  const params = new URLSearchParams({ d: targetUrl });
  if (proxyPassword) params.set('api_password', proxyPassword);

  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      if (!value) continue;
      params.set(`h_${name}`, value);
    }
  }

  return `${base}${path}?${params.toString()}`;
}

export const buildEasyProxyStreamUrl = (
  mediaUrl: string,
  proxyUrl: string,
  proxyPassword: string,
  headers?: EasyProxyHeaders
): string => buildEasyProxyUrl('/proxy/stream', mediaUrl, proxyUrl, proxyPassword, headers);

export const buildEasyProxyHlsUrl = (
  manifestUrl: string,
  proxyUrl: string,
  proxyPassword: string,
  headers?: EasyProxyHeaders
): string => buildEasyProxyUrl('/proxy/hls/manifest.m3u8', manifestUrl, proxyUrl, proxyPassword, headers);
