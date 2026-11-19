// D-2026-MIG-PLAN-BOARD-INSTALLER-OPTION · владелица 19.11.2026: «поставь как настройку тому кто устанавливает»,
// «по умолчанию удалить». Настройка — ключ MIG_PLAN_BOARD файла доступа: drop (по умолчанию) | keep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notMovedFor, NOT_MOVED } from './resources.mjs';
import { checkEnv } from './env.mjs';

const base = { MIG_DB_URL: 'http://x', MIG_SRC_DB: 's', MIG_SRC_USER: 'u', MIG_SRC_PASSWORD: 'p', MIG_DST_DB: 'migration_dst_t', MIG_DST_USER: 'u', MIG_DST_PASSWORD: 'p' };

test('по умолчанию доска плана не переносится', () => {
  const nm = notMovedFor(base);
  for (const t of ['PlanConfig', 'PlanTrack', 'PlanSection', 'PlanCheckpoint', 'PlanVersion']) assert.ok(nm[t], t);
  assert.deepEqual(notMovedFor({ ...base, MIG_PLAN_BOARD: 'drop' }), nm);
});

test('keep — типы Plan* переносятся как есть, прочее «не переносить» остаётся', () => {
  const nm = notMovedFor({ ...base, MIG_PLAN_BOARD: 'keep' });
  assert.equal(Object.keys(nm).filter(t => t.startsWith('Plan')).length, 0);
  assert.ok(nm.LoreSchemaVersion, 'журнал шагов V не переносится при любой настройке');
  assert.ok(Object.keys(NOT_MOVED).some(t => t.startsWith('Plan')), 'общий список не портится');
});

test('чужое значение настройки — ошибка файла доступа', () => {
  assert.deepEqual(checkEnv(base), []);
  assert.deepEqual(checkEnv({ ...base, MIG_PLAN_BOARD: 'keep' }), []);
  assert.ok(checkEnv({ ...base, MIG_PLAN_BOARD: 'maybe' }).some(e => e.includes('MIG_PLAN_BOARD')));
});
