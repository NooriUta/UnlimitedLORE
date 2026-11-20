// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-02 — историчные связи при переносе: список и поля берутся из модели,
// ребру ставится «действует с», у текущих «действует по» пусто, свойства объявлены в схеме приёмника.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HISTORIC_EDGES, EDGE_HISTORY_FIELDS, isHistoric, edgeVersion, edgeHistoryDdl, outMomentsQuery, stampEdgeHistory } from './edge-history.mjs';

const AT = '2026-11-19T10:00:00.000Z';

test('историчные связи и поля версии — из модели', () => {
  assert.deepEqual([...HISTORIC_EDGES].sort(), ['ANSWERABLE_BY', 'DEPENDS_ON', 'FILLS_ROLE', 'HAS_PROJECT_ROLE', 'IN_PHASE', 'ON_TRACK', 'ROLE_HELD_BY', 'TARGETS_MILESTONE']); // DEPENDS_ON, ON_TRACK — MDL-13
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

// Найдено 19.11.2026 на репетиции 1.18-rc: два переноса с одними настройками дали разные отпечатки
// (FILLS_ROLE, HAS_PROJECT_ROLE, TARGETS_MILESTONE) — «момент переноса» брался часами машины. Теперь это момент
// снимка источника: самая поздняя версия записей источника. Те же данные → тот же момент → тот же отпечаток.
test('момент переноса для связей без своего момента — снимок источника, а не часы машины', async () => {
  const { sourceMoment } = await import('./edge-history.mjs');
  const asked = [];
  const db = { async src(q) {
    asked.push(q);
    if (/FROM KnowTaskHist/.test(q)) return [{ m: '2026-11-18 10:22:09.589' }];
    if (/FROM KnowSprintHist/.test(q)) return [{ m: '2026-11-17 07:23:01.638' }];
    if (/FROM KnowGone/.test(q)) throw new Error('нет типа');
    return [{ m: null }];
  } };
  assert.equal(await sourceMoment(db, ['KnowTaskHist', 'KnowSprintHist', 'KnowPhaseHist', 'KnowGone']), '2026-11-18T10:22:09.589Z');
  assert.ok(asked.every(q => /max\(valid_from\)/.test(q)));
  await assert.rejects(sourceMoment({ async src() { return [{ m: null }]; } }, ['KnowTaskHist']), /момент/);
  const src = fs.readFileSync(new URL('./transfer-edges.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /at = new Date\(\)/, 'шаг связей не берёт момент с часов машины');
});

test('шаг связей читает моменты записи-начала у историчной связи и объявляет поля версии', () => {
  assert.match(outMomentsQuery('IN_PHASE', '#-1:-1'), /out_created.*out_versions.*FROM IN_PHASE WHERE @rid > #-1:-1/);
  const src = fs.readFileSync(new URL('./transfer-edges.mjs', import.meta.url), 'utf8');
  assert.match(src, /edgeHistoryDdl\(T\)/, 'типу связи в приёмнике объявляются поля версии');
  assert.match(src, /stampEdgeHistory\(T, list, outMoments, at\)/, 'записям связи ставятся поля версии до CREATE EDGE');
});


// Владелица 19.11.2026: дата новой связи — последнее обновление её объектов (обоих концов), до момента снимка.
test('нет своего момента и момента записи-начала — последнее обновление концов, не момент переноса', () => {
  assert.deepEqual(edgeVersion({ in_versions: ['2026-10-02T00:00:00Z', '2026-11-01T00:00:00Z'], in_updated: '2026-10-15' }, AT),
    { valid_from: '2026-11-01T00:00:00.000Z', valid_to: null, source: 'ends.last_update' });
  assert.equal(edgeVersion({ out_updated: '2026-11-05', in_created: '2026-09-01' }, AT).valid_from, '2026-11-05T00:00:00.000Z');
  assert.equal(edgeVersion({}, AT).source, 'transfer', 'ничего не известно — момент снимка, как раньше');
  const list = [{ content: { mig_src_rid: '#9:0' } }];
  assert.deepEqual(stampEdgeHistory('ROLE_HELD_BY', list, new Map([['#9:0', { in_versions: ['2026-10-20T00:00:00Z'] }]]), AT), { 'ends.last_update': 1 });
  assert.match(outMomentsQuery('IN_PHASE', '#-1:-1'), /in_versions/);
});
