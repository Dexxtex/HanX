import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { cardBase, languageOf, lookupTitle, matchTitle, seasonOf } from '../../dist/catalog/matcher.js';

// Fixture: ogni test punta CATALOG_DIR a una cartella temporanea, nessuna rete.

const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

function fixture({ generatedAt = NOW, sites = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-match-'));
  const file = path.join(dir, 'catalog-titles.json');
  fs.writeFileSync(file, JSON.stringify({ generatedAt, sites }));
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
  assert.deepEqual(matchTitle('saturn', ['Tutor Hitman Reborn']), {
    slug: 'tutor-hitman-reborn',
    url: 'https://example.test/tutor-hitman-reborn',
    score: 1,
  });
});

test('a) le varianti ita/sub sono schede diverse: si servono entrambe con l etichetta', () => {
  fixture({ sites: { saturn: [entry('Tutor Hitman Reborn'), entry('Tutor Hitman Reborn (ITA)')] } });
  const { hits } = lookupTitle('saturn', ['Tutor Hitman Reborn'], { season: 1 });
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((hit) => hit.language).sort(), ['ITA', 'SUB ITA']);
  assert.equal(new Set(hits.map((hit) => cardBase(hit.title))).size, 1);
});

test('a) cardBase toglie id numerico di Unity, lingua e punteggiatura', () => {
  assert.equal(cardBase('4354 Mou Ippon!'), cardBase('Mou Ippon! (ITA)'));
  assert.equal(cardBase('Dr. Stone 3'), cardBase('dr stone 3'));
  assert.notEqual(cardBase('Aquarion'), cardBase('Aquarion Evol'));
  assert.equal(languageOf('X (ITA)'), 'ITA');
  assert.equal(languageOf('X (CR)'), 'CR ITA');
  assert.equal(languageOf('X'), 'SUB ITA');
});

test('b) seasonOf: "part 2" non è la stagione', () => {
  assert.equal(seasonOf('Dr. Stone 3 Part 2'), 3);
  assert.equal(seasonOf('Mushoku Tensei 2 Part 2'), 2);
  assert.equal(seasonOf('Hotel Inhumans 2'), 2);
  assert.equal(seasonOf('86 Eighty Six'), null);
  assert.equal(seasonOf('4354 Dr Stone 2'), 2);
});

test('b) dr stone 2 contro dr stone 3 part 2: senza stagione resta ambiguo', () => {
  fixture({ sites: { saturn: [entry('Dr Stone 2'), entry('Dr Stone 3 Part 2')] } });
  const { hits } = lookupTitle('saturn', ['dr stone 2']);
  assert.deepEqual(hits, []);
});

test('b) la stagione richiesta sceglie la scheda giusta', () => {
  fixture({ sites: { saturn: [entry('Dr Stone 2'), entry('Dr Stone 3 Part 2')] } });
  const due = lookupTitle('saturn', ['dr stone 2'], { season: 2 });
  assert.deepEqual(due.hits.map((hit) => hit.slug), ['dr-stone-2']);
  // Con la stagione 3 deve vincere l'altra: con la stagione letta male ("part 2" = 2) uscirebbe vuoto.
  const tre = lookupTitle('saturn', ['dr stone 3 part 2'], { season: 3 });
  assert.deepEqual(tre.hits.map((hit) => hit.slug), ['dr-stone-3-part-2']);
});

test('b) una scheda con stagione diversa non si serve nemmeno da sola', () => {
  fixture({ sites: { unity: [entry('Dr Stone 3 Part 2')] } });
  assert.deepEqual(lookupTitle('unity', ['dr stone 2'], { season: 2 }).hits, []);
});

