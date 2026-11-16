// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — предложения конвейера для незнакомых статусов и их компоновка.
// Слова владелицы 16.11.2026: «так предложение сразу кнопкой сделай», «по спринту хоть какой то алгоритм
// предложений и компоновки». Значения ниже — настоящие из снимка прода 15.11 (статусы версий спринтов).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { suggest, buildDialog, groupBySuggestion, checkRules } from './status-unify.mjs';

const RULES = JSON.parse(fs.readFileSync(new URL('./rules/status-unification.json', import.meta.url), 'utf8'));
const plan = RULES.dictionaries.plan_status, phase = RULES.dictionaries.phase_status;
const S = v => suggest(v, plan, RULES.hints, 'plan_status');

test('правила подсказок годны: каждая ведёт к коду хотя бы одного справочника или прямо говорит «не статус»', () => {
  assert.deepEqual(checkRules(RULES), []);
  assert.ok(RULES.hints.length >= 10);
  const broken = structuredClone(RULES);
  broken.hints.push({ tier: 'word', match: 'XYZ', to: 'НЕТ_ТАКОГО', why: 'x' });
  assert.match(checkRules(broken).join('; '), /НЕТ_ТАКОГО/);
});

test('закрытые спринты: значок и слово сходятся — DONE', () => {
  for (const v of ['✅ CLOSED', '✅ CLOSED — PROD 2026-06-04 v1.4.6', '✅ MERGED — ветка влита в develop, CI зелёный',
    '✅ **MERGED 02.05.2026** — PR #103 (`c11da23`) в master', '✅ ЗАКРЫТ (11.06.2026) → **v1.6.5 PROD**',
    '✅ **КОД В ПРОДЕ v1.5.0** (M3 Sprint-1)', '✅ FULLY CLOSED (2026-06-10) — PR #317', 'ЗАВЕРШЁН (v1.3.7)', '✅ SPRINT CLOSED — PR #59 merged'])
    assert.equal(S(v).code, 'DONE', v);
});

test('фраза сильнее значка: «код готов, ждёт CI» — не DONE, а REVIEW', () => {
  const r = S('✅ **CODE COMPLETE 02.05.2026** — выполнено за 1 день, ожидает CI + PR');
  assert.equal(r.code, 'REVIEW');
  assert.match(r.why, /CODE COMPLETE/);
  assert.equal(S('🟡 CODE COMPLETE → PR #249 → develop (CI in progress)').code, 'REVIEW');
  assert.equal(S('🟢 READY FOR REVIEW — Backend complete').code, 'REVIEW');
});

test('идущие, отложенные, не начатые, исследование', () => {
  assert.equal(S('🔨 ОТКРЫТ (12.06.2026)').code, 'ACTIVE');
  assert.equal(S('🔄 В РАБОТЕ — 6/12 задач выполнено').code, 'ACTIVE');
  // найдено в интерфейсе 16.11: слово «pending» в хвосте не должно перебивать «В РАБОТЕ» в начале
  assert.equal(S('🔄 В РАБОТЕ — 6/12 задач выполнено (HK-1/2/4/6/8/9 ✅; HK-5/7/10/11/12/13 pending)').code, 'ACTIVE');
  assert.equal(S('⏸ PAUSED').code, 'WAITING'); // как решение владелицы ST-09
  assert.equal(S('⏳ Pending — старт Jun 8, 2026 (W7)').code, 'PLANNED');
  assert.equal(S('⬜ OPEN').code, 'TODO');
  assert.equal(S('📋 OPEN — не начат').code, 'TODO');
  assert.equal(S('⬜ Stub — требует проработки').code, 'BACKLOG');
  assert.equal(S('⬜ Proposed').code, 'BACKLOG');
  assert.equal(S('🔬 RESEARCH').code, 'DESIGN');
  assert.equal(S('🔬 **ИССЛЕДОВАНИЕ** (research) — выводы').code, 'DESIGN');
  assert.equal(S('🔵 PLANNING').code, 'PLANNED');
  assert.equal(S('🟡 PHASES 0-6 DONE — Phase 7 partial, Phase 8 pending').code, 'PARTIAL');
});

test('не статус — так и сказано, кода нет: приоритет в поле статуса', () => {
  for (const v of ['🔴 P0', 'medium']) {
    const r = S(v);
    assert.equal(r.code, null, v);
    assert.match(r.why, /приоритет/, v);
  }
});

test('ничего не узнано — предложения нет, причина названа', () => {
  const r = S('**SPLIT 2026-06-04** — tracked as two separate items');
  assert.equal(r.code, null);
  assert.ok(r.why.length > 5);
});

test('код предлагается, только если он есть в справочнике типа', () => {
  // у фазы нет REVIEW и TODO — подсказка, ведущая к ним, для фазы молчит
  assert.equal(suggest('⬜ OPEN', phase, RULES.hints, 'phase_status').code, null);
  assert.equal(suggest('🟡 PARTIAL', phase, RULES.hints, 'phase_status').code, 'ACTIVE');
});

test('компоновка: строки собраны по предложенному коду в порядке справочника (путь задачи), без предложения — в конце', () => {
  const counts = [
    { type: 'KnowSprintHist', field: 'status_raw', value: '✅ CLOSED', n: 7 },
    { type: 'KnowSprintHist', field: 'status_raw', value: '🔨 ОТКРЫТ (12.06.2026)', n: 4 },
    { type: 'KnowSprintHist', field: 'status_raw', value: '✅ MERGED — ветка влита', n: 3 },
    { type: 'KnowSprintHist', field: 'status_raw', value: '**SPLIT** — два элемента', n: 1 },
    { type: 'KnowSprintHist', field: 'status_raw', value: null, n: 17 },
  ];
  const d = buildDialog(counts, RULES, { format: 'mig-decisions/1', decisions: [] });
  const g = groupBySuggestion(d.rows.filter(r => r.type === 'KnowSprintHist'));
  assert.deepEqual(g.map(x => [x.code, x.rows.length, x.n]), [['BACKLOG', 1, 17], ['ACTIVE', 1, 4], ['DONE', 2, 10], [null, 1, 1]]);
  const empty = d.rows.find(r => r.value === null);
  assert.match(empty.suggestWhy, /пустого статуса нет/);
  assert.equal(empty.suggest, 'BACKLOG', '«если статус не указан при создании ставим первый статус в беклог»');
});

test('у фазы незнакомый текст назван «похоже на название фазы» — по правилу карты он уходит в название', () => {
  const r = suggest('Alert Engine', phase, RULES.hints, 'phase_status');
  assert.equal(r.code, null);
  assert.match(r.why, /название фазы/);
});
