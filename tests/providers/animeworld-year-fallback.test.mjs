// Regressione 1.1.22: `fd2d4ec` cancellò l'unica assegnazione di
// `_lastKitsuStartDate` spostando handleKitsuRequest in resolve-title. I due
// lettori restarono, `fallbackDate` era sempre undefined e
// fallbackFilterYearSearch (90 righe) non partiva mai — senza un log che lo
// dicesse. Ora il dato arriva come parametro di handleTitleRequest.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { AnimeWorldProvider } = await import('../../dist/providers/animeworld-provider.js');

class FallbackProbe extends AnimeWorldProvider {
  constructor() {
    super({ enabled: true, proxyUrl: '' });
    this.fallbackCalls = [];
  }
  async searchAllVersions() {
    return [];
  }
  async fallbackFilterYearSearch(normalizedTitle, startDate, isMovie, episodeNumber, seasonNumber) {
    this.fallbackCalls.push({ normalizedTitle, startDate, isMovie, episodeNumber, seasonNumber });
    return { streams: [] };
  }
}

test('il ripiego per anno parte quando kitsuStartDate è passato', async () => {
  const provider = new FallbackProbe();
  await provider.handleTitleRequest('Titolo Sconosciuto', 1, 3, false, null, null, null, null, '2020-01-01');

  assert.equal(provider.fallbackCalls.length, 1, 'il ripiego deve partire una volta');
  assert.equal(provider.fallbackCalls[0].startDate, '2020-01-01');
  assert.equal(provider.fallbackCalls[0].episodeNumber, 3);
  assert.equal(provider.fallbackCalls[0].seasonNumber, 1);
});

test('senza kitsuStartDate il ripiego non parte (nessuno stato di istanza)', async () => {
  const provider = new FallbackProbe();
  await provider.handleTitleRequest('Titolo Sconosciuto', 1, 3, false);

  assert.deepEqual(provider.fallbackCalls, [], 'nessuna data, nessun ripiego');
});

test('due richieste sullo stesso provider non si passano la data', async () => {
  const provider = new FallbackProbe();
  await provider.handleTitleRequest('Con Data', 1, 1, false, null, null, null, null, '2019-04-01');
  await provider.handleTitleRequest('Senza Data', 1, 1, false);

  assert.deepEqual(
    provider.fallbackCalls.map((call) => call.normalizedTitle),
    ['Con Data'],
    'la seconda richiesta non deve ereditare la data della prima'
  );
});