test('b) senza numero vale stagione 1 solo se un altra scheda è numerata', () => {
  fixture({
    sites: {
      saturn: [
        entry('Katekyo Hitman Reborn', 'reborn', { aliases: ['Reborn!'] }),
        entry('Tutor Hitman Reborn 2', 'reborn-2', { aliases: ['Reborn!'] }),
      ],
    },
  });
  assert.deepEqual(lookupTitle('saturn', ['Reborn!'], { season: 1 }).hits.map((hit) => hit.slug), ['reborn']);
  assert.deepEqual(lookupTitle('saturn', ['Reborn!'], { season: 2 }).hits.map((hit) => hit.slug), ['reborn-2']);
  // Nessuna delle due dichiara un numero: non si inventa la stagione 1.
  fixture({ sites: { saturn: [entry('Katekyo Hitman Reborn', 'reborn'), entry('Tutor Hitman Reborn', 'tutor')] } });
  assert.deepEqual(lookupTitle('saturn', ['Reborn!'], { season: 1 }).hits, []);
});

test('c) film e serie si scelgono col tipo della richiesta', () => {
  fixture({ sites: { saturn: [entry('Tutor Hitman Reborn'), entry('Katekyo Hitman Reborn Movie')] } });
  // Senza stagione: nessuna delle due la dichiara, quindi non si inventa la 1.
  const serie = lookupTitle('saturn', ['Reborn!']);
  assert.deepEqual(serie.hits.map((hit) => hit.slug), ['tutor-hitman-reborn']);
  const film = lookupTitle('saturn', ['Reborn!'], { isMovie: true });
  assert.deepEqual(film.hits.map((hit) => hit.slug), ['katekyo-hitman-reborn-movie']);
  const stagioneZero = lookupTitle('saturn', ['Reborn!'], { season: 0 });
  assert.deepEqual(stagioneZero.hits.map((hit) => hit.slug), ['katekyo-hitman-reborn-movie']);
});

test('d) stessa base con nome diverso: non si serve, e il log è una riga JSON', () => {
  const dir = fixture({ sites: { saturn: [entry('Tutor Hitman Reborn'), entry('Katekyo Hitman Reborn')] } }).dir;
  assert.deepEqual(lookupTitle('saturn', ['Reborn!'], { season: 1 }).hits, []);

  const script = `
    const { lookupTitle } = await import(${JSON.stringify(pathToFileURL(path.resolve('dist/catalog/matcher.js')).href)});
    const r = lookupTitle('saturn', ['Reborn!'], { season: 1 });
    process.exit(r.hits.length ? 1 : 0);
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, DEBUG_LEVEL: '2', CATALOG_DIR: dir },
  });
  const lines = out.trim().split('\n').filter((line) => line.includes('catalog-lookup'));
  assert.equal(lines.length, 1, out);
  const payload = JSON.parse(lines[0].slice(lines[0].indexOf('{')));
  assert.deepEqual(Object.keys(payload), ['t', 'site', 'query', 'slug', 'score', 'band', 'served', 'tie']);
  assert.equal(payload.t, 'catalog-lookup');
  assert.equal(payload.served, false);
  assert.equal(payload.band, 'auto');
  assert.equal(payload.query, 'Reborn!');
  assert.equal(payload.tie.length, 2);
  assert.ok(payload.tie.every((item) => Object.keys(item).sort().join() === 'score,slug'));
});

test('e) il log non supera 5 titoli', () => {
  const cards = ['Shin Reborn', 'Tutor Reborn', 'Katekyo Reborn', 'Mini Reborn', 'Reborn Again', 'Reborn Final', 'Reborn X'];
  const dir = fixture({ sites: { saturn: cards.map((title, i) => entry(title, `s${i}`)) } }).dir;
  const script = `
    const { lookupTitle } = await import(${JSON.stringify(pathToFileURL(path.resolve('dist/catalog/matcher.js')).href)});
    lookupTitle('saturn', ['Reborn'], {});
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, DEBUG_LEVEL: '2', CATALOG_DIR: dir },
  });
  const line = out.trim().split('\n').find((row) => row.includes('catalog-lookup'));
  assert.ok(line, out);
  assert.ok(JSON.parse(line.slice(line.indexOf('{'))).tie.length <= 5, line);
});

