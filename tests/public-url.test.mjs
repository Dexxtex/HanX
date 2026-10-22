import assert from 'node:assert/strict';
import { test } from 'node:test';

const { detectPublicBaseUrl } = await import('../dist/utils/public-url.js');

test('public base URL uses forwarded port', () => {
  assert.equal(detectPublicBaseUrl({
    host: 'ubuntuserver.example.ts.net',
    forwardedHost: 'ubuntuserver.example.ts.net',
    forwardedPort: '8006',
    forwardedProto: 'https',
  }), 'https://ubuntuserver.example.ts.net:8006');
});

test('public base URL keeps a port already present in Host', () => {
  assert.equal(detectPublicBaseUrl({
    host: 'ubuntuserver.example.ts.net:8006',
    protocol: 'http',
  }), 'http://ubuntuserver.example.ts.net:8006');
});

test('public base URL falls back to the browser origin without port information', () => {
  assert.equal(detectPublicBaseUrl({
    host: 'ubuntuserver.example.ts.net',
    protocol: 'https',
  }), '');
  assert.equal(detectPublicBaseUrl({
    forwardedPort: '8006',
    forwardedProto: 'https',
  }), '');
});

test('public base URL does not duplicate forwarded ports', () => {
  assert.equal(detectPublicBaseUrl({
    forwardedHost: 'ubuntuserver.example.ts.net:8006',
    forwardedPort: '8006',
    forwardedProto: 'https',
  }), 'https://ubuntuserver.example.ts.net:8006');
});
