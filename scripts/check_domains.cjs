#!/usr/bin/env node
/*
 * Domain reachability & challenge checker — ANIME ONLY.
 * Reads config/domains.json and probes anime domains.
 * Usage:
 *   node scripts/check_domains.cjs            (pretty table)
 *   node scripts/check_domains.cjs --json     (raw JSON output)
 *   node scripts/check_domains.cjs --timeout=5000 --concurrency=4
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const asFlag = (name, def) => {
  const m = argv.find(a => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1] : def;
};
const WANT_JSON = argv.includes('--json');
const TIMEOUT_MS = parseInt(asFlag('timeout', '6000'), 10) || 6000;
const CONC = Math.max(1, parseInt(asFlag('concurrency', '5'), 10) || 5);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

const CHALLENGE_PATTERNS = [
  /cf-turnstile/i,
  /Just a moment/i,
  /__cf_chl_/i,
  /challenge-platform\//i,
  /enable javascript and cookies to continue/i,
  /SecurityAW2-os=/i,
  /__CF\$cv\$params/i,
];

function classifyChallenge(body, status) {
  if (status === 403) return true;
  const text = String(body || '');
  return CHALLENGE_PATTERNS.some(re => re.test(text));
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    return { status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(key, host) {
  const url = `https://${host}`;
  const started = Date.now();
  const outcome = { key, host, url, status: 'error', httpStatus: null, ms: 0, note: '' };

  try {
    const { status, body } = await fetchPage(url);
    outcome.httpStatus = status;
    if (classifyChallenge(body, status)) {
      outcome.status = 'blocked';
      outcome.note = 'challenge_body';
    } else if (status >= 200 && status <= 399) {
      outcome.status = 'ok';
    } else if (status === 429) {
      outcome.note = 'too_many_requests';
    } else {
      outcome.note = `http_${status}`;
    }
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'timeout' : (e && e.message ? e.message : String(e));
    outcome.note = msg;
    outcome.status = /cloudflare|challenge|blocked/i.test(msg) ? 'blocked' : 'error';
  }

  outcome.ms = Date.now() - started;
  return outcome;
}

(async () => {
  const domainsPath = path.join(__dirname, '..', 'config', 'domains.json');
  let map;
  try {
    map = JSON.parse(fs.readFileSync(domainsPath, 'utf8'));
  } catch (e) {
    console.error('Failed to read domains.json', e.message || e);
    process.exit(1);
  }

  const entries = Object.entries(map);
  const queue = entries.slice();
  const results = [];

  async function worker() {
    while (queue.length) {
      const [key, host] = queue.shift();
      const result = await probe(key, host);
      results.push(result);
      if (!WANT_JSON) {
        console.log(
          `[${result.status.padEnd(7)}] ${key.padEnd(12)} ${result.host.padEnd(25)} ` +
          `${String(result.httpStatus || '-').padStart(3)} ${String(result.ms).padStart(5)}ms ` +
          `${result.note ? `- ${result.note.slice(0, 60)}` : ''}`
        );
      }
    }
  }

  const workers = Array(Math.min(CONC, entries.length)).fill(0).map(() => worker());
  await Promise.all(workers);

  results.sort((a, b) => a.key.localeCompare(b.key));
  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  if (WANT_JSON) {
    console.log(JSON.stringify({ summary, results, concurrency: CONC, timeoutMs: TIMEOUT_MS }, null, 2));
  } else {
    console.log('\nSummary:', summary);
  }
})();
