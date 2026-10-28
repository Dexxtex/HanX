import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

const { sendHtmlResponse } = await import('../../dist/utils/http.js');
const { detectPublicBaseUrl, withInstanceAssets } = await import('../../dist/utils/public-url.js');

function fakeRes() {
  const headers = {};
  const out = { headers, body: undefined, sent: false };
  out.res = {
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    send: (body) => { out.body = body; out.sent = true; },
  };
  return out;
}

const bigHtml = `<html><body>${'<p>configurazione</p>'.repeat(200)}</body></html>`;

test('comprime la landing quando il client accetta gzip', async () => {
  const r = fakeRes();
  await sendHtmlResponse({ headers: { 'accept-encoding': 'gzip, deflate' } }, r.res, bigHtml);
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(gunzipSync(r.body).toString('utf8'), bigHtml);
});

test('non comprime senza accept-encoding', async () => {
  const r = fakeRes();
  await sendHtmlResponse({ headers: {} }, r.res, bigHtml);
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.body, bigHtml);
});

test('non comprime un payload sotto la soglia', async () => {
  const r = fakeRes();
  await sendHtmlResponse({ headers: { 'accept-encoding': 'gzip' } }, r.res, '<html>ok</html>');
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.body, '<html>ok</html>');
});

test('imposta Vary anche quando non comprime', async () => {
  const r = fakeRes();
  await sendHtmlResponse({ headers: {} }, r.res, bigHtml);
  assert.equal(r.headers['vary'], 'Accept-Encoding');
});

test('detectPublicBaseUrl usa host e porta della richiesta', () => {
  assert.equal(
    detectPublicBaseUrl({ host: '192.168.1.10:7000', protocol: 'http' }),
    'http://192.168.1.10:7000'
  );
  assert.equal(
    detectPublicBaseUrl({ forwardedHost: 'hanx.example.com', forwardedProto: 'https' }),
    'https://hanx.example.com'
  );
  // Senza porta e senza header di proxy il browser sa meglio dell'addon.
  assert.equal(detectPublicBaseUrl({ host: 'hanx.example.com' }), '');
});

test('withInstanceAssets punta icona e sfondo all istanza', () => {
  const manifest = { id: 'org.stremio.hanx', name: 'HanX' };
  assert.deepEqual(withInstanceAssets(manifest, 'http://192.168.1.10:7000/'), {
    id: 'org.stremio.hanx',
    name: 'HanX',
    logo: 'http://192.168.1.10:7000/public/icon.png',
    icon: 'http://192.168.1.10:7000/public/icon.png',
    favicon: 'http://192.168.1.10:7000/public/icon.png',
    background: 'http://192.168.1.10:7000/public/background.png',
  });
});

test('withInstanceAssets non tocca loghi personalizzati e non inventa URL senza base', () => {
  const custom = { logo: 'https://cdn.example/logo.png', icon: 'https://cdn.example/logo.png' };
  const withCustom = withInstanceAssets(custom, 'https://hanx.example.com');
  assert.equal(withCustom.logo, 'https://cdn.example/logo.png');
  assert.equal(withCustom.icon, 'https://cdn.example/logo.png');
  // favicon e background mancavano: arrivano dall'istanza.
  assert.equal(withCustom.favicon, 'https://hanx.example.com/public/icon.png');
  assert.equal(withCustom.background, 'https://hanx.example.com/public/background.png');

  const untouched = { id: 'x' };
  assert.deepEqual(withInstanceAssets(untouched, ''), untouched);
});
