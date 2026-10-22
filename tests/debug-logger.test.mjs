import assert from 'node:assert/strict';
import { test } from 'node:test';

const { resolveDebugLevel } = await import('../dist/utils/logger.js');

test('debug level accepts 1-4 and clamps out-of-range values', () => {
  assert.equal(resolveDebugLevel({}), 0);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '1' }), 1);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '2' }), 2);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '3' }), 3);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '4' }), 4);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '0' }), 0);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '9' }), 4);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '-2' }), 0);
});

test('DEBUG_LOG stays backward compatible', () => {
  assert.equal(resolveDebugLevel({ DEBUG_LOG: 'true' }), 2);
  assert.equal(resolveDebugLevel({ DEBUG_LOG: 'on' }), 2);
  assert.equal(resolveDebugLevel({ DEBUG_LOG: 'false' }), 0);
  assert.equal(resolveDebugLevel({ DEBUG_LOG: '4' }), 4);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '', DEBUG_LOG: '3' }), 3);
  assert.equal(resolveDebugLevel({ DEBUG_LEVEL: '1', DEBUG_LOG: '4' }), 1);
});
