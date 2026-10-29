import assert from 'node:assert/strict';
import { test } from 'node:test';

const { unifyStreams, providerRank } = await import('../../dist/utils/streamTitle.js');

// Un campione per provider, nel formato che i provider producono davvero,
// più il caso proxy/FHD: le regex non erano testabili dentro la closure.

test('unifyStreams: pulizia titolo AnimeSaturn (SUB via bullet)', () => {
  const [out] = unifyStreams([{
    title: "L'attacco dei Giganti ▪ SUB ▪ S1E5 (Snow-Ravine)",
    url: 'https://stream.example/720p.m3u8',
  }], '🪐 Anime Saturn');

  assert.equal(out.title, "🎞️ L'attacco dei Giganti ▪ S1E5 (Snow-Ravine)\n🎧 SUB\n🛡️ Proxy (OFF)");
  assert.equal(out.name, '🪐 Anime Saturn');
  assert.equal(out.behaviorHints.bingeGroup, 'animesaturn-std-sub');
});

test('unifyStreams: titolo AnimeWorld ITA e proxy rilevato dal path EasyProxy', () => {
  const [out] = unifyStreams([{
    title: 'Solo Leveling ▪ ITA ▪ S1E1',
    url: 'https://epx.example/proxy/stream.mp4',
  }], '🌍 Anime World');

  assert.equal(out.title, '🎞️ Solo Leveling ▪ S1E1\n🎧 ITA\n🛡️ Proxy (ON)');
  assert.equal(out.name, '🌍 Anime World');
  assert.equal(out.behaviorHints.bingeGroup, 'animeworld-std-ita');
});

test('unifyStreams: riga AnimeUnity con marker, 💾 size/res e lock icon FHD', () => {
  const raw = ['[ITA] Mio Titolo 🔓', '💾 1.58Gb • 1080p'].join('\n');
  const [out] = unifyStreams([{
    title: raw,
    url: 'https://cdn.example/kirby.mp4',
    name: '🎴 Anime Unity 🅕🅗🅓',
    behaviorHints: { notWebReady: true },
  }], '🎴 Anime Unity');

  assert.equal(out.title, '🎞️ Mio Titolo\n🎧 ITA\n📦 1.58GB 🖥️ 1080p\n🛡️ Proxy (OFF)');
  // Il nome del provider passa intatto: anche il badge FHD resta nel nome.
  assert.equal(out.name, '🎴 Anime Unity 🅕🅗🅓');
  assert.deepEqual(out.behaviorHints, { notWebReady: true, bingeGroup: 'animeunity-std-ita' });
});

test('providerRank: ordine Anime Unity, Anime Saturn, Anime World, resto', () => {
  assert.equal(providerRank('🎴 Anime Unity 🅕🅗🅓'), 1);
  assert.equal(providerRank('🪐 Anime Saturn'), 2);
  assert.equal(providerRank('🌍 Anime World'), 3);
  assert.equal(providerRank('Algolia'), 50);
});
