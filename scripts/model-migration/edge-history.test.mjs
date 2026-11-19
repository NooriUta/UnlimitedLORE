// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-02 — историчные связи при переносе: список и поля берутся из модели,
// ребру ставится «действует с», у текущих «действует по» пусто, свойства объявлены в схеме приёмника.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HISTORIC_EDGES, EDGE_HISTORY_FIELDS, isHistoric, edgeVersion, edgeHistoryDdl, outMomentsQuery, stampEdgeHistory } from './edge-history.mjs';

const AT = '2026-11-19T10:00:00.000Z';

test('историчные связи и поля версии — из модели', () => {
  assert.deepEqual([...HISTORIC_EDGES].sort(), ['FILLS_ROLE', 'HAS_PROJECT_ROLE', 'IN_PHASE', 'ROLE_HELD_BY', 'TARGETS_MILESTONE']);
  assert.deepEqual(EDGE_HISTORY_FIELDS, ['valid_from', 'valid_to']);
  assert.ok(!isHistoric('PART_OF'));
});

test('valid_from: своё у ребра, потом момент создания, потом первая версия записи, потом момент переноса', () => {
  assert.deepEqual(edgeVersion({ valid_from: '2026-08-31T06:06:07.177807935Z', valid_to: '2026-09-15T13:58:46.674Z' }, AT),
    { valid_from: '2026-08-31T06:06:07.177Z', valid_to: '2026-09-15T13:58:46.674Z', source: 'edge.valid_from' }, 'закрытое ребро сохраняет valid_to');
  assert.equal(edgeVersion({ created_at: '2026-10-01 12:00:00' }, AT).source, 'edge.created_at');
  const v = edgeVersion({ out_versions: ['2026-10-05T00:00:00Z', '2026-09-01 08:00:00.000'] }, AT);
  assert.deepEqual(v, { valid_from: '2026-09-01T08:00:00.000Z', valid_to: null, source: 'out.first_version' });
  assert.equal(edgeVersion({ out_created: '2026-07-01' }, AT).valid_from, '2026-07-01T00:00:00.000Z');
  assert.deepEqual(edgeVersion({}, AT), { valid_from: AT, valid_to: null, source: 'transfer' });
});

test('схема приёмника: поля версии объявлены у историчной связи и только у неё', () => {
  assert.deepEqual(edgeHistoryDdl('IN_PHASE'), ['CREATE PROPERTY IN_PHASE.valid_from DATETIME', 'CREATE PROPERTY IN_PHASE.valid_to DATETIME']);
  assert.deepEqual(edgeHistoryDdl('PART_OF'), []);
});

// После слияния с шагом связей всех объектов (edgePlan / edgeWrites, 19.11.2026) поля версии ставятся записям
// writes[T] перед CREATE EDGE — проверяется сама простановка и запрос моментов записи-начала.
test('шаг связей: IN_PHASE получает valid_from из первой версии записи, PART_OF не трогается', () => {
  const inPhase = [{ from: '#10:0', to: '#20:0', content: { mig_src_rid: '#50:0' } }];
  const partOf = [{ from: '#10:0', to: '#30:0', content: { mig_src_rid: '#51:0' } }];
  const moments = new Map([['#50:0', { out_versions: ['2026-09-01T08:00:00Z'] }]]);
  assert.deepEqual(stampEdgeHistory('IN_PHASE', inPhase, moments, AT), { 'out.first_version': 1 });
  assert.deepEqual(inPhase.map(w => [w.content.valid_from, w.content.valid_to]), [['2026-09-01T08:00:00.000Z', undefined]]);
  assert.equal(stampEdgeHistory('PART_OF', partOf, moments, AT), null);
  assert.ok(!('valid_from' in partOf[0].content), 'неисторичная связь без полей версии');
});

test('шаг связей: закрытое ребро сохраняет valid_to, без моментов — момент переноса', () => {
  const list = [
    { content: { mig_src_rid: '#1:0', valid_from: '2026-08-31T06:06:07Z', valid_to: '2026-09-15T13:58:46Z' } },
    { content: { mig_src_rid: '#1:1' } },
  ];
  assert.deepEqual(stampEdgeHistory('ROLE_HELD_BY', list, new Map(), AT), { 'edge.valid_from': 1, transfer: 1 });
  assert.equal(list[0].content.valid_to, '2026-09-15T13:58:46.000Z');
  assert.equal(list[1].content.valid_from, AT);
});

test('шаг связей читает моменты записи-начала у историчной связи и объявляет поля версии', () => {
  assert.match(outMomentsQuery('IN_PHASE', '#-1:-1'), /out_created.*out_versions.*FROM IN_PHASE WHERE @rid > #-1:-1/);
  const src = fs.readFileSync(new URL('./transfer-edges.mjs', import.meta.url), 'utf8');
  assert.match(src, /edgeHistoryDdl\(T\)/, 'типу связи в приёмнике объявляются поля версии');
  assert.match(src, /stampEdgeHistory\(T, list, outMoments, at\)/, 'записям связи ставятся поля версии до CREATE EDGE');
});

