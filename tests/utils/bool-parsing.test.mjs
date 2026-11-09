import assert from 'node:assert/strict';
import { test } from 'node:test';

const { normalizeBool } = await import('../../dist/config.js');

// C'erano tre parser booleani: `normalizeBool`, `!== 'false'` e `envFlag`.
// Con `!== 'false'` solo la stringa esatta spegneva: `0`, `off`, `False`
// venivano ignorati in silenzio.
test('normalizeBool accetta le forme che env.example lascia intendere', () => {
  for (const on of ['true', '1', 'on', 'yes', 'TRUE', ' True ']) assert.equal(normalizeBool(on), true, on);
  for (const off of ['false', '0', 'off', 'no', 'FALSE', ' False ']) assert.equal(normalizeBool(off), false, off);
});

test('normalizeBool distingue "assente" da "falso"', () => {
  assert.equal(normalizeBool(undefined), undefined);
  assert.equal(normalizeBool(''), undefined);
  assert.equal(normalizeBool('pippo'), undefined);
});
