// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — повторный перенос в ту же новую базу.
// Найдено 16.11.2026 при повторном прогоне: перенос с очисткой отказывал — «в приёмнике есть чужие типы:
// DEPENDS_ON, IN_PHASE, PART_OF». Это связи, которые кладёт сам конвейер на шаге связей; кнопка
// «Перенести» в интерфейсе на втором запуске упиралась бы в это.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownTypes } from './transfer.mjs';

test('свои типы новой базы: записи, служебный остаток, связь версий и связи с правилом keep', () => {
  const own = ownTypes();
  for (const t of ['KnowSprint', 'KnowTaskHist', 'MigLeftover', 'HAS_STATE', 'PART_OF', 'IN_PHASE', 'DEPENDS_ON']) assert.ok(own.includes(t), t);
  assert.ok(!own.includes('BELONGS_TO_PROJECT'), 'связь, ждущая своего объекта, не своя — её типа в новой базе быть не должно');
});
