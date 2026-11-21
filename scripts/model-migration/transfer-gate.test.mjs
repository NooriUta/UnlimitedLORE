// Playwright-проход мастера 20.11: мастер не начинает перенос, пока на шаге 2 есть значения без решения, а
// консольный transfer начинал — агентская репетиция прошла с REJECTED в остатке. Правило одно для обоих путей.
import test from 'node:test';
import assert from 'node:assert/strict';
import { transferGate } from './transfer-gate.mjs';

test('всё решено — можно', () => {
  assert.deepEqual(transferGate({ needsDecision: 0, missingKinds: [], unread: 0 }), { ok: true, reasons: [] });
});

test('значения без решения или продукт без вида — стоп с причиной словами', () => {
  const g = transferGate({ needsDecision: 2, missingKinds: ['VOLVA'], unread: 0 });
  assert.equal(g.ok, false);
  assert.ok(g.reasons.some(r => r.includes('ждут решения 2')));
  assert.ok(g.reasons.some(r => r.includes('VOLVA')));
});

test('источник прочитан не весь — стоп', () => {
  assert.equal(transferGate({ needsDecision: 0, missingKinds: [], unread: 3 }).ok, false);
});

test('--allow-pending — явный обход, причины всё равно названы', () => {
  const g = transferGate({ needsDecision: 2, missingKinds: [], unread: 0, allowPending: true });
  assert.equal(g.ok, true);
  assert.ok(g.reasons.length > 0);
});