test('lingua: quella dichiarata dal sito vince sulla deduzione dal titolo', () => {
  fixture({
    sites: {
      unity: [
        entry('Sword Art Online', '4579-sword-art-online', { language: 'ITA' }),
        entry('Kiseiju', '4578-kiseiju', { language: 'SUB ITA' }),
        entry('Altro Titolo (ITA)', '4577-altro-titolo'),
      ],
    },
  });
  const hit = (q) => lookupTitle('unity', [q]).hits[0].language;
  assert.equal(hit('Sword Art Online'), 'ITA');
  assert.equal(hit('Kiseiju'), 'SUB ITA');
  // senza il campo si deduce dal titolo, come prima
  assert.equal(hit('Altro Titolo (ITA)'), 'ITA');
});

test('episodi: la scheda troppo corta non contiene la richiesta e si scarta', () => {
  fixture({
    sites: {
      saturn: [
        entry('Dr. Stone', 'dr-stone', { episodes: 24 }),
        entry('Dr. Stone 2', 'dr-stone-2', { episodes: 11 }),
      ],
      world: [entry('One Piece', 'one-piece', { episodes: 1100 })],
    },
  });
  // Stagione 2, episodio 5: la scheda da 11 episodi va bene anche se la serie ne ha 24.
  assert.deepEqual(lookupTitle('saturn', ['Dr. Stone 2'], { season: 2, episode: 5 }).hits.map((h) => h.slug), ['dr-stone-2']);
  // Stagione 2, episodio 15: la scheda da 11 non può contenerlo.
  assert.deepEqual(lookupTitle('saturn', ['Dr. Stone 2'], { season: 2, episode: 15 }).hits, []);
  // Monostagione da 1.100 episodi: l episodio assoluto passa.
  assert.deepEqual(lookupTitle('world', ['One Piece'], { episode: 1090 }).hits.map((h) => h.slug), ['one-piece']);
});

test('episodi: senza conteggio non si scarta niente, e il filtro vale anche per il malId', () => {
  fixture({ sites: { unity: [
    entry('Serie Senza Conteggio', 'senza-conteggio'),
    entry('Corta', 'corta', { episodes: 12, malId: 777 }),
  ] } });
  assert.equal(lookupTitle('unity', ['Serie Senza Conteggio'], { episode: 500 }).hits.length, 1);
  assert.deepEqual(lookupTitle('unity', ['niente'], { malId: 777, episode: 15 }).hits, []);
  assert.deepEqual(lookupTitle('unity', ['niente'], { malId: 777, episode: 3 }).hits.map((h) => h.slug), ['corta']);
});

test('malId: l id esatto vince sul titolo, senza fuzzy', () => {
  fixture({ sites: { unity: [entry('Mou Ippon!', '4354-mou-ippon', { malId: 52034 })] } });
  const lookup = lookupTitle('unity', ['Titolo Che Non C Entra Nulla'], { malId: 52034 });
  assert.equal(lookup.hits.length, 1);
  assert.equal(lookup.hits[0].slug, '4354-mou-ippon');
  assert.equal(lookup.hits[0].score, 1);
});

test('malId: ITA e SUB della stessa opera si servono entrambe', () => {
  fixture({
    sites: {
      unity: [
        entry('Mou Ippon!', '4354-mou-ippon', { malId: 52034 }),
        entry('Mou Ippon! (ITA)', '4355-mou-ippon-ita', { malId: 52034 }),
      ],
    },
  });
  const lookup = lookupTitle('unity', ['niente'], { malId: 52034 });
  assert.deepEqual(lookup.hits.map((hit) => hit.language).sort(), ['ITA', 'SUB ITA']);
});

test('malId: se l indice non ce l ha si torna al titolo', () => {
  fixture({ sites: { unity: [entry('Mou Ippon!', '4354-mou-ippon', { malId: 52034 })] } });
  assert.deepEqual(lookupTitle('unity', ['niente che matchi'], { malId: 99999 }).hits, []);
  assert.equal(lookupTitle('unity', ['Mou Ippon!'], { malId: 99999 }).hits[0].slug, '4354-mou-ippon');
});

