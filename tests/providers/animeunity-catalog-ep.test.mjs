import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Il catalogo può portare le coppie [numero, id] degli episodi: con quelle il
// provider non scarica la pagina della scheda, che è un hop sull'host AnimeUnity
// (2 s di pacing). Qui si verifica che la pagina NON venga chiesta e che lo
// stream esca lo stesso.

const requested = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input) => {
  const url = String(input);
  requested.push(url);
  // Pagina episodio: porta l'embed. Nessuna pagina scheda ha una risposta in
  // questo mock, quindi se il provider la chiedesse lo stream non uscirebbe.
  if (/\/anime\/\d+-[^/]+\/(90136|90137)$/.test(url)) {
    const lang = url.endsWith('90137') ? 'ita' : 'sub';
    return new Response(
      `<html><body><video-player embed_url="https://vixcloud.cc/embed/${lang}?token=tok-${lang}&amp;expires=1700000000"></video-player></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html' } }
    );
  }
  if (/\/embed\/(sub|ita)/.test(url)) {
    const lang = url.includes('/embed/ita') ? 'ita' : 'sub';
    return new Response(
      `<html><body><script>var player = new Playerjs({ url: "https://vixcloud.cc/playlist/${lang}", 'token': 'tok-${lang}', 'expires': '1700000000' });</script></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html' } }
    );
  }
  return new Response('not found', { status: 404, statusText: 'Not Found' });
};

const NOW = new Date().toISOString();

function useCatalog(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-unity-ep-'));
  fs.writeFileSync(
    path.join(dir, 'catalog-titles.json'),
    JSON.stringify({ generatedAt: NOW, sites: { saturn: [], world: [], unity: entries } })
  );
  process.env.CATALOG_DIR = dir;
  return dir;
}

process.env.ANIMEUNITY_BASE_URL = 'https://www.animeunity.co';

const { AnimeUnityProvider } = await import('../../dist/providers/animeunity-provider.js');

const provider = new AnimeUnityProvider({ enabled: true, proxyUrl: '', proxyPassword: '', tmdbApiKey: '' });

/** La pagina scheda è `/anime/<id>-<slug>` senza id episodio in coda. */
const animePageCalls = () => requested.filter((url) => /\/anime\/\d+-[^/]+$/.test(url));

const SUB_CARD = {
  slug: '7773-tokyo-revengers-war-of-the-three-titans-arc',
  url: 'https://www.animeunity.co/anime/7773-tokyo-revengers-war-of-the-three-titans-arc',
  title: 'Tokyo Revengers: Santen Sensou-hen',
  key: 'tokyorevengerssantensensouhen',
  language: 'SUB ITA',
  type: 'TV',
};
const ITA_CARD = {
  slug: '7774-tokyo-revengers-war-of-the-three-titans-arc-ita',
  url: 'https://www.animeunity.co/anime/7774-tokyo-revengers-war-of-the-three-titans-arc-ita',
  title: 'Tokyo Revengers: Santen Sensou-hen (ITA)',
  key: 'tokyorevengerssantensensouhenita',
  language: 'ITA',
  type: 'TV',
};

test('catalogo con [numero, id]: la pagina scheda non viene chiesta', async () => {
  useCatalog([
    { ...SUB_CARD, ep: [[1, 90136]] },
    { ...ITA_CARD, ep: [[1, 90137]] },
  ]);
  requested.length = 0;

  const { streams } = await provider.handleTitleRequest('Tokyo Revengers: Santen Sensou-hen', 1, 1, false);

  assert.equal(streams.length, 2, 'una stream per lingua');
  assert.deepEqual(
    streams.map((s) => s.url).sort(),
    [
      'https://vixcloud.cc/playlist/ita.m3u8?token=tok-ita&expires=1700000000',
      'https://vixcloud.cc/playlist/sub.m3u8?token=tok-sub&expires=1700000000',
    ]
  );
  assert.deepEqual(animePageCalls(), [], 'la pagina scheda non deve essere chiesta');
  assert.equal(requested.filter((url) => url.endsWith('/90136')).length, 1);
  assert.equal(requested.filter((url) => url.endsWith('/90137')).length, 1);
});

test('catalogo senza ep: si torna alla pagina scheda (comportamento di prima)', async () => {
  useCatalog([{ ...SUB_CARD }, { ...ITA_CARD }]);
  requested.length = 0;

  const { streams } = await provider.handleTitleRequest('Tokyo Revengers: Santen Sensou-hen', 1, 1, false);

  // Il mock non serve le pagine scheda: nessuno stream, ma le richieste devono
  // essere partite, altrimenti il fallback non esisterebbe.
  assert.equal(streams.length, 0);
  assert.ok(animePageCalls().length >= 1, 'senza ep la pagina scheda si chiede');
});

process.on('exit', () => {
  globalThis.fetch = originalFetch;
});
