// SPRINT_LORE_PRODUCT_BACKLOG/DBR-07 — временные ряды модели 1.18 заводит установщик переноса.
// Ряд AuditDbLogin (сторож входов в ArcadeDB) объявлен в shared/model/lore-model.json, раздел series;
// DDL строится тем же правилом, что у бэкенда (LoreModelSeries.ddl, LoreModelSeriesTest — тот же текст).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SERIES } from './resources.mjs';
import { seriesDdl, guardGroup } from './series.mjs';
import { ownTypes } from './transfer.mjs';
import { COLUMNS } from '../../deploy/db-guard/lib.mjs';

const AUDIT_DDL = 'CREATE TIMESERIES TYPE AuditDbLogin IF NOT EXISTS TIMESTAMP ts '
  + 'TAGS (user STRING, src_ip STRING, src_container STRING, database STRING, method STRING, path STRING) '
  + 'FIELDS (status INTEGER)';

test('ряд AuditDbLogin объявлен в модели и DDL совпадает с бэкендом', () => {
  assert.ok(SERIES.AuditDbLogin, 'в модели нет series.AuditDbLogin');
  assert.equal(seriesDdl('AuditDbLogin', SERIES.AuditDbLogin), AUDIT_DDL);
});

test('столбцы, которые пишет сторож, — ровно столбцы ряда в модели', () => {
  const s = SERIES.AuditDbLogin;
  assert.deepEqual(COLUMNS, [s.timestamp, ...Object.keys(s.tags), ...Object.keys(s.fields)]);
});

test('ряд — свой тип переноса: повторный перенос с очисткой его не считает чужим', () => {
  assert.ok(ownTypes().includes('AuditDbLogin'));
});

test('группа сторожа: только создание записей в AuditDbLogin, ни схемы, ни чтения прочих типов', () => {
  const g = guardGroup('system_aida_lore');
  const grp = g.databases.system_aida_lore.groups['db-guard'];
  assert.deepEqual(grp.access, [], 'права на базу целиком (updateSchema и т.п.) — пусто');
  assert.deepEqual(Object.keys(grp.types), ['AuditDbLogin']);
  assert.deepEqual(grp.types.AuditDbLogin.access, ['createRecord']);
});

test('негодное имя столбца — отказ, а не DDL с подстановкой', () => {
  assert.throws(() => seriesDdl('AuditDbLogin', { timestamp: 'ts', tags: { 'u; DROP TYPE X': 'STRING' }, fields: {} }), /идентификатор/);
  assert.throws(() => seriesDdl('AuditDbLogin', { timestamp: 'ts', tags: { u: 'BLOB' }, fields: {} }), /тип/);
});
