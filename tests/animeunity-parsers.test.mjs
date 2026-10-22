import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseEpisodesFromAnimeHtml,
  parseEpisodeServers,
  parseSearchResultsHtml,
  parseVixcloudHls,
  selectHighestHlsVariant,
} from '../dist/providers/animeunity-parsers.js';

// Fixture ridotte dalle pagine reali di www.animeunity.at (ottobre 2026).
const SEARCH_HTML = `
<div class="result"><a href="https://www.animeunity.at/anime/989-death-note" class="livesearch-item">
  <div class="livesearch-name"><div class="livesearch-title d-title" data-au-title="Death Note">Death Note</div>
  <div class="livesearch-info-wrap"><span class="livesearch-info">2006</span> <span class="livesearch-info">TV</span>
  <span class="livesearch-info"> • 37/37 episodi</span></div></div></a></div>
<div class="result"><a href="https://www.animeunity.at/anime/3071-death-note-relight" class="livesearch-item">
  <div class="livesearch-name"><div class="livesearch-title d-title" data-au-title="Death Note: Relight">Death Note: Relight</div>
  <div class="livesearch-info-wrap"><span>2007</span><span>Special</span><span> • 2/2 episodi</span></div></div></a></div>
`;

const ANIME_HTML = `
<div class="episodes">
  <ul class="ep-range episode-wrapper" data-page="1" data-range="001-037">
    <li class="episode episode-item" data-num="1"><a href="/anime/989-death-note/ep-24959" title="Episodio 1: Rebirth" data-id="24959" data-num="1" data-sub="1" data-dub="1">1</a></li>
    <li class="episode episode-item" data-num="2"><a href="/anime/989-death-note/ep-24962" title="Episodio 2: Confrontation" data-id="24962" data-num="2" data-sub="1" data-dub="1">2</a></li>
  </ul>
</div>
`;

const EPISODE_HTML = `
<div id="w-servers">
  <div class="servers" data-ep-id="24959">
    <ul class="servers-sub" data-type="sub">
      <li class="server-item" data-type="sub" data-ep-id="24959" data-sv-id="vixcloud" data-link-id="link-sub-vix"></li>
      <li class="server-item" data-type="sub" data-ep-id="24959" data-sv-id="animesaturn" data-link-id="link-sub-as"></li>
    </ul>
    <ul class="servers-dub" data-type="dub">
      <li class="server-item" data-type="dub" data-ep-id="24959" data-sv-id="vixcloud" data-link-id="link-dub-vix"></li>
    </ul>
  </div>
</div>
`;

test('parseSearchResultsHtml estrae id, slug, titolo e conteggio episodi', () => {
  assert.deepEqual(parseSearchResultsHtml(SEARCH_HTML), [
    { id: 989, slug: 'death-note', name: 'Death Note', episodes_count: 37 },
    { id: 3071, slug: 'death-note-relight', name: 'Death Note: Relight', episodes_count: 2 },
  ]);
  assert.deepEqual(parseSearchResultsHtml(''), []);
});

test('parseEpisodesFromAnimeHtml legge tutti gli episodi del blocco .episodes', () => {
  assert.deepEqual(parseEpisodesFromAnimeHtml(ANIME_HTML), [
    { id: 24959, number: 1, name: 'Episodio 1: Rebirth' },
    { id: 24962, number: 2, name: 'Episodio 2: Confrontation' },
  ]);
});

test('parseEpisodeServers separa SUB e ITA e ignora altri episodi', () => {
  assert.deepEqual(parseEpisodeServers(EPISODE_HTML, 24959), [
    { type: 'sub', linkId: 'link-sub-vix', host: 'vixcloud' },
    { type: 'sub', linkId: 'link-sub-as', host: 'animesaturn' },
    { type: 'dub', linkId: 'link-dub-vix', host: 'vixcloud' },
  ]);
  assert.deepEqual(parseEpisodeServers(EPISODE_HTML, 1), []);
});

