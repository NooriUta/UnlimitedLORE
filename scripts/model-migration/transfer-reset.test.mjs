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

// Найдено 19.11.2026 на репетиции 1.18-rc (ryzenai, migration_dst_rc118): второй перенос с --reset отказал —
// «чужие типы: COMPONENT_REPOSITORY, HAS_REPOSITORY, KnowOrganization, KnowRepository, MIRRORED_TO, ORG_HAS_*,
// ORG_MEMBER, USES_REPOSITORY». Их кладёт шаг связей (репозитории и организация) — значит, они свои.
test('типы шага репозиториев и организации — свои: повторный перенос с --reset их пересоздаёт', async () => {
  const { REPO_TYPES } = await import('./repos.mjs');
  const own = ownTypes();
  for (const t of ['KnowRepository', 'KnowOrganization', 'HAS_REPOSITORY', 'COMPONENT_REPOSITORY', 'MIRRORED_TO', 'USES_REPOSITORY', 'DEPENDS_ON_REPOSITORY', 'ORG_HAS_PROJECT', 'ORG_HAS_PRODUCT', 'ORG_MEMBER', 'ORG_HAS_REPOSITORY']) {
    assert.ok(REPO_TYPES.includes(t), t + ' в списке типов шага');
    assert.ok(own.includes(t), t);
  }
});

test('сверка называет поле расхождения: какое поле, что в базе, что ждали — а не обрезанные 300 символов записи', async () => {
  const { fieldDiff } = await import('./transfer.mjs');
  assert.deepEqual(fieldDiff({ a: 1, b: 'x', c: true }, { a: 1, b: 'y', d: 5 }), [
    { field: 'b', got: 'x', want: 'y' }, { field: 'c', got: true, want: undefined }, { field: 'd', got: undefined, want: 5 },
  ]);
  assert.equal(fieldDiff({ t: 'a'.repeat(500) }, { t: 'b' })[0].got.length, 120, 'длинное значение обрезается');
});

test('сверка: дата без времени в поле DATETIME — полночь, как отдаёт база (created_at из date_created у ADR и решений)', async () => {
  const { asRead } = await import('./transfer.mjs');
  assert.equal(asRead('2026-04-23', 'DATETIME'), '2026-04-23 00:00:00.000');
  assert.equal(asRead('2026-04-23T10:11:12.000Z', 'DATETIME'), '2026-04-23 10:11:12.000');
  assert.equal(asRead('2026-04-23', 'DATE'), '2026-04-23');
  assert.equal(asRead(5, 'LONG'), 5);
});
