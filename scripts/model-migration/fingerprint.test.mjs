// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — отпечаток итога для приёмки.
// Слова владелицы 16.11.2026: «принимаем на этой машине и на razenai должно сойтись с одинаковыми настройками».
// Отпечаток — короткая сумма итога: на двух машинах с одинаковыми настройками он обязан совпасть.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, fingerprint } from './fingerprint.mjs';

test('порядок ключей не меняет отпечаток, порядок элементов массива — меняет', () => {
  assert.equal(fingerprint({ a: 1, b: { c: 2, d: [1, 2] } }), fingerprint({ b: { d: [1, 2], c: 2 }, a: 1 }));
  assert.notEqual(fingerprint({ d: [1, 2] }), fingerprint({ d: [2, 1] }));
});

test('любая разница в значении меняет отпечаток; undefined не отличается от отсутствия ключа', () => {
  assert.notEqual(fingerprint({ n: 1 }), fingerprint({ n: 2 }));
  assert.notEqual(fingerprint({ n: 1 }), fingerprint({ n: '1' }));
  assert.equal(fingerprint({ a: 1, b: undefined }), fingerprint({ a: 1 }));
  assert.equal(canonical({ b: 1, a: [null, 'x'] }), '{"a":[null,"x"],"b":1}');
});

test('отпечаток — 16 шестнадцатеричных знаков', () => {
  assert.match(fingerprint({}), /^[0-9a-f]{16}$/);
});
