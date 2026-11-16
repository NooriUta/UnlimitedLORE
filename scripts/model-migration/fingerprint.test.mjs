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

import { contentFingerprint } from './fingerprint.mjs';

test('отпечаток содержимого базы не зависит от адресов записей (@rid) и порядка выборки', () => {
  const a = { vertices: { KnowTask: [{ '@rid': '#1:0', '@type': 'KnowTask', code: 'A' }, { '@rid': '#1:1', '@type': 'KnowTask', code: 'B' }] },
    edges: { PART_OF: [{ '@rid': '#9:0', '@out': '#1:0', '@in': '#1:1', w: 1 }] } };
  const b = { vertices: { KnowTask: [{ '@rid': '#5:7', '@type': 'KnowTask', code: 'B' }, { '@rid': '#5:3', '@type': 'KnowTask', code: 'A' }] },
    edges: { PART_OF: [{ '@rid': '#8:2', '@out': '#5:3', '@in': '#5:7', w: 1 }] } };
  const fa = contentFingerprint(a), fb = contentFingerprint(b);
  assert.equal(fa.total, fb.total);
  assert.deepEqual(fa.types, fb.types);
});

test('отпечаток содержимого чувствует значение поля и направление связи', () => {
  const base = () => ({ vertices: { KnowTask: [{ '@rid': '#1:0', code: 'A' }, { '@rid': '#1:1', code: 'B' }] },
    edges: { PART_OF: [{ '@rid': '#9:0', '@out': '#1:0', '@in': '#1:1' }] } });
  const f0 = contentFingerprint(base()).total;
  const v = base(); v.vertices.KnowTask[1].code = 'C';
  const e = base(); e.edges.PART_OF[0]['@out'] = '#1:1'; e.edges.PART_OF[0]['@in'] = '#1:0';
  assert.notEqual(contentFingerprint(v).total, f0);
  assert.notEqual(contentFingerprint(e).total, f0);
  assert.equal(contentFingerprint(base()).types.KnowTask.n, 2);
});
