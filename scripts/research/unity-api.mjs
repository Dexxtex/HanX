const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const base = 'https://www.animeunity.co';
const jar = new Map();
let slot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(url, init = {}) {
  const wait = slot - Date.now(); if (wait > 0) await sleep(wait);
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000), headers: { 'user-agent': UA, ...(init.headers || {}) } });
  slot = Date.now() + 5000;
  for (const line of res.headers.getSetCookie?.() || []) { const [p] = line.split(';'); const i = p.indexOf('='); if (i > 0) jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); }
  return { status: res.status, body: await res.text() };
}
const page = await req(`${base}/archivio`);
const meta = page.body.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1] || '';
const xsrf = decodeURIComponent(jar.get('XSRF-TOKEN') || '');
console.log('GET /archivio', page.status, '| meta', Boolean(meta), '| cookie xsrf', Boolean(xsrf), '| challenge', /just a moment|cf-challenge|challenge-platform/i.test(page.body));

const post = async (label, body) => {
  const r = await req(`${base}/archivio/get-animes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest', 'x-xsrf-token': xsrf, 'x-csrf-token': meta, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), referer: `${base}/archivio` },
    body: JSON.stringify({ title: '', type: '', year: '', order: '', status: '', genres: [], dubbed: '', season: '', offset: 0, ...body }),
  });
  let j = null; try { j = JSON.parse(r.body); } catch {}
  console.log(label.padEnd(28), r.status, '| tot', j?.tot, '| n', j?.records?.length, '| primo', j?.records?.[0]?.title);
  return j;
};
const base0 = await post('default (tutto vuoto)', {});
await post('dubbed=1', { dubbed: '1' });
await post('dubbed=0', { dubbed: '0' });
await post('type=Movie', { type: 'Movie' });
await post('type=TV', { type: 'TV' });
await post('limit=100', { limit: 100 });
await post('per_page=100', { per_page: 100 });
console.log('somma TV+Movie+dubbed?', base0?.tot);
