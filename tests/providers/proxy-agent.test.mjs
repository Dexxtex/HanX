import assert from 'node:assert/strict';
import { test } from 'node:test';

const { proxyAgentFor } = await import('../../dist/providers/anime-core/fetch-resource.js');

// C'erano tre modi di creare l'agent di uscita. Quello di AnimeUnity creava il
// SocksProxyAgent senza `keepAlive`, quindi ogni richiesta pagava TCP + SOCKS5
// + TLS (100-320 ms). Ora c'è una factory sola.
test('l agent SOCKS ha keepAlive: senza, ogni richiesta ripaga il handshake', () => {
  const agent = proxyAgentFor('socks5://127.0.0.1:1080');
  assert.equal(agent?.options?.keepAlive, true);
});

test('lo stesso URL restituisce lo stesso agent (pooling, non uno per richiesta)', () => {
  const a = proxyAgentFor('socks5://127.0.0.1:1081');
  const b = proxyAgentFor('socks5://127.0.0.1:1081');
  assert.equal(a, b);
});

test('http(s) usa un ProxyAgent di undici, non un agent SOCKS', () => {
  const agent = proxyAgentFor('http://127.0.0.1:8080');
  assert.ok(agent);
  assert.notEqual(agent?.options?.keepAlive, true, 'undici ha già il pooling suo');
});
