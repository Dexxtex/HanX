// Il JSON remoto delle base URL (rifetchato ogni 10 s, senza integrità) diventa
// la base URL di ogni provider. Un host privato lì dentro è un SSRF verso la
// rete interna, non un cambio di dominio.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { isUsableBaseUrl } = await import('../../dist/providers/anime-core/provider-urls.js');

test('base URL: passa solo http(s) verso un host pubblico', () => {
  assert.equal(isUsableBaseUrl('https://www.animeunity.co'), true);
  assert.equal(isUsableBaseUrl('https://animesaturn.net/'), true);
  assert.equal(isUsableBaseUrl('http://animeworld.ac'), true);

  assert.equal(isUsableBaseUrl('http://127.0.0.1:8080'), false, 'loopback');
  assert.equal(isUsableBaseUrl('http://localhost:7000'), false, 'localhost');
  assert.equal(isUsableBaseUrl('http://[::1]:7000'), false, 'loopback IPv6');
  assert.equal(isUsableBaseUrl('https://10.0.0.5'), false, 'classe A privata');
  assert.equal(isUsableBaseUrl('https://172.16.0.1'), false, 'classe B privata');
  assert.equal(isUsableBaseUrl('https://192.168.1.120'), false, 'classe C privata');
  assert.equal(isUsableBaseUrl('https://169.254.169.254'), false, 'metadata cloud');
  assert.equal(isUsableBaseUrl('https://100.64.0.1'), false, 'CGNAT');
  assert.equal(isUsableBaseUrl('https://nas.local'), false, 'mDNS');
  assert.equal(isUsableBaseUrl('file:///etc/passwd'), false, 'schema non http');
  assert.equal(isUsableBaseUrl('non una url'), false);

  // Un hostname che inizia per fc/fd/fe80 non è un IPv6: `fc2.com` è un sito
  // pubblico e la prima versione del controllo lo bloccava.
  assert.equal(isUsableBaseUrl('https://fc2.com'), true);
  assert.equal(isUsableBaseUrl('https://fdmedia.example'), true);
  assert.equal(isUsableBaseUrl('http://[fd00::1]:8080'), false, 'ULA IPv6');
  // Loopback e metadata travestiti da IPv6: senza il mapping tornavano pubblici.
  assert.equal(isUsableBaseUrl('http://[::ffff:127.0.0.1]:8080'), false, 'loopback IPv4-mapped');
  assert.equal(isUsableBaseUrl('http://[::ffff:169.254.169.254]'), false, 'metadata IPv4-mapped');
  assert.equal(isUsableBaseUrl('http://[::ffff:8.8.8.8]:8080'), true, 'IPv4-mapped pubblico');
});
