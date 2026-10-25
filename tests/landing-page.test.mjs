import assert from 'node:assert/strict';
import { test } from 'node:test';

const { landingTemplate } = await import('../dist/landingPage.js');

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
