// Перенос на базу старше правил: «такого в источнике нет» ≠ ошибка (MIG-04, находки прогона 22.11.2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitGaps, strictMode, gapLine } from './source-gap.mjs';

const problems = [
  { kind: 'rule_gate_missing', qg_id: 'QG-LORE-BLOCKED-REASON' },
  { kind: 'no_project', qg_id: 'QG-X' },
];

test('строгий режим — только по явной переменной нашей трубы', () => {
  assert.equal(strictMode({}), false, 'у друга переменной нет — режим мягкий');
  assert.equal(strictMode({ LORE_MIGRATE_STRICT: '1' }), true);
  assert.equal(strictMode({ LORE_MIGRATE_STRICT: 'true' }), true);
  assert.equal(strictMode({ LORE_MIGRATE_STRICT: '0' }), false, '0 — это выключено, а не «что-то задано»');
});

test('мягкий режим: отсутствие в источнике не блокирует, расхождение блокирует', () => {
  const g = splitGaps(problems, ['rule_gate_missing'], { strict: false });
  assert.deepEqual(g.absent.map(p => p.kind), ['rule_gate_missing']);
  assert.deepEqual(g.mismatch.map(p => p.kind), ['no_project']);
  assert.deepEqual(g.blocking.map(p => p.kind), ['no_project'], 'красным остаётся только настоящее расхождение');
});

test('строгий режим: наша труба краснеет и на пропуске — там это дефект правила', () => {
  const g = splitGaps(problems, ['rule_gate_missing'], { strict: true });
  assert.equal(g.blocking.length, 2);
});

test('пропущенное называется поимённо — молчать нельзя', () => {
  const g = splitGaps(problems, ['rule_gate_missing'], { strict: false });
  const line = gapLine(g.absent, p => p.qg_id);
  assert.match(line, /QG-LORE-BLOCKED-REASON/);
  assert.match(line, /пропущено, не ошибка/);
  assert.equal(gapLine([]), '', 'нечего пропускать — строки нет вовсе');
});

test('пустой и отсутствующий список отклонений не ломают разбор', () => {
  assert.deepEqual(splitGaps(undefined, ['x'], { strict: false }), { absent: [], mismatch: [], blocking: [] });
  assert.deepEqual(splitGaps([], ['x'], { strict: true }), { absent: [], mismatch: [], blocking: [] });
});
