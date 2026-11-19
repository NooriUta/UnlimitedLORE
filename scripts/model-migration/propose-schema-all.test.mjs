// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Предложение схемы всех объектов (кроме первого) — правило типа поля.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldType, sourcesOf } from './propose-schema-all.mjs';

test('преобразование — тип из правила: дата, момент, код справочника', () => {
  assert.deepEqual(fieldType({ rule: 'transform', how: 'DATE' }), { kind: 'date', db_type: 'DATE' });
  assert.deepEqual(fieldType({ rule: 'transform', how: 'DATETIME' }), { kind: 'datetime', db_type: 'DATETIME' });
  for (const how of ['status', 'priority', 'harness']) assert.deepEqual(fieldType({ rule: 'transform', how }), { kind: 'enum', db_type: 'STRING' });
});

test('как есть — объявленный тип прода; не объявлен — строкой с пометкой', () => {
  assert.deepEqual(fieldType({ rule: 'keep' }, 'INTEGER'), { kind: 'number', db_type: 'INTEGER' });
  assert.deepEqual(fieldType({ rule: 'keep' }, 'BOOLEAN'), { kind: 'bool', db_type: 'BOOLEAN' });
  assert.deepEqual(fieldType({ rule: 'keep' }, 'STRING'), { kind: 'text', db_type: 'STRING' });
  assert.deepEqual(fieldType({ rule: 'keep' }, undefined), { kind: 'text', db_type: 'STRING', note: 'в схеме прода не объявлено — строкой' });
});

test('откуда пришло поле: как есть — то же имя; преобразование — по to', () => {
  const map = { created_date: { rule: 'transform', how: 'DATE', to: 'created_at' }, name: { rule: 'keep' }, junk: { rule: 'drop' } };
  assert.deepEqual(sourcesOf(map, 'created_at'), ['created_date']);
  assert.deepEqual(sourcesOf(map, 'name'), ['name']);
  assert.deepEqual(sourcesOf(map, 'junk'), []);
});

test('не объявлено в проде — тип по фактическим значениям: целые → LONG, дроби → DOUBLE, да/нет → BOOLEAN, список → LIST', async () => {
  const { valueKind } = await import('./propose-schema-all.mjs');
  assert.deepEqual([4427, 0.5, false, [], {}, 'x'].map(valueKind), ['integer', 'number', 'boolean', 'list', 'map', 'string']);
  assert.deepEqual(fieldType({ rule: 'keep' }, undefined, { integer: 418 }), { kind: 'number', db_type: 'LONG', note: 'в схеме прода не объявлено — тип по значениям' });
  assert.deepEqual(fieldType({ rule: 'keep' }, undefined, { integer: 3, number: 2 }).db_type, 'DOUBLE');
  assert.deepEqual(fieldType({ rule: 'keep' }, undefined, { boolean: 7 }).db_type, 'BOOLEAN');
  assert.deepEqual(fieldType({ rule: 'keep' }, undefined, { list: 84 }).db_type, 'LIST');
  assert.deepEqual(fieldType({ rule: 'keep' }, undefined, { string: 2, integer: 1 }), { kind: 'text', db_type: 'STRING', note: 'в схеме прода не объявлено, значения разных типов — строкой' });
  assert.equal(fieldType({ rule: 'keep' }, 'INTEGER', { string: 5 }).db_type, 'INTEGER', 'объявленный тип прода сильнее');
});
