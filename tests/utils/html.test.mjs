import assert from 'node:assert/strict';
import { test } from 'node:test';

const { decodeHtmlEntities, htmlToText } = await import('../../dist/utils/html.js');
const { decodeHtmlAttribute } = await import('../../dist/providers/animeunity-parsers.js');

// Il bug `&#039;` è stato chiuso solo su AnimeSaturn (04/11) e restava aperto su
// AnimeUnity e sul catalogo, che elencavano cinque entità fisse. Ora c'è una
// sola implementazione e le tre superfici la usano.
test('entità numeriche: tutte, non un elenco', () => {
  assert.equal(decodeHtmlEntities('The World&#039;s Strongest Witch'), "The World's Strongest Witch");
  assert.equal(decodeHtmlEntities('&#8217;'), '\u2019');
  assert.equal(decodeHtmlEntities('&#x27;'), "'");
  assert.equal(decodeHtmlEntities('&amp;#039;'), '&#039;', 'una sola passata: niente doppia decodifica');
});

test('AnimeUnity usa lo stesso decoder del catalogo', () => {
  for (const input of ['&#8217;', '&#x27;', '&#039;', '&nbsp;']) {
    assert.equal(decodeHtmlAttribute(input), decodeHtmlEntities(input), `divergenza su ${input}`);
  }
});

test('htmlToText: tag via, entità decodificate, spazi collassati', () => {
  assert.equal(htmlToText('<b>Titolo</b>  con   spazi'), 'Titolo con spazi');
  assert.equal(htmlToText('The World&#039;s  <i>Witch</i>'), "The World's Witch");
});

test('un entità fuori range non ferma il parse', () => {
  assert.equal(decodeHtmlEntities('a&#999999999;b'), 'ab');
});
