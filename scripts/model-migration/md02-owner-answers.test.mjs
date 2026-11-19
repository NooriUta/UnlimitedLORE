// SPRINT_LORE_MODEL_DOCS_TIDY/MD-02 · ответы владелицы 19.11.2026 «7-9а» по таблице вопросов 1.18.
//  7а — статусы вне словаря (419 спек, 50 решений) сводятся диалогом унификации в мастере «Перенос»: установщик
//       подсказывает код, человек подтверждает группами; без ответа перенос пишет «ждёт решения», а не подставляет молча.
//  8а — пустые типы: md02-empty-types.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDialog, groupBySuggestion } from './status-unify.mjs';
import { applyMap, requiredStatusField } from './apply-map.mjs';
import { rejectLeftover } from './transfer.mjs';
import { MAP, RULES, VOCAB, CODE_CASE } from './resources.mjs';

const NONE = { format: 'mig-decisions/1', decisions: [] };
const dictOf = T => (RULES.sources.find(s => s.type === T && (s.field === 'status' || s.field === 'status_raw')) || {}).dict;
const ctxOf = (T, decisions = null) => ({ statusDict: dictOf(T), statusVocab: VOCAB, canonToCode: { in_progress: 'active' }, decisions,
  codeCase: CODE_CASE, statusRules: RULES.dictionaries[dictOf(T)], requiredStatus: requiredStatusField(RULES, T) });

// Значения прода (перепись 15.11, пробный расчёт): у 607 версий спек статуса нет; у решений — легаси fixed/done/rejected/CANCELLED.
const COUNTS = [
  { type: 'KnowSpecHist', field: 'status', value: null, n: 607 },
  { type: 'KnowSpecHist', field: 'status', value: 'Accepted', n: 29 },
  { type: 'KnowDecisionHist', field: 'status_raw', value: 'fixed', n: 114 },
  { type: 'KnowDecisionHist', field: 'status_raw', value: 'done', n: 20 },
  { type: 'KnowDecisionHist', field: 'status_raw', value: 'rejected', n: 2 },
  { type: 'KnowDecisionHist', field: 'status_raw', value: '🚫 CANCELLED', n: 1 },
  { type: 'KnowDecision', field: 'status_raw', value: 'fixed', n: 40 },
];

test('7а: статус спеки и решения вне словаря попадает в диалог «ждёт решения» с подсказкой кода из справочника', () => {
  const d = buildDialog(COUNTS, RULES, NONE);
  const row = (T, v) => d.rows.find(r => r.type === T && r.value === v);
  assert.equal(row('KnowSpecHist', 'Accepted').state, 'unified', 'знакомое сводится само');
  const want = { 'KnowSpecHist|null': 'PROPOSED', 'KnowDecisionHist|fixed': 'ACCEPTED', 'KnowDecisionHist|done': 'ACCEPTED',
    'KnowDecisionHist|rejected': 'SUPERSEDED', 'KnowDecisionHist|🚫 CANCELLED': 'SUPERSEDED', 'KnowDecision|fixed': 'ACCEPTED' };
  for (const [k, code] of Object.entries(want)) {
    const [T, v] = k.split('|');
    const r = row(T, v === 'null' ? null : v);
    assert.equal(r.state, 'needs_decision', k + ': ждёт человека');
    assert.equal(r.suggest, code, k + ': подсказка кода');
    assert.ok(r.codes.includes(code), k + ': подсказка — код своего справочника');
    assert.ok(r.suggestWhy, k + ': подсказка с доводом');
  }
  assert.equal(d.ready, false, 'без ответа перенос не начинается');
  // подтверждение группами: строки сгруппированы по подсказке
  const groups = groupBySuggestion(d.rows.filter(r => r.state === 'needs_decision' && r.type === 'KnowDecisionHist'));
  assert.deepEqual(groups.map(g => [g.code, g.rows.length]), [['ACCEPTED', 2], ['SUPERSEDED', 2]]);
});

