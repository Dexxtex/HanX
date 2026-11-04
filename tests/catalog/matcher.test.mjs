import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { lookupTitle, matchTitle } from '../../dist/catalog/matcher.js';

// Fixture: ogni test punta CATALOG_DIR a una cartella temporanea, nessuna rete.

const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

function fixture({ generatedAt = NOW, sites = {}, truncated = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-match-'));
  const file = path.join(dir, 'catalog-titles.json');
  fs.writeFileSync(file, JSON.stringify({ generatedAt, sites, truncated }));
  process.env.CATALOG_DIR = dir;
  return { dir, file };
}

const entry = (title, slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), extra = {}) => ({
  slug,
  url: `https://example.test/${slug}`,
  title,
  key: '',
  ...extra,
});

test('match esatto: hit a punteggio 1 e forma { slug, url, score }', () => {
  fixture({ sites: { saturn: [entry('Tutor Hitman Reborn')] } });
  const hit = matchTitle('saturn', ['Tutor Hitman Reborn']);
  assert.deepEqual(hit, {
    slug: 'tutor-hitman-reborn',
    url: 'https://example.test/tutor-hitman-reborn',
    score: 1,
  });
  const lookup = lookupTitle('saturn', ['Tutor Hitman Reborn']);
  assert.equal(lookup.hits.length, 1);
  // authoritative parla solo dell'assenza: con un match non decide nulla.
  assert.equal(lookup.authoritative, false);
});

test('prefisso del sito: "Reborn!" trova "Tutor Hitman Reborn"', () => {
  fixture({ sites: { saturn: [entry('Tutor Hitman Reborn')], world: [entry('Katekyo Hitman Reborn')] } });
  assert.equal(lookupTitle('saturn', ['Reborn!']).hits[0].score, 0.9);
  assert.equal(lookupTitle('world', ['Reborn!']).hits[0].slug, 'katekyo-hitman-reborn');
});

test('Mission-E: la stopword dentro il composto non rompe il match', () => {
  fixture({ sites: { unity: [entry('Mission-E')] } });
  assert.equal(lookupTitle('unity', ['MissionE']).hits[0].score, 1);
  assert.equal(matchTitle('unity', ['Mission-E']).score, 1);
});

test('fascia 0.5-0.8: il risultato non si usa e il catalogo non è autorevole', () => {
  fixture({ sites: { saturn: [entry('The Three Titans Battle')] } });
  const lookup = lookupTitle('saturn', ['The Three Deities Battle']);
  assert.equal(lookup.hits.length, 0);
  assert.equal(lookup.authoritative, false);
});

test('catalogo vecchio: niente verdetto, si torna alla rete', () => {
  fixture({ generatedAt: OLD, sites: { saturn: [entry('Tutor Hitman Reborn')] } });
  const lookup = lookupTitle('saturn', ['Un titolo che non c\'è']);
  assert.deepEqual(lookup.hits, []);
  assert.equal(lookup.authoritative, false);
  assert.equal(lookup.generatedAt, OLD);
  // Il match esatto resta disponibile anche con il catalogo vecchio.
  assert.equal(lookupTitle('saturn', ['Tutor Hitman Reborn']).hits[0].score, 1);
});

test('titolo assente da un catalogo fresco: nessuna richiesta di rete', () => {
  fixture({ sites: { saturn: [entry('Tutor Hitman Reborn')] } });
  const lookup = lookupTitle('saturn', ['Gette Robo']);
  assert.deepEqual(lookup.hits, []);
  assert.equal(lookup.authoritative, true);
});

test('catalogo troncato: non è autorevole (AnimeWorld)', () => {
  fixture({ sites: { world: [entry('Absolute Duo')] }, truncated: { world: true } });
  assert.equal(lookupTitle('world', ['Un titolo che non c\'è']).authoritative, false);
});

test('catalogo assente (file mancante): si torna alla rete', () => {
  process.env.CATALOG_DIR = path.join(os.tmpdir(), 'hanx-match-manca');
  const lookup = lookupTitle('unity', ['MissionE']);
  assert.deepEqual(lookup.hits, []);
  assert.equal(lookup.authoritative, false);
  assert.equal(lookup.generatedAt, null);
});

test('titoli alternativi: il romaji trova la scheda col nome inglese', () => {
  fixture({
    sites: { unity: [entry('Frieren: Beyond Journey\'s End', '1-frieren', { aliases: ['Sousou no Frieren'] })] },
  });
  const lookup = lookupTitle('unity', ['Sousou no Frieren']);
  assert.equal(lookup.hits[0].score, 1);
  assert.equal(lookup.hits[0].slug, '1-frieren');
});

test('solo le schede col punteggio migliore, con il tipo della scheda', () => {
  fixture({
    sites: {
      unity: [
        entry('Tutor Hitman Reborn', '1-reborn', { type: 'TV' }),
        entry('Tutor Hitman Reborn Movie', '2-reborn-movie', { type: 'Movie' }),
      ],
    },
  });
  const lookup = lookupTitle('unity', ['Tutor Hitman Reborn']);
  assert.equal(lookup.hits.length, 1);
  assert.equal(lookup.hits[0].type, 'TV');
});

test('la cache si invalida quando il file cambia', () => {
  const { file } = fixture({ sites: { saturn: [entry('Uno')] } });
  assert.equal(lookupTitle('saturn', ['Due']).hits.length, 0);
  fs.writeFileSync(file, JSON.stringify({ generatedAt: NOW, sites: { saturn: [entry('Due')] }, truncated: {} }));
  const later = new Date(Date.now() + 1000);
  fs.utimesSync(file, later, later);
  assert.equal(lookupTitle('saturn', ['Due']).hits.length, 1);
});
