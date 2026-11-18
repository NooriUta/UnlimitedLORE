// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · структура вне переноса: типы без карты и индексы источника.
// Повод (18.11.2026, сервер из migration/model-v2 на копии migration_dst_linux): «Type with name 'MetricSnapshot' was
// not found» (журналы, планы) и «Upsert must involve a UNIQUE index» (ClRoutineRun) — схема из модели заводила только
// типы карты и по одному индексу mig_src_rid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { structurePlan, renamesOf, asIsContent, tsContent } from './structure-plan.mjs';

const SCHEMA = {
  KnowADR: { fields: { adr_id: { from: ['adr_id'] }, created_at: { from: ['created_at', 'date_created'] }, title: { from: ['title'] } } },
  KnowTaskHist: { fields: { status: { from: ['status_raw'] }, status_note: { from: ['status_raw'] }, state_uid: { from: ['state_uid'] } } },
  ClRoutineRun: { fields: { run_id: { from: ['run_id'] }, status: { from: ['status'] } } },
};
const SRC = [
  { name: 'KnowADR', type: 'vertex', properties: [{ name: 'adr_id', type: 'STRING' }, { name: 'date_created', type: 'STRING' }],
    indexes: [{ name: 'KnowADR[adr_id]', unique: true, type: 'LSM_TREE', properties: ['adr_id'] },
              { name: 'KnowADR[date_created]', unique: false, type: 'LSM_TREE', properties: ['date_created'] }] },
  { name: 'KnowTaskHist', type: 'vertex', properties: [], indexes: [{ name: 'KnowTaskHist[state_uid]', unique: true, type: 'LSM_TREE', properties: ['state_uid'] },
              { name: 'KnowTaskHist[gone]', unique: false, type: 'LSM_TREE', properties: ['gone_field'] }] },
  { name: 'ClRoutineRun', type: 'vertex', properties: [], indexes: [{ name: 'ClRoutineRun[run_id]', unique: true, type: 'LSM_TREE', properties: ['run_id'] }] },
  { name: 'MetricSnapshot', type: 'document', properties: [{ name: 'metric', type: 'STRING' }, { name: 'at', type: 'DATETIME' }, { name: 'trigger', type: 'STRING' }],
    indexes: [{ name: 'MetricSnapshot[metric,at]', unique: true, type: 'LSM_TREE', properties: ['metric', 'at'] }] },
  { name: 'HAS_STATE', type: 'edge', properties: [], indexes: [] },
  { name: 'LoreSchemaVersion', type: 'vertex', properties: [{ name: 'version', type: 'INTEGER' }], indexes: [] },
];

test('переименования поля берутся из карты: старое имя → новое; одно имя из нескольких — первое новое', () => {
  assert.deepEqual(renamesOf(SCHEMA.KnowADR), { adr_id: 'adr_id', created_at: 'created_at', date_created: 'created_at', title: 'title' });
  assert.equal(renamesOf(SCHEMA.KnowTaskHist).status_raw, 'status');
});

test('тип без карты заводится пустым с той же структурой; связи и журнал шагов V — нет', () => {
  const p = structurePlan(SRC, SCHEMA);
  assert.deepEqual(p.types.map(t => t.name), ['MetricSnapshot']);
  const m = p.types[0];
  assert.equal(m.kind, 'DOCUMENT');
  assert.deepEqual(m.props, [{ name: 'metric', type: 'STRING' }, { name: 'at', type: 'DATETIME' }, { name: 'trigger', type: 'STRING' }]);
  assert.ok(p.ddl.includes('CREATE DOCUMENT TYPE MetricSnapshot IF NOT EXISTS'));
  assert.ok(p.ddl.includes('CREATE PROPERTY MetricSnapshot.`trigger` IF NOT EXISTS STRING'), 'имена полей — в обратных кавычках (trigger — зарезервированное слово)');
});

