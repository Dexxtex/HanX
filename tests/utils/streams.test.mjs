import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { ProxyAgent } from 'undici';
import { buildEasyProxyHlsUrl, buildEasyProxyStreamUrl } from '../../dist/utils/easyproxy.js';
import { providerLabel } from '../../dist/utils/unifiedNames.js';
import { AnimeSaturnProvider, selectHighestSaturnHls } from '../../dist/providers/animesaturn-provider.js';
import { buildAnimeWorldStreamOutput } from '../../dist/providers/animeworld-provider.js';
import { resolveMappingRequest, toNumericId } from '../../dist/mapping/request.js';
import { fetchResource, fetchWithTimeout } from '../../dist/providers/anime-core/fetch-resource.js';
import { createCaches } from '../../dist/providers/anime-core/cache.js';

// Flatten an error and its cause/aggregate chain into one searchable string.
function errorChainText(err, seen = new Set()) {
  if (!err || typeof err !== 'object' || seen.has(err)) return '';
  seen.add(err);
  const nested = [...(err.errors || []).map((e) => errorChainText(e, seen)), errorChainText(err.cause, seen)];
  return `${err.code || ''} ${err.message || ''} ${nested.join(' ')}`;
}

test('buildEasyProxyStreamUrl keeps a password with reserved characters as one value', () => {
  const url = buildEasyProxyStreamUrl(
    'https://cdn.example.com/video.mp4?token=abc',
    'http://easyproxy.local:7860/',
    'p&ss#word'
  );
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'http://easyproxy.local:7860');
  assert.equal(parsed.pathname, '/proxy/stream');
  assert.equal(parsed.searchParams.get('api_password'), 'p&ss#word');
  assert.equal(parsed.searchParams.get('d'), 'https://cdn.example.com/video.mp4?token=abc');
  assert.equal(parsed.hash, '', 'reserved password characters must not become a fragment');

  const withoutPassword = new URL(buildEasyProxyStreamUrl('https://cdn.example.com/video.mp4', 'http://easyproxy.local:7860', ''));
  assert.equal(withoutPassword.searchParams.has('api_password'), false);
});

test('buildEasyProxyStreamUrl preserves the source URL and its query parameters', () => {
  const source = 'https://cdn.example.com/v.mp4?filename=My%20Video%20%231.mp4&token=xyz';
  const url = buildEasyProxyStreamUrl(source, 'http://easyproxy.local:7860', '');
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/proxy/stream');
  assert.equal(parsed.searchParams.get('d'), source);
  assert.equal(parsed.searchParams.get('filename'), null);
});

test('buildEasyProxyHlsUrl uses the HLS alias and forwards headers', () => {
  const url = buildEasyProxyHlsUrl(
    'https://cdn.example.com/master.m3u8?token=abc',
    'http://easyproxy.local:7860',
    'secret',
    { Origin: 'https://cdn.example.com', Referer: 'https://site.example/ep' }
  );
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/proxy/hls/manifest.m3u8');
  assert.equal(parsed.searchParams.get('d'), 'https://cdn.example.com/master.m3u8?token=abc');
  assert.equal(parsed.searchParams.get('api_password'), 'secret');
  assert.equal(parsed.searchParams.get('h_Origin'), 'https://cdn.example.com');
  assert.equal(parsed.searchParams.get('h_Referer'), 'https://site.example/ep');
});

test('buildEasyProxy* returns the raw URL when EasyProxy is not configured', () => {
  assert.equal(
    buildEasyProxyStreamUrl('https://cdn.example/x.mp4', '', ''),
    'https://cdn.example/x.mp4'
  );
  assert.equal(
    buildEasyProxyHlsUrl('https://cdn.example/x.m3u8', '', ''),
    'https://cdn.example/x.m3u8'
  );
});

test('AnimeWorld usa il proxy HLS per i manifest e il proxy stream per gli MP4', () => {
  const config = {
    enabled: true,
    proxyUrl: 'http://easyproxy.local:7860',
    proxyPassword: 'secret',
    tmdbApiKey: '',
  };

  const hls = new URL(buildAnimeWorldStreamOutput(
    'https://cdn.example/master.m3u8?token=a',
    'solo-leveling',
    config
  ).url);
  assert.equal(hls.pathname, '/proxy/hls/manifest.m3u8');
  assert.equal(hls.searchParams.get('d'), 'https://cdn.example/master.m3u8?token=a');
  assert.match(hls.searchParams.get('h_Referer') || '', /\/play\/solo-leveling$/);

  const mp4 = new URL(buildAnimeWorldStreamOutput(
    'https://cdn.example/video.mp4',
    'solo-leveling',
    config
  ).url);
  assert.equal(mp4.pathname, '/proxy/stream');
  assert.equal(mp4.searchParams.get('d'), 'https://cdn.example/video.mp4');

  assert.equal(
    buildAnimeWorldStreamOutput('https://cdn.example/master.m3u8', 'solo-leveling', {
      ...config,
      proxyUrl: '',
    }).url,
    'https://cdn.example/master.m3u8',
    'senza EasyProxy lo stream resta diretto'
  );
});

