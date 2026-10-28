import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hanx-publish-'));
const indexFile = path.join(tmp, 'anime-seasons.json');
const stateFile = path.join(tmp, 'jikan-progress.json');
fs.writeFileSync(indexFile, '{"series":{},"movies":{}}');
fs.writeFileSync(stateFile, '{"done":{}}');

process.env.GITHUB_TOKEN = 'test-token';
process.env.GITHUB_REPO = 'owner/repo';
process.env.GITHUB_MAPPING_BRANCH = 'mapping';
process.env.ANIME_MAPPING_FILE = indexFile;
process.env.ANIME_MAPPING_STATE = stateFile;

const { publishIndex } = await import('../../scripts/build-anime-mapping.mjs');

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method: init.method || 'GET', body });
    return handler(String(url), init.method || 'GET', body);
  };
  return calls;
}

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('pubblica indice e cursore su un commit orfano', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = mockFetch((url, method, body) => {
    if (url.endsWith('/git/blobs')) {
      const content = Buffer.from(body.content, 'base64').toString('utf8');
      return json({ sha: content.includes('"series"') ? 'index-blob' : 'state-blob' });
    }
    if (url.endsWith('/git/trees')) return json({ sha: 'tree-sha' });
    if (url.endsWith('/git/commits')) return json({ sha: 'commit-sha' });
    if (url.endsWith('/git/refs/heads/mapping')) return json({ object: { sha: 'commit-sha' } });
    throw new Error(`URL inattesa: ${method} ${url}`);
  });

  await publishIndex();

  const tree = calls.find((call) => call.url.endsWith('/git/trees'));
  assert.deepEqual(
    tree.body.tree.map((entry) => entry.path),
    ['anime-seasons.json', 'jikan-progress.json'],
  );

  const commit = calls.find((call) => call.url.endsWith('/git/commits'));
  assert.equal(commit.body.tree, 'tree-sha');
  assert.deepEqual(commit.body.parents, []);

  const ref = calls.find((call) => call.url.endsWith('/git/refs/heads/mapping'));
  assert.equal(ref.method, 'PATCH');
  assert.deepEqual(ref.body, { sha: 'commit-sha', force: true });
});

test('crea il branch quando il ref non esiste', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = mockFetch((url, method) => {
    if (url.endsWith('/git/blobs')) return json({ sha: 'blob-sha' });
    if (url.endsWith('/git/trees')) return json({ sha: 'tree-sha' });
    if (url.endsWith('/git/commits')) return json({ sha: 'commit-sha' });
    if (url.endsWith('/git/refs/heads/mapping')) {
      return json({ message: 'Reference does not exist' }, 422);
    }
    if (url.endsWith('/git/refs')) return json({ ref: 'refs/heads/mapping' }, 201);
    throw new Error(`URL inattesa: ${method} ${url}`);
  });

  await publishIndex();

  const create = calls.find((call) => call.url.endsWith('/git/refs'));
  assert.equal(create.method, 'POST');
  assert.deepEqual(create.body, { ref: 'refs/heads/mapping', sha: 'commit-sha' });
});