test('индексы источника переносятся на новые имена полей; индекс на исчезнувшее поле — в пропуски с причиной', () => {
  const p = structurePlan(SRC, SCHEMA);
  assert.ok(p.ddl.includes('CREATE INDEX IF NOT EXISTS ON KnowADR (`adr_id`) UNIQUE'));
  assert.ok(p.ddl.includes('CREATE INDEX IF NOT EXISTS ON KnowADR (`created_at`) NOTUNIQUE'));
  assert.ok(p.ddl.includes('CREATE INDEX IF NOT EXISTS ON ClRoutineRun (`run_id`) UNIQUE'));
  assert.ok(p.ddl.includes('CREATE INDEX IF NOT EXISTS ON MetricSnapshot (`metric`, `at`) UNIQUE'));
  assert.deepEqual(p.skipped, [{ index: 'KnowTaskHist[gone]', why: 'поля gone_field нет в новой схеме KnowTaskHist' }]);
  assert.ok(p.ddl.includes('CREATE INDEX IF NOT EXISTS ON KnowTaskHist (`state_uid`) UNIQUE'));
});

test('план детерминирован: тот же вход — тот же DDL', () => {
  assert.deepEqual(structurePlan(SRC, SCHEMA).ddl, structurePlan([...SRC].reverse(), SCHEMA).ddl);
});

test('индексы — отдельным списком: их создают ПОСЛЕ записи данных (дубли в данных источника не роняют перенос)', () => {
  // 18.11.2026: уникальный KnowDictEntry(dict_type, code), созданный до записи, уронил перенос на дубле справочника
  // app_setting/qg.actions_projects (SPRINT_LORE_ADMIN_POLISH/AP-DICT-UPSERT-DUP).
  const p = structurePlan(SRC, SCHEMA);
  assert.ok(p.typeDdl.length > 0 && p.typeDdl.every(s => !s.startsWith('CREATE INDEX')));
  assert.ok(p.indexDdl.length > 0 && p.indexDdl.every(s => s.startsWith('CREATE INDEX')));
  assert.deepEqual(p.ddl, [...p.typeDdl, ...p.indexDdl]);
});

test('тип без карты переносится КАК ЕСТЬ: строка источника без служебных @-полей, с ключом происхождения', () => {
  // 18.11.2026: у типов без карты в источнике есть данные (AgentActionLog 9902, MetricSnapshot 56757, Plan* 208) —
  // «пустым со структурой» потеряло бы их.
  const row = { '@rid': '#5:1', '@type': 'MetricSnapshot', '@cat': 'd', metric: 'm', at: '2026-11-18 10:00:00.000', n: 3, trigger: null };
  assert.deepEqual(asIsContent(row), { mig_src_rid: '#5:1', metric: 'm', at: '2026-11-18 10:00:00.000', n: 3 });
});

const TS = { name: 'AgentActionLog', type: 't', timestampColumn: 'ts', properties: [], indexes: [],
  tsColumns: [{ name: 'ts', dataType: 'LONG', role: 'TIMESTAMP' }, { name: 'object_type', dataType: 'STRING', role: 'TAG' },
    { name: 'source', dataType: 'STRING', role: 'TAG' }, { name: 'value', dataType: 'DOUBLE', role: 'FIELD' }] };

test('временной ряд (тип t) заводится своим DDL из колонок источника; ключа происхождения у него нет', () => {
  // 18.11.2026: AgentActionLog и MetricSnapshot — TIMESERIES; строки без @rid, «CREATE DOCUMENT TYPE» их не держит.
  const p = structurePlan([TS], {});
  assert.deepEqual(p.types.map(t => [t.name, t.kind]), [['AgentActionLog', 'TIMESERIES']]);
  assert.deepEqual(p.typeDdl, ['CREATE TIMESERIES TYPE AgentActionLog IF NOT EXISTS TIMESTAMP `ts` TAGS (`object_type` STRING, `source` STRING) FIELDS (`value` DOUBLE)']);
  assert.deepEqual(p.indexDdl, []);
});

test('строка временного ряда: момент строкой UTC → миллисекунды, пустые теги не пишутся', () => {
  assert.deepEqual(tsContent({ ts: '2026-11-07 08:24:29.729', object_type: 'status', source: null, value: 200 }, 'ts'),
    { ts: 1794039869729, object_type: 'status', value: 200 });
});
