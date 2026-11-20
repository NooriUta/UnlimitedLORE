// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Шаг мастера «Вид зависимостей»: связи DEPENDS_ON без вида (прод 16.11 — 30
// спринтовых, все без причины). Владелица 20.11.2026: «дополнительный визард для миграции у нас прочесть и предложить».
// Мастер читает описание, итог, причину блокировки обоих спринтов и предлагает вид с подсказкой; решает человек —
// группой или по одной. Без ответа — без вида, «ждёт решения». Ответ — раздел dependency_kinds файла решений.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { proposeDepKinds, depKindAnswers, withDepKinds, depKindState } from './dep-kinds.mjs';

const RULES = JSON.parse(fs.readFileSync(new URL('./rules/status-unification.json', import.meta.url), 'utf8'));
const S = (id, name, texts = {}) => ({ id, name, ...texts });

const edges = [
  { from: S('SPRINT_WAVE1_UI', 'Волна 1: UI', { context_md: 'Стартуем только после SPRINT_WAVE0_5MIN_DEMO — без демо нечего показывать.' }), to: S('SPRINT_WAVE0_5MIN_DEMO', 'Демо за 5 минут') },
  { from: S('SPRINT_ALERTS', 'Оповещения', { context_md: 'Метрики берём из AIDA_TIMESERIES как входные данные.' }), to: S('SPRINT_AIDA_TIMESERIES', 'Временные ряды') },
  { from: S('SPRINT_UPGRADE', 'Обновление', { block_reason: 'ждём ответа по SPRINT_AUDIT' }), to: S('SPRINT_AUDIT', 'Аудит') },
  { from: S('SPRINT_X', 'X', { outcome_md: 'Выкатка после go/no-go проверки в SPRINT_Y' }), to: S('SPRINT_Y', 'Y') },
  { from: S('SPRINT_LOOM_5K', 'Loom'), to: S('SPRINT_ELK_M2_KNOT', 'ELK', { context_md: 'Раскладка ELK.' }) },
  { from: S('SPRINT_P', 'P', { context_md: 'См. также SPRINT_Q.' }), to: S('SPRINT_Q', 'Q') },
];

test('предложение по тексту обоих спринтов: вид, основание — фраза, где назван другой спринт', () => {
  const rows = proposeDepKinds(edges, RULES);
  const by = Object.fromEntries(rows.map(r => [r.key, r]));
  assert.equal(by['SPRINT_WAVE1_UI>SPRINT_WAVE0_5MIN_DEMO'].suggest, 'blocks');
  assert.match(by['SPRINT_WAVE1_UI>SPRINT_WAVE0_5MIN_DEMO'].why, /только после SPRINT_WAVE0_5MIN_DEMO/);
  assert.equal(by['SPRINT_ALERTS>SPRINT_AIDA_TIMESERIES'].suggest, 'informs', 'имя без приставки SPRINT_ тоже узнаётся');
  assert.equal(by['SPRINT_UPGRADE>SPRINT_AUDIT'].suggest, 'waits');
  assert.equal(by['SPRINT_X>SPRINT_Y'].suggest, 'gate');
  assert.equal(by['SPRINT_P>SPRINT_Q'].suggest, 'relates', 'назван без слова о характере — «связано»');
  assert.equal(by['SPRINT_LOOM_5K>SPRINT_ELK_M2_KNOT'].suggest, null, 'связь в текстах не объяснена — «какой?»');
  assert.match(by['SPRINT_LOOM_5K>SPRINT_ELK_M2_KNOT'].why, /не объяснена/);
  for (const r of rows) assert.ok(r.suggest === null || RULES.dictionaries.dependency_kind.codes.some(c => c.code === r.suggest));
  assert.deepEqual(rows.map(r => r.key), [...rows.map(r => r.key)].sort(), 'порядок по ключу — те же данные, тот же ответ');
});

test('ответы: группой и по одной, кто и когда рядом; код не из справочника и пустое «кто» — отказ', () => {
  const doc0 = { format: 'mig-decisions/1', decisions: [] };
  const doc1 = withDepKinds(doc0, { 'SPRINT_WAVE1_UI>SPRINT_WAVE0_5MIN_DEMO': 'blocks', 'SPRINT_P>SPRINT_Q': null }, 'omiloreadmin', RULES, '2026-11-20T10:00:00Z');
  assert.deepEqual(depKindAnswers(doc1), { 'SPRINT_WAVE1_UI>SPRINT_WAVE0_5MIN_DEMO': 'blocks', 'SPRINT_P>SPRINT_Q': null });
  assert.equal(doc1.dependency_kinds.by, 'omiloreadmin');
  const doc2 = withDepKinds(doc1, { 'SPRINT_X>SPRINT_Y': 'gate' }, 'omiloreadmin', RULES);
  assert.equal(Object.keys(depKindAnswers(doc2)).length, 3, 'прежние ответы сохраняются');
  assert.throws(() => withDepKinds(doc0, { a: 'blocker' }, 'x', RULES), /не из справочника/);
  assert.throws(() => withDepKinds(doc0, { a: 'blocks' }, '', RULES), /кто принял/);
  assert.equal(withDepKinds(doc0, { a: 'hard' }, 'x', RULES).dependency_kinds.map.a, 'blocks', 'синоним — к коду');
});

test('итог: по ответу — вид, «без вида» — решено, без ответа — ждёт решения', () => {
  const rows = proposeDepKinds(edges, RULES);
  const st = depKindState(rows, { 'SPRINT_WAVE1_UI>SPRINT_WAVE0_5MIN_DEMO': 'blocks', 'SPRINT_P>SPRINT_Q': null });
  assert.equal(st.kind.length, 1);
  assert.equal(st.keep.length, 1);
  assert.equal(st.waiting.length, 4);
});
