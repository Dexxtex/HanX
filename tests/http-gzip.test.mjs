import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

const { sendHtmlResponse } = await import('../dist/utils/http.js');

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
