import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { test } from 'node:test';
import { fetch } from 'undici';
import { proxyDispatcher, redactProxy } from '../../dist/catalog/proxy.js';

test('proxy: vuoto = nessun dispatcher, http e socks5 accettati, socks4 rifiutato', () => {
  assert.equal(proxyDispatcher(''), undefined);
  assert.equal(proxyDispatcher(null), undefined);
  assert.ok(proxyDispatcher('http://user:pass@127.0.0.1:8080'));
  assert.ok(proxyDispatcher('socks5://127.0.0.1:1080'));
  assert.ok(proxyDispatcher('socks5h://127.0.0.1:1080'));
  assert.throws(() => proxyDispatcher('socks4://127.0.0.1:1080'), /socks4/);
  assert.throws(() => proxyDispatcher('127.0.0.1:1080'), /proxy non riconosciuto/);
});

test('proxy: le credenziali sono redatte', () => {
  assert.equal(redactProxy('fetch failed verso http://user:pass@host:8000/x'), 'fetch failed verso http://***@host:8000/x');
  assert.equal(redactProxy('nessuna credenziale'), 'nessuna credenziale');
});

/** Finto proxy SOCKS5 (senza autenticazione) che apre un tunnel verso il target. */
function fakeSocks5(seen = []) {
  const server = net.createServer((client) => {
    let stage = 0;
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 0) {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        buffer = buffer.subarray(2 + buffer[1]);
        client.write(Buffer.from([5, 0]));
        stage = 1;
      }
      if (stage === 1) {
        if (buffer.length < 5) return;
        const atyp = buffer[3];
        let host = '';
        let need = 0;
        if (atyp === 1) {
          if (buffer.length < 10) return;
          host = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;
          need = 10;
        } else if (atyp === 3) {
          const length = buffer[4];
          if (buffer.length < 5 + length + 2) return;
          host = buffer.subarray(5, 5 + length).toString();
          need = 5 + length + 2;
        } else {
          client.destroy();
          return;
        }
        const port = buffer.readUInt16BE(need - 2);
        seen.push({ atyp, host, port });
        buffer = buffer.subarray(need);
        client.off('data', onData);
        const upstream = net.connect(port, host, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on('error', () => client.destroy());
        stage = 2;
      }
    };
    client.on('data', onData);
    client.on('error', () => client.destroy());
  });
  return server;
}

test('proxy: il fetch passa davvero da un SOCKS5 (tunnel verificato in locale)', async () => {
  const target = http.createServer((req, res) => res.end(`ok:${req.url}`));
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const seen = [];
  const socks = fakeSocks5(seen);
  await new Promise((resolve) => socks.listen(0, '127.0.0.1', resolve));
  try {
    const targetPort = target.address().port;
    const socksPort = socks.address().port;
    const dispatcher = proxyDispatcher(`socks5h://127.0.0.1:${socksPort}`);
    // `localhost` invece dell'IP: se undici risolvesse in locale manderebbe
    // 127.0.0.1 (ATYP=1), se manda il nome (ATYP=3) il DNS lo fa il proxy.
    const response = await fetch(`http://localhost:${targetPort}/tunnel`, {
      dispatcher,
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok:/tunnel');
    assert.deepEqual(seen[0], { atyp: 3, host: 'localhost', port: targetPort }, 'hostname al proxy = DNS remoto');
  } finally {
    await new Promise((resolve) => target.close(resolve));
    await new Promise((resolve) => socks.close(resolve));
  }
});
