// Tasso di match separando le query utilizzabili (titolo latino) da quelle CJK,
// dove cleanTokens non produce token latini. Campione per sito: 800 check.
import fs from 'node:fs';
import { lookupTitle } from '../../dist/catalog/matcher.js';

const LABEL = { '🪐 Anime Saturn': 'saturn', '🌍 Anime World': 'world', '🎴 Anime Unity': 'unity', '🎴 Anime Unity 🅕🅗🅓': 'unity' };
const CAP = Number(process.argv[2] || 800);

const checks = new Map();
for (const f of fs.readdirSync('sweep-blocks').filter((f) => /^out-\d+\.jsonl$/.test(f))) {
  for (const line of fs.readFileSync('sweep-blocks/' + f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (!(row.streams > 0) || !row.id) continue;
    const e = checks.get(row.id) || { title: row.title, sites: new Set() };
    for (const n of row.names || []) if (LABEL[n]) e.sites.add(LABEL[n]);
    checks.set(row.id, e);
  }
}
const isLatin = (t) => /[a-z]{3}/i.test(String(t || '')) && !/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(String(t || ''));

for (const site of ['saturn', 'world', 'unity']) {
  const found = [...checks].filter(([, c]) => c.sites.has(site));
  const step = Math.max(1, Math.floor(found.length / CAP));
  const cache = new Map();
  const tally = { latino: { n: 0, served: 0 }, altro: { n: 0, served: 0 } };
  for (let i = 0; i < found.length; i += step) {
    const [, c] = found[i];
    let hit = cache.get(c.title);
    if (hit === undefined) { hit = lookupTitle(site, [c.title], {}).hits.length > 0; cache.set(c.title, hit); }
    const bucket = isLatin(c.title) ? tally.latino : tally.altro;
    bucket.n += 1;
    if (hit) bucket.served += 1;
  }
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '-') + '%';
  console.log(`${site.padEnd(7)} trovati ${String(found.length).padStart(5)} | campione ${tally.latino.n + tally.altro.n} (passo ${step}) | latino ${tally.latino.served}/${tally.latino.n} = ${pct(tally.latino.served, tally.latino.n)} | CJK/altro ${tally.altro.served}/${tally.altro.n} = ${pct(tally.altro.served, tally.altro.n)}`);
}
