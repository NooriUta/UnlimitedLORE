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
