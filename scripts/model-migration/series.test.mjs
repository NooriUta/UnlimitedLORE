// SPRINT_LORE_PRODUCT_BACKLOG/DBR-07 — временные ряды модели 1.18 заводит установщик переноса.
// Ряд AuditDbLogin (сторож входов в ArcadeDB) объявлен в shared/model/lore-model.json, раздел series;
// DDL строится тем же правилом, что у бэкенда (LoreModelSeries.ddl, LoreModelSeriesTest — тот же текст).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SERIES } from './resources.mjs';
import { seriesDdl, guardGroup, seriesPlan, copySeries } from './series.mjs';
import { structurePlan } from './structure-plan.mjs';
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

// ── Дефект 1.18 (19.11.2026): AgentActionLog и MetricSnapshot заводились только шагами V (V86, ARC-02) ──────────
// На базе из модели шаги V не идут — ряды должны быть объявлены в модели, а установщик — создать их по модели и
// перенести точки источника страницами со сверкой счёта.

// Тексты — как у сервера: AgentActionLog.DDL (V86) и LoreSchemaInitializer (ARC-02) + IF NOT EXISTS.
const ACTION_DDL = 'CREATE TIMESERIES TYPE AgentActionLog IF NOT EXISTS TIMESTAMP ts '
  + 'TAGS (object_type STRING, object_id STRING, source STRING, segment STRING, client STRING, machine STRING) FIELDS (value DOUBLE)';
const METRIC_DDL = 'CREATE TIMESERIES TYPE MetricSnapshot IF NOT EXISTS TIMESTAMP ts '
  + 'TAGS (object_type STRING, object_id STRING, metric STRING, source STRING, segment STRING) FIELDS (value DOUBLE)';

test('журнал действий AgentActionLog и метрики MetricSnapshot объявлены в модели тем же DDL, что у сервера', () => {
  assert.ok(SERIES.AgentActionLog, 'в модели нет series.AgentActionLog');
  assert.ok(SERIES.MetricSnapshot, 'в модели нет series.MetricSnapshot');
  assert.equal(seriesDdl('AgentActionLog', SERIES.AgentActionLog), ACTION_DDL);
  assert.equal(seriesDdl('MetricSnapshot', SERIES.MetricSnapshot), METRIC_DDL);
  for (const T of ['AgentActionLog', 'MetricSnapshot']) assert.ok(ownTypes().includes(T), T + ' — свой тип переноса');
});

const tsType = (name, cols) => ({ name, type: 't', timestampColumn: 'ts', properties: [], indexes: [],
  tsColumns: [{ name: 'ts', dataType: 'LONG', role: 'TIMESTAMP' }, ...cols] });
const ACTION_SRC = tsType('AgentActionLog', ['object_type', 'object_id', 'source', 'segment', 'client', 'machine']
  .map(n => ({ name: n, dataType: 'STRING', role: 'TAG' })).concat([{ name: 'value', dataType: 'DOUBLE', role: 'FIELD' }]));

test('ряд, объявленный в модели, не заводится «как есть» по структуре источника — его DDL берётся из модели', () => {
  const p = structurePlan([ACTION_SRC], {}, {}, SERIES);
  assert.deepEqual(p.types, [], 'объявленный ряд ушёл в шаг «как есть»');
  assert.deepEqual(p.typeDdl, []);
});

test('план рядов: ряд модели есть в источнике — создать по модели и копировать; нет — только создать', () => {
  const plan = seriesPlan([ACTION_SRC], SERIES);
  const by = Object.fromEntries(plan.map(x => [x.name, x]));
  assert.deepEqual(Object.keys(by).sort(), Object.keys(SERIES).sort(), 'каждый ряд модели в плане');
  assert.equal(by.AgentActionLog.ddl, ACTION_DDL);
  assert.equal(by.AgentActionLog.copy, true);
  assert.equal(by.AgentActionLog.ts, 'ts');
  assert.equal(by.MetricSnapshot.copy, false, 'в источнике ряда нет — копировать нечего');
  assert.equal(by.AuditDbLogin.copy, false);
});

test('план рядов: столбец источника, которого нет в модели, — отказ (ряд запечатан, точка бы потерялась)', () => {
  const wider = tsType('AgentActionLog', [...ACTION_SRC.tsColumns.slice(1), { name: 'extra', dataType: 'STRING', role: 'TAG' }]);
  assert.throws(() => seriesPlan([wider], SERIES), /extra/);
  const otherTs = { ...ACTION_SRC, timestampColumn: 'at' };
  assert.throws(() => seriesPlan([otherTs], SERIES), /момент/);
});

const DAY = 86400000, T0 = Date.UTC(2026, 10, 1);
/** Источник в памяти: точки по трём суткам, во вторых — больше потолка ответа, чтобы окно делилось. */
function fakeSource(n2 = 25) {
  const pts = [];
  for (let i = 0; i < 7; i++) pts.push({ ts: T0 + i * 1000, object_type: 'adr', value: i });
  for (let i = 0; i < n2; i++) pts.push({ ts: T0 + DAY + i * 3600, object_type: 'task', value: i });
  pts.push({ ts: T0 + 2 * DAY + 5, object_type: 'sprint', value: 1 });
  pts.push({ ts: T0 + 2 * DAY + 5, object_type: 'sprint', value: 2 }); // два в один момент
  const fmt = ms => new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
  return {
    pts,
    bounds: async () => ({ a: fmt(Math.min(...pts.map(p => p.ts))), b: fmt(Math.max(...pts.map(p => p.ts))) }),
    window: async (a, b) => pts.filter(p => p.ts >= a && p.ts < b).reverse().map(p => ({ ...p, ts: fmt(p.ts) })),
    count: async () => pts.length,
  };
}

test('перенос точек ряда сходится: по страницам, окно сверх потолка делится, счёт до и после равен', async () => {
  const src = fakeSource();
  const got = [];
  const windows = [];
  const r = await copySeries({ ...src, window: async (a, b) => { windows.push([a, b]); return src.window(a, b); },
    insert: async c => { got.push(c); }, cap: 10, concurrency: 1 });
  assert.deepEqual(r, { source: src.pts.length, target: src.pts.length });
  assert.equal(got.length, src.pts.length);
  assert.ok(got.every(c => typeof c.ts === 'number'), 'момент пишется миллисекундами');
  assert.ok(windows.length > 3, 'окно сверх потолка (25 точек при потолке 10) поделено: ' + windows.length);
});

test('перенос точек ряда детерминирован: два прогона — тот же порядок записей, по времени', async () => {
  const run = async () => { const out = []; await copySeries({ ...fakeSource(), insert: async c => { out.push(c); }, cap: 10, concurrency: 1 }); return out; };
  const a = await run(), b = await run();
  assert.deepEqual(a, b);
  assert.deepEqual(a.map(c => c.ts), [...a.map(c => c.ts)].sort((x, y) => x - y), 'точки идут по времени');
});

test('перенос точек ряда: расхождение счёта — отказ, а не тихая потеря', async () => {
  const src = fakeSource();
  await assert.rejects(copySeries({ ...src, count: async () => src.pts.length + 1, insert: async () => {}, cap: 10, concurrency: 1 }), /в источнике/);
});

test('перенос точек ряда: пустой ряд источника — ноль точек, без ошибки', async () => {
  const r = await copySeries({ bounds: async () => ({ a: null, b: null }), window: async () => [], count: async () => 0,
    insert: async () => { throw new Error('нечего писать'); } });
  assert.deepEqual(r, { source: 0, target: 0 });
});