test('malId: vince anche sulla stagione dichiarata nella scheda', () => {
  fixture({ sites: { unity: [entry('Mou Ippon! 2', '4354-mou-ippon-2', { malId: 52034 })] } });
  const lookup = lookupTitle('unity', ['niente'], { season: 1, malId: 52034 });
  assert.deepEqual(lookup.hits.map((hit) => hit.slug), ['4354-mou-ippon-2']);
});

test('fascia 0.5-0.8: il risultato non si usa', () => {
  fixture({ sites: { saturn: [entry('The Three Titans Battle')] } });
  assert.deepEqual(lookupTitle('saturn', ['The Three Deities Battle'], { season: 1 }).hits, []);
});

test('catalogo vecchio: i match restano validi, l assenza non ha verdetto', () => {
  fixture({ generatedAt: OLD, sites: { saturn: [entry('Tutor Hitman Reborn')] } });
  const absent = lookupTitle('saturn', ['Un titolo che non esiste']);
  assert.deepEqual(absent.hits, []);
  assert.equal(absent.generatedAt, OLD);
  assert.equal('authoritative' in absent, false);
  assert.equal(lookupTitle('saturn', ['Tutor Hitman Reborn']).hits[0].score, 1);
});

test('titolo assente e catalogo mancante: nessun match', () => {
  fixture({ sites: { saturn: [entry('Tutor Hitman Reborn')] } });
  assert.deepEqual(lookupTitle('saturn', ['Getter Robo']).hits, []);
  process.env.CATALOG_DIR = path.join(os.tmpdir(), 'hanx-match-manca');
  const missing = lookupTitle('unity', ['MissionE']);
  assert.deepEqual(missing.hits, []);
  assert.equal(missing.generatedAt, null);
});

test('titoli alternativi: il romaji trova la scheda col nome inglese', () => {
  fixture({
    sites: { unity: [entry('Frieren: Beyond Journey\'s End', '1-frieren', { aliases: ['Sousou no Frieren'] })] },
  });
  const lookup = lookupTitle('unity', ['Sousou no Frieren'], { season: 1 });
  assert.equal(lookup.hits[0].score, 1);
  assert.equal(lookup.hits[0].slug, '1-frieren');
  assert.equal(lookup.hits[0].language, 'SUB ITA');
});

test('solo le schede col punteggio migliore, con tipo e lingua', () => {
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
  assert.equal(lookup.hits[0].language, 'SUB ITA');
});

test('Mission-E: la stopword dentro il composto non rompe il match', () => {
  fixture({ sites: { unity: [entry('Mission-E')] } });
  assert.equal(lookupTitle('unity', ['MissionE'], { season: 1 }).hits[0].score, 1);
});

test('prefisso del sito: "Reborn!" trova "Tutor Hitman Reborn"', () => {
  fixture({ sites: { saturn: [entry('Tutor Hitman Reborn')] } });
  assert.equal(lookupTitle('saturn', ['Reborn!']).hits[0].score, 0.9);
});

test('la cache si invalida quando il file cambia', () => {
  const { file } = fixture({ sites: { saturn: [entry('Uno')] } });
  assert.equal(lookupTitle('saturn', ['Due']).hits.length, 0);
  fs.writeFileSync(file, JSON.stringify({ generatedAt: NOW, sites: { saturn: [entry('Due')] } }));
  const later = new Date(Date.now() + 1000);
  fs.utimesSync(file, later, later);
  assert.equal(lookupTitle('saturn', ['Due']).hits.length, 1);
});

