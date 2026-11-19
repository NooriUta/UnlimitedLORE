// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — отменённая фаза. В правиле фаз отмены нет (путь BACKLOG → DONE и MOVED);
// пробный расчёт 16.11 оставил одну фазу «🚫 CANCELLED» без кода. ДОПУЩЕНИЕ исполнителя (предложено 16.11,
// владелицей не подтверждено): отменённая фаза получает код MOVED — «вынесена». Переиграть — правкой синонима
// в rules/status-unification.json: значение сводится к коду, строки в разделе «Перенос» у него нет.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from './resources.mjs';
import { classify, checkRules } from './status-unify.mjs';

const PHASE = RULES.dictionaries.phase_status;

test('отменённая фаза — код MOVED (допущение до слова владелицы)', () => {
  assert.deepEqual(classify('🚫 CANCELLED', PHASE), { kind: 'known', code: 'MOVED' });
  assert.deepEqual(classify('CANCELED', PHASE), { kind: 'known', code: 'MOVED' });
});

test('правила после добавления синонима годны', () => {
  assert.deepEqual(checkRules(RULES), []);
});
