// Связи версий на СТАРОЙ базе: у версии бывает больше одной входящей HAS_STATE.
// Найдено 22.11.2026 на прогоне установщика 1.18.2 (ryzenai, бэкап прода 01.11.2026): в источнике 15 127 связей
// версий, из них 15 068 версий с одной связью, 9 — с двумя, 4 — с тремя, одна — с пятью и одна — с 24; лишних 44.
// Этап записи кладёт одну связь на версию (у версии одна запись), поэтому в приёмнике 15 082, и сверка объявляла
// «сверка связей: НЕ сошлась» числами 15126 ≠ 15082, не называя причину. Ожидание считается по версиям, а лишние
// связи источника называются числом.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keptVersionEdges } from './transfer-edges.mjs';

const own = ['KnowSprint', 'KnowTask'];
const moved = new Set(['#1:0', '#2:0', '#1:1', '#2:1', '#2:2']);

test('у версии несколько связей в источнике — ожидание по версиям, лишние названы числом', () => {
  const rows = [
    { o: '#1:0', i: '#2:0', ot: 'KnowSprint', it: 'KnowSprintHist' },
    { o: '#1:1', i: '#2:0', ot: 'KnowSprint', it: 'KnowSprintHist' }, // та же версия у второй записи — аномалия
    { o: '#1:0', i: '#2:1', ot: 'KnowSprint', it: 'KnowSprintHist' },
  ];
  const r = keptVersionEdges(rows, own, moved);
  assert.equal(r.expected, 2, 'ожидание — по версиям, а не по связям источника');
  assert.equal(r.duplicate_versions, 1, 'лишняя связь названа числом, а не спрятана в «не сошлась»');
});

test('чужое направление и неперенесённый конец в ожидание не идут', () => {
  const rows = [
    { o: '#2:2', i: '#1:1', ot: 'KnowSprintHist', it: 'KnowSprint' },   // связь наоборот — аномалия
    { o: '#1:0', i: '#9:9', ot: 'KnowSprint', it: 'KnowSprintHist' },   // версия не перенесена
    { o: '#9:9', i: '#2:1', ot: 'KnowSprint', it: 'KnowSprintHist' },   // запись не перенесена
    { o: '#1:0', i: '#2:0', ot: 'KnowDoc', it: 'KnowDocHist' },         // тип не свой
    { o: '#1:1', i: '#2:2', ot: 'KnowTask', it: 'KnowTaskHist' },
  ];
  const r = keptVersionEdges(rows, own, moved);
  assert.equal(r.expected, 1);
  assert.equal(r.duplicate_versions, 0);
});
