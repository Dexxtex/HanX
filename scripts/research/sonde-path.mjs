// Sonda degli endpoint non ancora provati. ~8 richieste, 5 s, stop sul 403.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
let slot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  const wait = slot - Date.now(); if (wait > 0) await sleep(wait);
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': UA, 'accept-language': 'it-IT,it;q=0.9', referer: url } });
  slot = Date.now() + 5000;
  const body = await res.text();
  if (res.status === 403 || res.status === 429) throw new Error(`BLOCCATO ${res.status} su ${url}`);
  return { status: res.status, body };
}
const count = (text, re) => (text.match(re) || []).length;
const maxPage = (html) => html.match(/paginationMaxPage\s*=\s*parseInt\("(\d+)"\)/)?.[1] ?? '-';

// 1-2. World: le parti 1 e 2 della sitemap (la 0 era /play/, la 3 profili)
for (const n of [1, 2]) {
  try {
    const r = await get(`https://www.animeworld.ac/sitemap-${n}.xml`);
    const t = r.body;
    console.log(`world sitemap-${n}: ${r.status} ${(t.length / 1024).toFixed(0)}KB | /play/ ${count(t, /\/play\//g)} | /anime/ ${count(t, /\/anime\//g)} | /filter ${count(t, /\/filter/g)} | profili ${count(t, /\/profile\//g)}`);
  } catch (e) { console.log('world sitemap:', e.message); }
}

// 3-4. World: i filtri per year e type funzionano?
for (const q of ['year[]=2024', 'type[]=Movie']) {
  try {
    const r = await get(`https://www.animeworld.ac/filter?${q}`);
    console.log(`world /filter?${q}: ${r.status} | maxPage ${maxPage(r.body)} | card ${count(r.body, /class="item"/g)}`);
  } catch (e) { console.log(`world ?${q}:`, e.message); }
}

// 5. Saturn: /rss (Dai sitemap-pages) — titoli recenti?
try {
  const r = await get('https://www.animesaturn.net/rss');
  const items = count(r.body, /<item>/g);
  console.log(`saturn /rss: ${r.status} ${r.body.length} byte | item ${items} | inizio: ${r.body.replace(/\s+/g, ' ').slice(0, 120)}`);
} catch (e) { console.log('saturn /rss:', e.message); }

// 6. Unity: /animelist (endpoint nuovo, dal bundle)
try {
  const r = await get('https://www.animeunity.co/animelist');
  const t = r.body;
  console.log(`unity /animelist: ${r.status} ${(t.length / 1024).toFixed(0)}KB | /anime/ link ${count(t, /\/anime\//g)} | records= ${t.includes('records=')} | title: ${(t.match(/<title>([^<]*)/) || [])[1]?.trim().slice(0, 60)}`);
} catch (e) { console.log('unity /animelist:', e.message); }
