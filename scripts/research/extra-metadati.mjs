// Sonda: cosa c'è nei tre siti che il catalogo non usa ancora.
// 11 richieste, 5 s di distanza, una alla volta, stop su 403/429.
// Uso: node scripts/research/extra-metadati.mjs
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const GAP = 5000;
let last = 0;
const log = (...a) => console.log(...a);

async function get(url, init = {}) {
  const wait = Math.max(0, last + GAP - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': UA, 'accept-language': 'it-IT,it;q=0.9', ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  const body = await res.text();
  log(`  ${res.status} ${url.replace(/^https?:\/\/[^/]+/, '')} (${body.length} byte)`);
  if (res.status === 403 || res.status === 429) throw new Error(`stop: ${res.status} su ${url}`);
  return { status: res.status, body, headers: res.headers };
}

const grab = (re, s) => (s.match(re) || []).slice(1).map((x) => String(x).slice(0, 60));

// --- Saturn ---------------------------------------------------------------
log('\nSATURN');
const sat = 'https://www.animesaturn.net';
await get(`${sat}/`); // canary
const sm = await get(`${sat}/sitemap-anime-1.xml`);
log('  sitemap: <lastmod>', (sm.body.match(/<lastmod>/g) || []).length,
  '| <changefreq>', (sm.body.match(/<changefreq>/g) || []).length);
log('  primo blocco:', sm.body.slice(sm.body.indexOf('<url>'), sm.body.indexOf('</url>') + 6).replace(/\s+/g, ' '));
const card = await get(`${sat}/anime/tutor-hitman-reborn-tuTL8`);
log('  id esterni:', {
  mal: grab(/myanimelist\.net\/anime\/(\d+)/, card.body),
  anilist: grab(/anilist\.co\/anime\/(\d+)/, card.body),
  anidb: grab(/anidb\.net\/anime\/(\d+)/, card.body),
  shikimori: grab(/shikimori\.\w+\/animes\/[a-z0-9-]+/i, card.body),
});
const cardLd = (card.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
log('  JSON-LD chiavi:', cardLd ? Object.keys(JSON.parse(cardLd)) : 'assente');
const filt = await get(`${sat}/filter?years=2026`);
const cards = filt.body.split(/<div class="item">/).slice(1, 4);
log('  card in /filter (attributi):', cards.map((c) => ({
  attrs: [...c.matchAll(/\bdata-[a-z-]+="[^"]*"/g)].map((m) => m[0]).slice(0, 6),
  anno: grab(/Anno:\s*(\d{4})/, c), tipo: grab(/(?:Tipologia|Tipo):\s*([A-Za-z]+)/, c),
})).slice(0, 3));

// --- AnimeWorld -----------------------------------------------------------
log('\nANIMEWORLD');
const world = 'https://www.animeworld.ac';
const wsm = await get(`${world}/sitemap-0.xml`);
log('  sitemap-0: <lastmod>', (wsm.body.match(/<lastmod>/g) || []).length,
  '| primo blocco:', wsm.body.slice(wsm.body.indexOf('<url>'), wsm.body.indexOf('</url>') + 6).replace(/\s+/g, ' '));
const wfilt = await get(`${world}/filter?page=1`);
const wcards = wfilt.body.split(/<div class="item">/).slice(1, 3);
log('  card in /filter:', wcards.map((c) => ({
  attrs: [...c.matchAll(/\bdata-[a-z-]+="[^"]*"/g)].map((m) => m[0]).slice(0, 6),
  mal: grab(/myanimelist\.net\/anime\/(\d+)/, c),
})));

// --- AnimeUnity -----------------------------------------------------------
log('\nANIMEUNITY');
const unity = 'https://www.animeunity.co';
const arch = await get(`${unity}/archivio`);
const csrf = (arch.body.match(/<meta name="csrf-token" content="([^"]+)"/) || [])[1]
  || (arch.headers.get('set-cookie') || '').match(/XSRF-TOKEN=([^;]+)/)?.[1];
log('  csrf:', csrf ? 'ok' : 'assente');
if (csrf) {
  const cookie = (arch.headers.get('set-cookie') || '').split(/,(?=[^;]+=)/).map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  const wait = Math.max(0, last + GAP - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await fetch(`${unity}/archivio/get-animes`, {
    method: 'POST',
    headers: {
      'user-agent': UA, 'content-type': 'application/json', accept: 'application/json',
      'x-xsrf-token': csrf, 'x-csrf-token': csrf, ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ title: '', type: '', year: '', order: 'title', status: '', genres: [], offset: 0, dubbed: 0, season: '' }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => null);
  log(`  ${res.status} /archivio/get-animes tot=${json?.tot ?? '?'}`);
  const r0 = json?.records?.[0];
  if (r0) {
    const keys = Object.keys(r0);
    log('  campi (' + keys.length + '):', keys.join(', '));
    log('  id esterni nel record:', keys.filter((k) => /mal|anilist|kitsu|tmdb|imdb|anidb/i.test(k)).map((k) => `${k}=${r0[k]}`));
  }
}

// Canary finale sullo stato: nessuna 403 intercettata finora.
log('\nfine sonda: nessun 403/429');