test('7а: без ответа человека перенос не подставляет статус молча — пустой обязательный статус уходит в остаток «ждёт решения»', () => {
  assert.equal(requiredStatusField(RULES, 'KnowSpecHist'), 'status');
  assert.equal(requiredStatusField(RULES, 'KnowDecisionHist'), 'status_raw');
  assert.equal(requiredStatusField(RULES, 'KnowSpec'), null, 'копия статуса на записи не обязательна');
  assert.equal(requiredStatusField(RULES, 'KnowPhaseHist'), null, 'статус фазы выводится по задачам — не ждёт человека');
  const r = applyMap('KnowSpecHist', MAP.KnowSpecHist, { valid_from: '2026-01-01T00:00:00Z' }, ctxOf('KnowSpecHist'));
  assert.equal(r.out.status, undefined, 'код не подставлен');
  assert.deepEqual(r.rejects.map(x => [x.field, x.why]), [['status', 'пусто']]);
  const left = rejectLeftover('KnowSpecHist', '#1:1', r.rejects[0]);
  assert.equal(left.state, 'ждёт решения');
  assert.equal(left.kind, 'reject');
  // незнакомое значение решения — тоже остаток «ждёт решения», не код
  const dr = applyMap('KnowDecisionHist', MAP.KnowDecisionHist, { status_raw: 'fixed' }, ctxOf('KnowDecisionHist'));
  assert.equal(dr.out.status, null);
  assert.equal(rejectLeftover('KnowDecisionHist', '#2:1', dr.rejects[0]).state, 'ждёт решения');
});

test('7а: ответ человека из диалога применяется переносом (группа «пусто» → PROPOSED, fixed → ACCEPTED)', () => {
  const dec = { format: 'mig-decisions/1', decisions: [
    { id: 'ST-07', scope: { type: 'KnowSpecHist', field: 'status', why: 'пусто' }, action: 'map_to', to: 'PROPOSED', by: 'владелица', at: '2026-11-16T16:40:00Z' },
    { id: 'ST-02', scope: { type: 'KnowDecisionHist', field: 'status_raw', value: 'fixed' }, action: 'map_to', to: 'ACCEPTED', by: 'владелица', at: '2026-11-16T16:40:00Z' },
  ] };
  const r = applyMap('KnowSpecHist', MAP.KnowSpecHist, { valid_from: '2026-01-01T00:00:00Z' }, ctxOf('KnowSpecHist', dec));
  assert.equal(r.out.status, 'PROPOSED');
  assert.deepEqual(r.rejects, []);
  const dr = applyMap('KnowDecisionHist', MAP.KnowDecisionHist, { status_raw: 'fixed' }, ctxOf('KnowDecisionHist', dec));
  assert.equal(dr.out.status, 'ACCEPTED');
  // отложенное человеком — остаток с пометкой «отложено», не «ждёт решения»
  const defer = { format: 'mig-decisions/1', decisions: [{ id: 'ST-99', scope: { type: 'KnowDecisionHist', field: 'status_raw', value: 'fixed' }, action: 'defer', by: 'владелица', at: '2026-11-19T10:00:00Z' }] };
  const df = applyMap('KnowDecisionHist', MAP.KnowDecisionHist, { status_raw: 'fixed' }, ctxOf('KnowDecisionHist', defer));
  assert.equal(rejectLeftover('KnowDecisionHist', '#2:1', df.rejects[0]).state, 'отложено человеком');
});

test('12а: определение doc.has_ext_deps — текст, принятый владелицей 19.11.2026, на трёх языках; копия бэкенда та же', async () => {
  const fs = await import('node:fs');
  for (const p of ['../../shared/model/lore-model.json', '../../backend/src/main/resources/lore-model/lore-model.json']) {
    const m = JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
    const f = m.types.find(t => t.type === 'doc').fields.find(x => x.key === 'has_ext_deps');
    assert.equal(f.definition, 'В документе есть ссылки на внешние ресурсы (CDN): без интернета он может отрисоваться не полностью.', p);
    assert.equal(f.definitionEn, 'The document references external resources (CDN): without internet access it may not render fully.', p);
    assert.ok(f.definitionPl && /CDN/.test(f.definitionPl), p + ': pl');
  }
});
