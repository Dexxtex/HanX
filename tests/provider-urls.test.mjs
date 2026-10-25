import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

process.env.ANIMEWORLD_BASE_URL = 'https://env.example';
const { getProviderUrl } = await import('../dist/providers/anime-core/provider-urls.js');
const providerUrls = JSON.parse(readFileSync(new URL('../config/provider_urls.json', import.meta.url), 'utf8'));

test('getProviderUrl: env esplicito batte file JSON e domains.json', () => {
  assert.equal(
    getProviderUrl('animeworld', ['ANIMEWORLD_BASE_URL', 'AW_BASE_URL']),
    'https://env.example'
  );
});

test('getProviderUrl: senza env usa il file JSON locale, non domains.json', () => {
  assert.equal(
    getProviderUrl('animeworld', []),
    String(providerUrls.animeworld).replace(/\/+$/, '')
  );
});
