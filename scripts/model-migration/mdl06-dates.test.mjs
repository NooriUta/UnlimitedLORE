// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-06 · даты по ответу владелицы 19.11.2026 («даты переводи»):
//  - KnowUseCase.shipped_at — день (DATE): окончание имени _at здесь не значит момент;
//  - status_known_from — момент (DATETIME) у всех шести версий; строки разбираются в момент UTC, неразбираемое —
//    в остаток MigLeftover с причиной (rejects исполнителя → transfer.mjs, kind 'reject').
// Карта, схема и исполнитель обязаны сказать одно и то же: иначе схема объявит одно, а перенос положит другое.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ruleFor } from './propose-map-all.mjs';
import { applyMap } from './apply-map.mjs';

const J = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const MAP_FIRST = J('./map/sprint-phase-task.json').types;
const MAP_ALL = J('./map/all-objects.json').types;
const SCHEMA = { ...J('./schema/sprint-phase-task.json').types, ...J('./schema/all-objects.json').types };
const HISTS = ['KnowSprintHist', 'KnowPhaseHist', 'KnowTaskHist', 'KnowADRHist', 'KnowDecisionHist', 'KnowSpecHist'];

test('правило: shipped_at — DATE, status_known_from — DATETIME', () => {
  assert.equal(ruleFor('KnowUseCase', 'shipped_at').how, 'DATE');
  assert.equal(ruleFor('KnowUseCase', 'shipped_at').to, 'shipped_at');
  for (const T of ['KnowADRHist', 'KnowDecisionHist', 'KnowSpecHist']) {
    const e = ruleFor(T, 'status_known_from');
    assert.deepEqual([e.rule, e.how, e.to], ['transform', 'DATETIME', 'status_known_from'], T);
  }
  assert.equal(ruleFor('KnowRelease', 'updated_at').how, 'DATETIME', 'прочие _at — как были');
});

test('карта переноса: shipped_at и status_known_from — тем же правилом', () => {
  assert.equal(MAP_ALL.KnowUseCase.shipped_at.how, 'DATE');
  for (const T of HISTS) {
    const e = (MAP_FIRST[T] || MAP_ALL[T]).status_known_from;
    assert.ok(e, T + ': поле в карте');
    assert.deepEqual([e.rule, e.how], ['transform', 'DATETIME'], T);
  }
});

test('схема переноса: status_known_from — DATETIME у шести версий, shipped_at — DATE', () => {
  for (const T of HISTS) {
    const f = SCHEMA[T].fields.status_known_from;
    assert.ok(f, T + ': поле объявлено схемой');
    assert.deepEqual([f.kind, f.db_type], ['datetime', 'DATETIME'], T);
  }
  assert.deepEqual([SCHEMA.KnowUseCase.fields.shipped_at.kind, SCHEMA.KnowUseCase.fields.shipped_at.db_type], ['date', 'DATE']);
});

test('исполнитель: строка момента — в момент UTC; неразбираемое — в rejects с причиной, не теряется', () => {
  const ok = applyMap('KnowADRHist', MAP_ALL.KnowADRHist, { status_known_from: '2026-06-04 10:00:00' });
  assert.equal(ok.out.status_known_from, '2026-06-04T10:00:00.000Z');
  const zone = applyMap('KnowSpecHist', MAP_ALL.KnowSpecHist, { status_known_from: '2026-06-04T10:00:00+03:00' });
  assert.equal(zone.out.status_known_from, '2026-06-04T07:00:00.000Z');
  const bad = applyMap('KnowDecisionHist', MAP_ALL.KnowDecisionHist, { status_known_from: 'с начала спринта' });
  assert.ok(!('status_known_from' in bad.out));
  assert.deepEqual(bad.rejects, [{ field: 'status_known_from', value: 'с начала спринта', why: 'не момент времени' }]);
  const day = applyMap('KnowUseCase', MAP_ALL.KnowUseCase, { shipped_at: '2026-06-04T12:00:00Z' });
  assert.equal(day.out.shipped_at, '2026-06-04');
});
