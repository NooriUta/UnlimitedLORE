// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — повторный перенос в ту же новую базу.
// Найдено 16.11.2026 при повторном прогоне: перенос с очисткой отказывал — «в приёмнике есть чужие типы:
// DEPENDS_ON, IN_PHASE, PART_OF». Это связи, которые кладёт сам конвейер на шаге связей; кнопка
// «Перенести» в интерфейсе на втором запуске упиралась бы в это.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownTypes } from './transfer.mjs';

test('свои типы новой базы: записи, служебный остаток, связь версий и связи с правилом keep', () => {
  const own = ownTypes();
  for (const t of ['KnowSprint', 'KnowTaskHist', 'MigLeftover', 'HAS_STATE', 'PART_OF', 'IN_PHASE', 'DEPENDS_ON', 'MigDictEntry', 'MigDictLabel']) assert.ok(own.includes(t), t);
  // 18.11.2026: переносятся все объекты — связь к любому из них своя; не свои только drop и исходные виды convert.
  assert.ok(own.includes('BELONGS_TO_PROJECT') && own.includes('IMPLEMENTED_IN_RELEASE'));
  for (const t of ['HAS_PR', 'ON_MILESTONE', 'RELEASED_IN', 'INCLUDES']) assert.ok(!own.includes(t), t + ' не переносится своим типом');
});

test('отметка «схема собрана из модели» (MIG-03): свой тип LoreModelSchema, хэш схемы стабилен и меняется со схемой', async () => {
  const { modelMarker } = await import('./transfer.mjs');
  assert.ok(ownTypes().includes('LoreModelSchema'), 'повторный перенос пересоздаёт отметку');
  const a = modelMarker({ A: { fields: { x: { db_type: 'STRING' } } } }, '2026-11-17T00:00:00Z');
  const b = modelMarker({ A: { fields: { x: { db_type: 'STRING' } } } }, '2026-11-18T00:00:00Z');
  const c = modelMarker({ A: { fields: { x: { db_type: 'DATE' } } } }, '2026-11-17T00:00:00Z');
  assert.match(a.model_hash, /^[0-9a-f]{16}$/);
  assert.equal(a.model_hash, b.model_hash, 'хэш зависит от схемы, а не от времени');
  assert.notEqual(a.model_hash, c.model_hash);
  assert.equal(a.source, 'installer');
  assert.equal(a.built_at, '2026-11-17T00:00:00Z');
});

test('имя поля в DDL — в обратных кавычках: зарезервированное слово SQL (trigger у вопроса) не роняет перенос', async () => {
  const { ddlProperty } = await import('./transfer.mjs');
  assert.equal(ddlProperty('KnowQuestion', 'trigger', 'STRING'), 'CREATE PROPERTY KnowQuestion.`trigger` STRING');
  assert.throws(() => ddlProperty('KnowQuestion', 'a`b', 'STRING'), /имя поля/);
});

test('новые связи модели сессий — свои типы: повторный перенос с --reset их пересоздаёт, а не падает на «чужих типах»', () => {
  const own = ownTypes();
  for (const t of ['NEW_ON_MACHINE', 'NEW_IN_PROJECT', 'NEW_RUNS_IN', 'NEW_CHANGED_IN']) assert.ok(own.includes(t), t);
});