test('parseVixcloudHls compone token/expires e mantiene b=1 e h=1', () => {
  const html = `
    <script>
      window.canPlayFHD = true;
      var player = new Playerjs({ url: 'https://vixcloud.co/playlist/abc?b=1', 'token': 'tok123', 'expires': '1700000000' });
    </script>`;
  assert.equal(
    parseVixcloudHls(html, 'https://vixcloud.co/embed/abc'),
    'https://vixcloud.co/playlist/abc.m3u8?b=1&token=tok123&expires=1700000000&h=1'
  );
});

test('parseVixcloudHls risolve playlist relative e non aggiunge h senza FHD', () => {
  const html = `<script>url: "/playlist/xyz", "token": "t", "expires": "99"</script>`;
  assert.equal(
    parseVixcloudHls(html, 'https://vixsrc.to/embed/xyz'),
    'https://vixsrc.to/playlist/xyz.m3u8?token=t&expires=99'
  );
});

test('parseVixcloudHls restituisce null se manca il player', () => {
  assert.equal(parseVixcloudHls('<html><body>nope</body></html>', 'https://vixsrc.to/embed/x'), null);
});

test('parseVixcloudHls decodifica il player ani3 con m3u8 annidato', () => {
  const html = `<script>
    const streamUrl = "https://ani3.api-webs.com/player.php?m3u8=https%3A%2F%2Fvixcloud.cc%2Fplaylist%2F317048%3Ftoken%3Dabc%26expires%3D1797844013%26h%3D1";
  </script>`;
  assert.equal(
    parseVixcloudHls(html, 'https://ani3.api-webs.com/player.php?id=72154'),
    'https://ani3.api-webs.com/player.php?m3u8=https%3A%2F%2Fvixcloud.cc%2Fplaylist%2F317048%3Ftoken%3Dabc%26expires%3D1797844013%26h%3D1'
  );
});

test('parseVixcloudHls accetta streamUrl diretto vixcloud.cc', () => {
  const html = `<script>const streamUrl = "https://vixcloud.cc/playlist/317048?token=t&expires=1";</script>`;
  assert.equal(
    parseVixcloudHls(html, 'https://ani3.api-webs.com/player.php?id=72154'),
    'https://vixcloud.cc/playlist/317048.m3u8?token=t&expires=1'
  );
});

test('parseVixcloudHls ignora streamUrl su host non vixcloud', () => {
  const html = `<script>const streamUrl = "https://evil.example/playlist/1?token=t";</script>`;
  assert.equal(parseVixcloudHls(html, 'https://ani3.api-webs.com/player.php?id=1'), null);
});

test('selectHighestHlsVariant sceglie la risoluzione più alta', () => {
  const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480
https://cdn.example/480.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2150000,RESOLUTION=1280x720
https://cdn.example/720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080
https://cdn.example/1080.m3u8`;
  assert.equal(
    selectHighestHlsVariant(master, 'https://cdn.example/master.m3u8'),
    'https://cdn.example/1080.m3u8'
  );
});

test('selectHighestHlsVariant usa il bandwidth a parità di risoluzione', () => {
  const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1920x1080
https://cdn.example/1080-low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080
https://cdn.example/1080-high.m3u8`;
  assert.equal(
    selectHighestHlsVariant(master, 'https://cdn.example/master.m3u8'),
    'https://cdn.example/1080-high.m3u8'
  );
});

test('selectHighestHlsVariant usa il bandwidth se manca RESOLUTION', () => {
  const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000
https://cdn.example/low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000
https://cdn.example/high.m3u8`;
  assert.equal(
    selectHighestHlsVariant(master, 'https://cdn.example/master.m3u8'),
    'https://cdn.example/high.m3u8'
  );
  assert.equal(selectHighestHlsVariant('#EXTM3U\n#EXTINF:6,\nsegment.ts', 'https://cdn.example/media.m3u8'), null);
});
