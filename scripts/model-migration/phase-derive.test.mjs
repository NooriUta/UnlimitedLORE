// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — статус фазы без кода выводится из её задач.
// Слова владелицы 16.11.2026 на вопрос «фазы, у которых в поле статуса название — какой статус?»:
// «статус ставишь минимальный по задачам входящим в фазу».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { derivePhaseStatus, buildDialog, checkRules } from './status-unify.mjs';

const RULES = JSON.parse(fs.readFileSync(new URL('./rules/status-unification.json', import.meta.url), 'utf8'));
const D = RULES.dictionaries.phase_status.derive;

test('правило вывода записано в правилах и годно', () => {
  assert.equal(D.from, 'tasks_min');
  assert.deepEqual(checkRules(RULES), []);
  const broken = structuredClone(RULES);
  broken.dictionaries.phase_status.derive.map.DONE = 'НЕТ_ТАКОГО';
  assert.match(checkRules(broken).join('; '), /НЕТ_ТАКОГО/);
});

test('минимальный по задачам: самый ранний этап пути среди задач фазы', () => {
  assert.equal(derivePhaseStatus(['DONE', 'ACTIVE', 'DONE'], D).code, 'ACTIVE');
  assert.equal(derivePhaseStatus(['DONE', 'TODO'], D).code, 'BACKLOG');
  assert.equal(derivePhaseStatus(['DONE', 'DESIGN', 'READY_FOR_DEPLOY'], D).code, 'PLANNED');
  assert.equal(derivePhaseStatus(['DONE', 'DONE'], D).code, 'DONE');
  assert.equal(derivePhaseStatus(['UAT', 'BLOCKED', 'DONE'], D).code, 'ACTIVE');
});

test('отменённые задачи не тянут фазу вниз; фаза без задач — статус по умолчанию, и это названо', () => {
  assert.equal(derivePhaseStatus(['CANCELLED', 'DONE'], D).code, 'DONE');
  const none = derivePhaseStatus([], D);
  assert.equal(none.code, 'BACKLOG');
  assert.match(none.why, /задач нет/);
  const onlyCancelled = derivePhaseStatus(['CANCELLED'], D);
  assert.equal(onlyCancelled.code, 'BACKLOG');
  assert.match(onlyCancelled.why, /задач нет|отменены/);
  assert.match(derivePhaseStatus(['DONE', 'ACTIVE'], D).why, /2 задач/);
});

test('незнакомый статус задачи не теряется молча — назван в причине', () => {
  const r = derivePhaseStatus(['DONE', 'СТРАННЫЙ'], D);
  assert.equal(r.code, 'DONE');
  assert.match(r.why, /СТРАННЫЙ/);
});

test('в диалоге фаза без кода больше не ждёт решения: статус выводится из задач при переносе', () => {
  const d = buildDialog([
    { type: 'KnowPhaseHist', field: 'status_raw', value: 'Alert Engine', n: 1 },
    { type: 'KnowPhaseHist', field: 'status_raw', value: '🟡 PARTIAL', n: 7 },
    { type: 'KnowPhaseHist', field: 'status_raw', value: null, n: 2 },
  ], RULES, { format: 'mig-decisions/1', decisions: [] });
  for (const r of d.rows) {
    assert.equal(r.state, 'unified', String(r.value));
    assert.equal(r.derived, 'tasks_min');
  }
  assert.equal(d.summary.needs_decision, 0);
});