test('AnimeSaturn wraps media streams through EasyProxy and leaves embed URLs direct', () => {
  const provider = new AnimeSaturnProvider({
    enabled: true,
    proxyUrl: 'http://easyproxy.local:7860',
    proxyPassword: 'secret',
    tmdbApiKey: '',
  });
  const streams = [
    {
      title: 'hls',
      url: 'https://cdn.example/master.m3u8?token=a',
      behaviorHints: { headers: { Referer: 'https://site.example/ep', 'User-Agent': 'UA' } },
    },
    {
      title: 'mp4',
      url: 'https://cdn.example/video.mp4',
      behaviorHints: { headers: { Referer: 'https://site.example/ep' } },
    },
    {
      title: 'embed',
      url: 'https://site.example/embed/1',
      behaviorHints: { headers: {} },
    },
  ];

  const proxied = provider.applyEasyProxy(streams);
  const hls = new URL(proxied[0].url);
  assert.equal(hls.pathname, '/proxy/hls/manifest.m3u8');
  assert.equal(hls.searchParams.get('d'), streams[0].url);
  assert.equal(hls.searchParams.get('h_Referer'), 'https://site.example/ep');
  assert.equal(hls.searchParams.get('h_User-Agent'), 'UA');
  assert.equal(hls.searchParams.get('max_res'), 'true');

  const mp4 = new URL(proxied[1].url);
  assert.equal(mp4.pathname, '/proxy/stream');
  assert.equal(mp4.searchParams.get('d'), streams[1].url);

  assert.equal(proxied[2].url, streams[2].url);

  const directProvider = new AnimeSaturnProvider({
    enabled: true,
    proxyUrl: '',
    proxyPassword: '',
    tmdbApiKey: '',
  });
  assert.equal(directProvider.applyEasyProxy(streams)[0].url, streams[0].url);
});

test('toNumericId extracts the numeric id from a tmdb request id', () => {
  assert.equal(toNumericId('tmdb:12345:2:1'), '12345');
});

test('resolveMappingRequest resolves a bare numeric TMDB id with season and episode', () => {
  const lookup = resolveMappingRequest('12345', 2, 1);
  assert.ok(lookup);
  assert.equal(lookup.provider, 'tmdb');
  assert.equal(lookup.id, '12345');
  assert.equal(lookup.season, 2);
  assert.equal(lookup.episode, 1);
});

test('AnimeSaturn seleziona la variante HLS con risoluzione più alta', async (t) => {
  const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
./360p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
./720p/playlist.m3u8`;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
    if (req.url === '/master.m3u8') res.end(master);
    else res.end('#EXTM3U\n#EXTINF:6,\nsegment.ts');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(
    await selectHighestSaturnHls(`${base}/master.m3u8`, `${base}/episode`),
    `${base}/720p/playlist.m3u8`
  );
  assert.equal(
    await selectHighestSaturnHls(`${base}/media.m3u8`, `${base}/episode`),
    `${base}/media.m3u8`,
    'una playlist media senza varianti resta invariata'
  );
  assert.equal(
    await selectHighestSaturnHls(`${base}/video.mp4`, `${base}/episode`),
    `${base}/video.mp4`,
    'i file MP4 non vengono scaricati'
  );
});

test('fetchResource usa AS_PROXY, poi PROXY, poi il diretto', async (t) => {
  const saved = { PROXY: process.env.PROXY, AS_PROXY: process.env.AS_PROXY };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const target = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('target-ok');
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  t.after(() => target.close());

  const targetBase = `http://127.0.0.1:${target.address().port}`;
  let globalHits = 0;
  let platformHits = 0;
  let platformFails = false;
  let globalFails = false;

  const forward = (req, res) => {
    const url = new URL(req.url);
    const upstream = http.request(
      { host: url.hostname, port: url.port, path: url.pathname + url.search, method: req.method, headers: req.headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end('upstream-fail');
    });
    req.pipe(upstream);
  };

  const globalProxy = http.createServer((req, res) => {
    globalHits += 1;
    if (globalFails) {
      res.writeHead(502);
      res.end('global-fail');
      return;
    }
    forward(req, res);
  });
  globalProxy.listen(0, '127.0.0.1');
  await once(globalProxy, 'listening');
  t.after(() => globalProxy.close());

  const platformProxy = http.createServer((req, res) => {
    platformHits += 1;
    if (platformFails) {
      res.writeHead(502);
      res.end('platform-fail');
      return;
    }
    forward(req, res);
  });
  platformProxy.listen(0, '127.0.0.1');
  await once(platformProxy, 'listening');
  t.after(() => platformProxy.close());

  process.env.PROXY = `http://127.0.0.1:${globalProxy.address().port}`;
  process.env.AS_PROXY = `http://127.0.0.1:${platformProxy.address().port}`;

  assert.equal(
    await fetchResource(`${targetBase}/animesaturn`, createCaches(), { timeoutMs: 5000 }),
    'target-ok'
  );
  assert.equal(platformHits, 1, 'AS_PROXY deve essere il primo hop');
  assert.equal(globalHits, 0, 'PROXY non deve essere usato se AS_PROXY risponde');

  platformFails = true;
  assert.equal(
    await fetchResource(`${targetBase}/animesaturn-fallback`, createCaches(), { timeoutMs: 5000 }),
    'target-ok'
  );
  assert.equal(platformHits, 2, 'AS_PROXY deve essere tentato per primo anche se fallisce');
  assert.equal(globalHits, 1, 'PROXY deve essere il secondo hop');

  platformFails = false;
  platformHits = 0;
  globalHits = 0;
  assert.equal(
    await fetchResource(`${targetBase}/hls-cdn`, createCaches(), {
      proxyPlatform: 'animesaturn',
      timeoutMs: 5000,
    }),
    'target-ok',
    'proxyPlatform deve applicare la catena anche a un host CDN'
  );
  assert.equal(platformHits, 1);
  assert.equal(globalHits, 0);

  platformFails = true;
  globalFails = true;
  assert.equal(
    await fetchResource(`${targetBase}/animesaturn-direct`, createCaches(), { timeoutMs: 5000 }),
    'target-ok',
    'con entrambi i proxy non raggiungibili si deve usare il diretto'
  );

  delete process.env.PROXY;
  delete process.env.AS_PROXY;
  platformHits = 0;
  globalHits = 0;
  assert.equal(
    await fetchResource(`${targetBase}/animesaturn-no-proxy`, createCaches(), { timeoutMs: 5000 }),
    'target-ok',
    'senza proxy configurati si deve andare diretti'
  );
  assert.equal(platformHits + globalHits, 0);
});