// L'indice token->schede evita di scandire tutto il catalogo a ogni lookup. Deve
// essere un sovrainsieme esatto: ogni percorso con cui `titleMatchScore` può dare
// un punteggio > 0 deve restare raggiungibile, altrimenti la scheda sparisce.
test('indice token: ogni percorso di match resta raggiungibile', () => {
  fixture({
    sites: {
      saturn: [
        entry('Kimetsu no Yaiba: Yuukaku-hen', 'kimetsu', {
          key: 'kimetsunoyaibayuukakuhen',
          aliases: ['Demon Slayer: Entertainment District Arc'],
        }),
        entry('Mission-E', 'mission-e'),
        entry('Tutor Hitman Reborn!', 'reborn'),
        entry('Tokyo Revengers: Santen Sensou-hen', 'tr-arc'),
        entry('Tokyo Revengers: Santen Sensou-hen (ITA)', 'tr-arc-ita'),
        entry('Tokyo Revengers', 'tr-base'),
      ],
    },
  });

  // Chiave compatta: il match non passa dai token.
  assert.equal(lookupTitle('saturn', ['Kimetsu no Yaiba Yuukakuhen']).hits[0]?.slug, 'kimetsu');
  // Alias: la query inglese non combacia col titolo romaji, ma con l'alias sì.
  assert.equal(
    lookupTitle('saturn', ['Demon Slayer: Entertainment District Arc']).hits[0]?.slug,
    'kimetsu'
  );
  // Concatenato: "MissionE" combacia solo grazie alla forma senza trattino.
  assert.equal(lookupTitle('saturn', ['MissionE']).hits[0]?.slug, 'mission-e');
  // Prefisso del sito.
  assert.equal(lookupTitle('saturn', ['Reborn!']).hits[0]?.slug, 'reborn');
  // Arco contro serie madre: vince l'arco, e la variante ITA resta servita.
  const arc = lookupTitle('saturn', ['Tokyo Revengers: Santen Sensou-hen']);
  assert.deepEqual(arc.hits.map((h) => h.slug).sort(), ['tr-arc', 'tr-arc-ita']);
});

test('indice token: nessun match inventato su un titolo estraneo', () => {
  fixture({
    sites: { saturn: [entry('Tokyo Revengers'), entry('Kimetsu no Yaiba'), entry('One Piece')] },
  });
  assert.equal(lookupTitle('saturn', ['Bleach']).hits.length, 0);
});

// Un token solo e corto non basta a identificare un'opera per coda: il catalogo
// serviva Wolf Children al posto di "Yuki: Snow Fairy" (visto live 09/11/2026).
test('un token corto non combacia con la coda di un titolo piu lungo', () => {
  fixture({ sites: { saturn: [entry('Wolf Children - Ame e Yuki i bambini lupo', 'wolf', { aliases: ['Ookami Kodomo no Ame to Yuki'] })] } });
  assert.deepEqual(lookupTitle('saturn', ['Yuki: Snow Fairy', 'Yuki'], { season: null, isMovie: true }).hits, []);
  // Il prefisso-rumore resta valido quando la query ha identità sufficiente.
  assert.deepEqual(
    lookupTitle('saturn', ['Ame to Yuki'], { season: null, isMovie: true }).hits.map((h) => h.slug),
    ['wolf']
  );
});

// Per un film non si serve la serie omonima: "Yu-Gi-Oh!: The Movie" combaciava
// con la scheda "Yu-Gi-Oh!" perché "movie" veniva tolto dai token della query.
test('film: la serie omonima non risponde alla richiesta del film', () => {
  fixture({ sites: { saturn: [entry('Yu-Gi-Oh!', 'yu-gi-oh'), entry('Yu-Gi-Oh! Sevens', 'yu-gi-oh-sevens')] } });
  assert.deepEqual(lookupTitle('saturn', ['Yu-Gi-Oh!: The Movie'], { isMovie: true }).hits, []);
  // La scheda del film, quando c'è, resta raggiungibile.
  fixture({ sites: { saturn: [entry('Yu-Gi-Oh!', 'yu-gi-oh'), entry('Yu-Gi-Oh! The Movie', 'yu-gi-oh-movie')] } });
  assert.deepEqual(
    lookupTitle('saturn', ['Yu-Gi-Oh!: The Movie'], { isMovie: true }).hits.map((h) => h.slug),
    ['yu-gi-oh-movie']
  );
});
