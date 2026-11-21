// MIG-04 · эмуляция на ryzenai 21.11.2026: `connect --create-dst` при недоступном приёмнике (ECONNRESET — ArcadeDB
// установки ещё не поднялась) выходил с кодом 0, приёмник не создавался, и transfer падал позже «Database not found».
// Просили создать приёмник, а его нет — отказ connect с причиной, а не тихий успех.
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectVerdict } from './probe-verdict.mjs';

test('просили создать приёмник, сервер приёмника не ответил — отказ с причиной', () => {
  const v = connectVerdict({ dstServer: { отказ: 0, text: 'сеть: ECONNRESET' }, dst: { exists: false } }, { createDst: true });
  assert.equal(v.ok, false);
  assert.match(v.reason, /приёмник не создан/);
  assert.match(v.reason, /ECONNRESET/);
});

test('просили создать, создание отказало — отказ с ответом сервера', () => {
  const v = connectVerdict({ dst: { exists: false, created: { отказ: 403, text: 'нет прав' } } }, { createDst: true });
  assert.equal(v.ok, false);
  assert.match(v.reason, /403/);
});

test('приёмник есть или создан — успех; без --create-dst отсутствие приёмника — не ошибка connect', () => {
  assert.equal(connectVerdict({ dst: { exists: true, created: true } }, { createDst: true }).ok, true);
  assert.equal(connectVerdict({ dst: { exists: false } }, { createDst: false }).ok, true);
});