test('i proxy valgono appena sono impostati, senza interruttore', async (t) => {
  const savedProxy = process.env.PROXY;
  t.after(() => {
    if (savedProxy === undefined) delete process.env.PROXY;
    else process.env.PROXY = savedProxy;
  });

  const target = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('direct');
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  t.after(() => target.close());

  let proxyHits = 0;
  const proxy = http.createServer((req, res) => {
    proxyHits += 1;
    req.resume();
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('proxied');
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  t.after(() => proxy.close());

  process.env.PROXY = `http://127.0.0.1:${proxy.address().port}`;

  const body = await fetchResource(`http://127.0.0.1:${target.address().port}/direct`, createCaches(), { timeoutMs: 5000 });
  assert.equal(body, 'proxied');
  assert.equal(proxyHits, 1, 'PROXY impostato deve essere usato senza altri flag');
});

test('fetchWithTimeout routes requests through a real forward proxy', async (t) => {
  const target = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('through-proxy');
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const targetUrl = `http://127.0.0.1:${target.address().port}/`;

  let forwarded = 0;
  let connects = 0;
  // Minimal forward proxy: absolute-form GET in, CONNECT counted and refused.
  const proxy = http.createServer((req, res) => {
    forwarded += 1;
    const url = new URL(req.url);
    const upstream = http.request(
      { host: url.hostname, port: url.port, path: url.pathname + url.search, method: req.method, headers: req.headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end('bad gateway');
    });
    req.pipe(upstream);
  });
  proxy.on('connect', (_req, socket) => {
    connects += 1;
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');

  const agent = new ProxyAgent(`http://127.0.0.1:${proxy.address().port}`);
  t.after(() => {
    agent.close();
    proxy.close();
    target.close();
  });

  // http://: undici sends an absolute-form request through the proxy.
  const direct = await fetchWithTimeout(targetUrl, {});
  assert.equal(direct.status, 200, 'native fetch branch still works');
  const res = await fetchWithTimeout(targetUrl, { agent }, 5000);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'through-proxy');
  assert.equal(forwarded, 1, 'one request must reach the proxy');

  // https://: undici tunnels with CONNECT. The stub refuses, so the fetch rejects,
  // but the CONNECT reaching the proxy proves the dispatcher was used.
  await assert.rejects(fetchWithTimeout('https://example.invalid/', { agent }, 3000), (err) => {
    assert.doesNotMatch(errorChainText(err), /UND_ERR_INVALID_ARG/, 'the ProxyAgent dispatcher must be accepted');
    return true;
  });
  assert.equal(connects, 1, 'one CONNECT must reach the proxy');
});

test('il badge FHD sta accanto al nome del provider, non nel titolo', () => {
  const plain = providerLabel('animeunity');
  assert.ok(plain.endsWith('Anime Unity'), 'nome provider');
  assert.ok(!plain.includes('\u001b['), 'senza badge non ci sono codici colore');
  const fhd = providerLabel('animeunity', true);
  // Solo le lettere in cerchi: niente colore, niente ANSI.
  assert.ok(fhd.includes('\u{1F155}\u{1F157}\u{1F153}'), 'badge con lettere in cerchi');
  assert.ok(fhd.startsWith(`${plain} `), 'badge dopo il nome');
  assert.ok(!fhd.includes('\u001b['), 'niente codici ANSI nel nome');
  assert.ok(!fhd.includes('\u{1F7E5}'), 'niente quadrato');
  // Gli altri provider non cambiano.
  assert.equal(providerLabel('animeworld', true), providerLabel('animeworld'));
});
