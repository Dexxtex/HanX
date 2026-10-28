import assert from 'node:assert/strict';
import { test } from 'node:test';

const { landingTemplate } = await import('../../dist/landingPage.js');

test('landing page: icona da public con versione per la cache', () => {
  const html = landingTemplate({ name: 'HanX', version: '1.0.0', config: [] });
  // Il ?v= cambia quando cambia public/icon.png: senza, il browser tiene
  // l'icona vecchia anche dopo un aggiornamento dell'immagine.
  assert.equal((html.match(/\/public\/icon\.png\?v=[a-z0-9]+/g) || []).length, 3);
});

test('landing page exposes API key fields and four configuration steps', () => {
  const html = landingTemplate({ name: 'HanX', version: '1.0.0', config: [] });

  for (const id of ['tmdbApiKey', 'tvdbApiKey', 'tvdbPin', 'keysSummary']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} must be present`);
  }
  for (const step of ['1', '2', '3', '4']) {
    assert.match(html, new RegExp(`data-pane="${step}"`), `pane ${step} must be present`);
  }

  assert.match(html, /Chiavi API/);
  assert.match(html, /config\[key\] = value/);
  assert.match(html, /keysSummary/);
});

test('landing page offre l\'installazione via Stremio Web per i porti non standard', () => {
  const html = landingTemplate({ name: 'HanX', version: '1.0.0', config: [] });
  // Il link stremio:// perde il porto: con un porto non standard serve la via
  // che passa da web.stremio.com, che accetta la manifest URL intera.
  assert.match(html, /id="installWebLink"/);
  assert.match(html, /web\.stremio\.com\/#\/addons\?addon=/);
});

test('landing page: il config nel path è base64url, non percent-encoded', () => {
  const html = landingTemplate({ name: 'HanX', version: '1.0.0', config: [] });
  // Stremio decodifica il path dei link stremio://: con '%' nel path la
  // richiesta arriva al server con JSON grezzo (e le '/' rompono la route).
  assert.doesNotMatch(html, /encodeURIComponent\(JSON\.stringify\(buildConfig\(\)\)\)/);
  assert.match(html, /toBase64Url\(JSON\.stringify\(buildConfig\(\)\)\)/);

  const source = html.match(/function toBase64Url\(text\) \{[\s\S]*?\n    \}/);
  assert.ok(source, 'toBase64Url must be in the client script');
  const toBase64Url = new Function(`${source[0]}; return toBase64Url;`)();
  const json = JSON.stringify({ easyProxyUrl: 'https://proxy.local/a?b=1', password: 'pàss/word+=' });
  assert.equal(toBase64Url(json), Buffer.from(json, 'utf8').toString('base64url'));
  assert.doesNotMatch(toBase64Url(json), /[%+/=]/);
});

test('landing page: il pulsante Installa in Stremio resta visibile anche con porto custom', () => {
  const html = landingTemplate({ name: 'HanX', version: '1.0.0', config: [] });
  // Stremio 4 conserva la porta, Stremio 5 no: il pulsante diretto resta,
  // il web link si aggiunge come alternativa.
  assert.match(html, /Installa in Stremio/);
  assert.doesNotMatch(html, /installLink'\)\.hidden = true/);
  assert.match(html, /installWebLink\.hidden = !customPort/);
});

test('landing page client script is syntactically valid', () => {
  const html = landingTemplate({ name: 'HanX', version: '1.0.0', config: [] });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 2);
  assert.doesNotThrow(() => new Function(scripts.at(-1)[1]));
});

test('landing page: Direct/Proxy è una scelta unica per tutti e tre i provider', () => {
  const html = landingTemplate({ name: 'HanX', version: '1.0.0', config: [] });

  // Niente più varianti solo-AnimeUnity: la modalità guida tutti i provider.
  assert.doesNotMatch(html, /id="animeunityDirect"/);
  assert.doesNotMatch(html, /id="animeunityProxy"/);
  assert.match(html, /key === 'animeunityDirect' \? mode === 'direct' : mode === 'proxy'/);
  assert.match(html, /config\.directPlayback = mode === 'direct'/);
  assert.match(html, /Tutti e tre i provider in diretta/);
});

test('landing page prefills only env vars that have a matching manifest field', () => {
  const manifest = {
    name: 'HanX',
    version: '1.0.0',
    config: [
      { key: 'tmdbApiKey', default: 'manifest-default' },
      { key: 'tvdbApiKey' },
      { key: 'tvdbPin' },
      { key: 'easyProxyUrl' },
      { key: 'easyProxyPassword' },
    ],
  };

  const html = landingTemplate(manifest, {
    TMDB_API_KEY: ' tmdb-env ',
    TVDB_API_KEY: 'tvdb-env',
    TVDB_PIN: 'pin-env',
    EASYPROXY_URL: ' http://proxy.local/ ',
    EASYPROXY_PASSWORD: 'proxy password',
    UNRELATED_SECRET: 'must-not-leak',
  });

  const match = html.match(/window\.__HANX_PAGE_DATA__ = (\{.*?\});/s);
  assert.ok(match);
  const defaults = JSON.parse(match[1]).defaults;
  assert.deepEqual(defaults, {
    tmdbApiKey: 'tmdb-env',
    tvdbApiKey: 'tvdb-env',
    tvdbPin: 'pin-env',
    easyProxyUrl: 'http://proxy.local/',
    easyProxyPassword: 'proxy password',
  });
  assert.equal(manifest.config[0].default, 'manifest-default');
  assert.equal('default' in manifest.config[1], false);
});
