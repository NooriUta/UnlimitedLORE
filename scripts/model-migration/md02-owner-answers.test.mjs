// SPRINT_LORE_MODEL_DOCS_TIDY/MD-02 · ответы владелицы 19.11.2026 «7-9а» по таблице вопросов 1.18.
//  7а — статусы вне словаря (419 спек, 50 решений) сводятся диалогом унификации в мастере «Перенос»: установщик
//       подсказывает код, человек подтверждает группами; без ответа перенос пишет «ждёт решения», а не подставляет молча.
//       Пустой статус сюда не относится: его закрывает общее правило #1634 (вычислить → решение из файла → начальный
//       статус типа, состояние defaulted, перенос не блокирует).
//  8а — пустые типы: md02-empty-types.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDialog, groupBySuggestion } from './status-unify.mjs';
import { applyMap } from './apply-map.mjs';
import { rejectLeftover } from './transfer.mjs';
import { MAP, RULES, VOCAB, CODE_CASE } from './resources.mjs';

const NONE = { format: 'mig-decisions/1', decisions: [] };
const dictOf = T => (RULES.sources.find(s => s.type === T && (s.field === 'status' || s.field === 'status_raw')) || {}).dict;
const ctxOf = (T, decisions = null) => ({ statusDict: dictOf(T), statusVocab: VOCAB, canonToCode: { in_progress: 'active' }, decisions,
  codeCase: CODE_CASE, statusRules: RULES.dictionaries[dictOf(T)] });

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
  // пустой статус спеки — не вопрос человеку: правило #1634 даёт начальный статус типа (defaulted), перенос не блокирует
  assert.equal(row('KnowSpecHist', null).state, 'defaulted');
  const want = { 'KnowDecisionHist|fixed': 'ACCEPTED', 'KnowDecisionHist|done': 'ACCEPTED',
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

test('7а: без ответа человека статус вне словаря не подставляется молча — остаток «ждёт решения»', () => {
  const dr = applyMap('KnowDecisionHist', MAP.KnowDecisionHist, { status_raw: 'fixed' }, ctxOf('KnowDecisionHist'));
  assert.equal(dr.out.status, null, 'код не подставлен');
  assert.deepEqual(dr.rejects.map(x => [x.field, x.why]), [['status_raw', 'статус вне справочника']]);
  const left = rejectLeftover('KnowDecisionHist', '#2:1', dr.rejects[0]);
  assert.equal(left.state, 'ждёт решения');
  assert.equal(left.kind, 'reject');
});

test('7а: ответ человека из диалога применяется переносом (fixed → ACCEPTED); «решу позже» — остаток «отложено человеком»', () => {
  const dec = { format: 'mig-decisions/1', decisions: [
    { id: 'ST-02', scope: { type: 'KnowDecisionHist', field: 'status_raw', value: 'fixed' }, action: 'map_to', to: 'ACCEPTED', by: 'владелица', at: '2026-11-16T16:40:00Z' },
  ] };
  const dr = applyMap('KnowDecisionHist', MAP.KnowDecisionHist, { status_raw: 'fixed' }, ctxOf('KnowDecisionHist', dec));
  assert.equal(dr.out.status, 'ACCEPTED');
  assert.deepEqual(dr.rejects, []);
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
