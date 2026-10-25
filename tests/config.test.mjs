import assert from 'node:assert/strict';
import { test } from 'node:test';

const { normalizeBool, normalizeConfig, parseConfigFromArgs, providerCacheKey, providerConfigDigest, resolvePlaybackProxyUrl } = await import('../dist/config.js');

const digest = (password) => providerConfigDigest({
  type: 'series',
  id: 'kitsu:12:1',
  proxyUrl: 'http://proxy.local',
  proxyPassword: password,
  tmdbApiKey: '',
  tvdbApiKey: '',
  tvdbPin: '',
  animeunityEnabled: true,
  animesaturnEnabled: false,
  animeworldEnabled: false,
  animeunityDirect: undefined,
  animeunityProxy: undefined,
  mappingVersion: 'v1',
});

test('parseConfigFromArgs: JSON diretto', () => {
  const config = parseConfigFromArgs(JSON.stringify({
    animeunityEnabled: 'false',
    easyProxyUrl: 'http://proxy.local/',
  }));
  assert.equal(config.animeunityEnabled, false);
  assert.equal(config.easyProxyUrl, 'http://proxy.local');
});

test('parseConfigFromArgs: JSON URL-encoded', () => {
  const config = parseConfigFromArgs(encodeURIComponent(JSON.stringify({
    animesaturnEnabled: 1,
    easyProxyPassword: 'p@ss/word',
  })));
  assert.equal(config.animesaturnEnabled, true);
  assert.equal(config.easyProxyPassword, 'p@ss/word');
});

test('parseConfigFromArgs: Base64', () => {
  const config = parseConfigFromArgs(
    Buffer.from(JSON.stringify({ animeworldEnabled: 'on' }), 'utf8').toString('base64')
  );
  assert.equal(config.animeworldEnabled, true);
});

test('providerCacheKey: password EasyProxy diverse producono chiavi diverse', () => {
  const a = providerCacheKey('series', 'kitsu:12:1', digest('password-a'));
  const b = providerCacheKey('series', 'kitsu:12:1', digest('password-b'));
  assert.notEqual(a, b);
  assert.equal(a, providerCacheKey('series', 'kitsu:12:1', digest('password-a')));
});

test('normalizeBool: 1 attiva, un valore ignoto resta undefined', () => {
  assert.equal(normalizeBool('1'), true);
  assert.equal(normalizeBool('garbage'), undefined);
});

test('resolvePlaybackProxyUrl: link ed env hanno lo stesso peso, il link vince quando c’è', () => {
  assert.equal(resolvePlaybackProxyUrl(undefined, undefined, 'http://env.local/'), 'http://env.local');
  assert.equal(resolvePlaybackProxyUrl(false, 'http://mio.proxy:7860/', 'http://env.local'), 'http://mio.proxy:7860');
  assert.equal(resolvePlaybackProxyUrl(undefined, undefined, undefined), '');
});

test('resolvePlaybackProxyUrl: Direct spegne EasyProxy anche quando arriva dall’env', () => {
  assert.equal(resolvePlaybackProxyUrl(true, undefined, 'http://env.local'), '');
  assert.equal(resolvePlaybackProxyUrl(true, 'http://mio.proxy:7860', 'http://env.local'), '');
  assert.equal(resolvePlaybackProxyUrl('false', undefined, 'http://env.local'), 'http://env.local');
});

test('normalizeConfig: directPlayback sopravvive alla normalizzazione', () => {
  assert.equal(normalizeConfig({ directPlayback: 'true' }).directPlayback, true);
  assert.equal(normalizeConfig({ directPlayback: false }).directPlayback, false);
  assert.equal(normalizeConfig({}).directPlayback, undefined);
});
