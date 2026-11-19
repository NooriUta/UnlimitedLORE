// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — справочники в новой базе.
// Правило переноса (владелица 16.11.2026, приняла предложение «подписи по языкам отдельно от справочника:
// одна строка на пару значение — язык; третий язык добавляется данными») и «текущие наши статусы привести к
// трём локализациям».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dictRows } from './dicts.mjs';

const RULES = JSON.parse(fs.readFileSync(new URL('./rules/status-unification.json', import.meta.url), 'utf8'));
const NONE = { format: 'mig-decisions/1', decisions: [] };

test('каждое значение справочника — строка значения и по строке подписи на каждый язык правил', () => {
  const { entries, labels } = dictRows(RULES, NONE);
  const n = Object.values(RULES.dictionaries).reduce((s, d) => s + d.codes.length, 0);
  assert.equal(entries.length, n);
  assert.equal(labels.length, n * RULES.languages.length);
  const done = entries.find(e => e.dict_type === 'plan_status' && e.code === 'DONE');
  assert.deepEqual({ kind: done.kind, sort_order: typeof done.sort_order }, { kind: 'status', sort_order: 'number' });
  const pl = labels.find(l => l.dict_type === 'plan_status' && l.code === 'DONE' && l.lang === 'pl');
  assert.equal(pl.label, 'Gotowe');
});

test('код, добавленный решением человека, попадает в справочник со своими подписями — после кодов правил', () => {
  const doc = { format: 'mig-decisions/1', decisions: [{ id: 'A-1', scope: { type: 'KnowPhaseHist', field: 'status_raw', value: '🚫 CANCELLED' },
    action: 'add_code', to: 'CANCELLED', labels: { ru: 'Отменена', en: 'Cancelled', pl: 'Anulowana' }, by: 'x', at: '2026-11-16T00:00:00Z' }] };
  const { entries, labels } = dictRows(RULES, doc);
  const e = entries.find(x => x.dict_type === 'phase_status' && x.code === 'CANCELLED');
  assert.ok(e, 'добавленный код есть');
  assert.equal(e.added_by, 'A-1');
  const phase = entries.filter(x => x.dict_type === 'phase_status');
  assert.equal(phase[phase.length - 1].code, 'CANCELLED', 'в конце справочника');
  assert.equal(labels.filter(l => l.dict_type === 'phase_status' && l.code === 'CANCELLED').length, 3);
});

test('два решения добавляют один код — одна строка; код справочника правил решение не дублирует', () => {
  const mk = (id, to) => ({ id, scope: { type: 'KnowPhaseHist', field: 'status_raw', value: id }, action: 'add_code', to,
    labels: { ru: 'р', en: 'e', pl: 'p' }, by: 'x', at: '2026-11-16T00:00:00Z' });
  const { entries } = dictRows(RULES, { format: 'mig-decisions/1', decisions: [mk('a', 'CANCELLED'), mk('b', 'CANCELLED'), mk('c', 'ACTIVE')] });
  assert.equal(entries.filter(x => x.dict_type === 'phase_status' && x.code === 'CANCELLED').length, 1);
  assert.equal(entries.filter(x => x.dict_type === 'phase_status' && x.code === 'ACTIVE').length, 1);
});
