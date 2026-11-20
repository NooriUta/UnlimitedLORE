// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Записи за значением статуса в диалоге унификации мастера переноса.
// Владелица 20.11.2026: по статусам вне словаря — «указание создания спринта или задачи и проект»;
// «не просто md, он должен быть виден в визарде». Источник только читается.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSrc } from './fake-src.mjs';
import { recordsOf, attachRecords, needsRecords, hasCircle, attachProposals, RECORDS_LIMIT } from './status-records.mjs';
import { forPage } from './ui.mjs';
import { RULES } from './resources.mjs';

const V = '⬜ Stub — Post-HighLoad';
function store() {
  const records = [
    { '@rid': '#1:0', '@type': 'KnowGitProject', slug: 'lore' },
    { '@rid': '#1:1', '@type': 'KnowGitProject', slug: 'volva' },
    { '@rid': '#2:0', '@type': 'KnowSprint', sprint_id: 'SPRINT_A', created_at: '2026-10-01T10:00:00Z' },
    { '@rid': '#2:1', '@type': 'KnowSprint', sprint_id: 'SPRINT_B', created_date: '2026-09-15' },
    { '@rid': '#3:0', '@type': 'KnowSprintHist', status_raw: V, valid_from: '2026-10-01T10:00:00Z', valid_to: '2026-10-05T10:00:00Z' },
    { '@rid': '#3:1', '@type': 'KnowSprintHist', status_raw: V, valid_from: '2026-10-05T10:00:00Z', valid_to: null },
    { '@rid': '#4:0', '@type': 'KnowTask', task_uid: 'SPRINT_B/T-1', task_id: 'T-1' },
    { '@rid': '#5:0', '@type': 'KnowTaskHist', status_raw: '🟢 DONE', valid_from: '2026-09-20T00:00:00Z', valid_to: null },
    { '@rid': '#6:0', '@type': 'KnowDecision', decision_id: 'D-2026-X', status_raw: 'rejected', created_at: '2026-08-01T00:00:00Z' },
  ];
  const edges = [
    { type: 'BELONGS_TO_PROJECT', out: '#2:0', in: '#1:0' },
    { type: 'BELONGS_TO_PROJECT', out: '#2:1', in: '#1:1' },
    { type: 'HAS_STATE', out: '#2:0', in: '#3:0' }, { type: 'HAS_STATE', out: '#2:0', in: '#3:1' },
    { type: 'HAS_STATE', out: '#4:0', in: '#5:0' },
    { type: 'PART_OF', out: '#4:0', in: '#2:1' },
  ];
  // 53 версии задачи с одним статусом — обрезка 50 + «ещё 3»
  for (let i = 0; i < 53; i++) {
    records.push({ '@rid': `#7:${i}`, '@type': 'KnowTaskHist', status_raw: 'MANY', valid_from: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`, valid_to: null });
    edges.push({ type: 'HAS_STATE', out: '#4:0', in: `#7:${i}` });
  }
  return { records, edges };
}

test('записи значения спринта: код, проект связью, дата создания, valid_from/valid_to, открыта ли версия', async () => {
  const r = await recordsOf(fakeSrc(store()), { type: 'KnowSprintHist', field: 'status_raw', value: V });
  assert.equal(r.total, 2);
  assert.equal(r.more, 0);
  assert.deepEqual(r.items.map(x => [x.kind, x.code, x.project, x.created, x.valid_from, x.valid_to, x.open]), [
    ['Спринт', 'SPRINT_A', 'lore', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z', '2026-10-05T10:00:00Z', false],
    ['Спринт', 'SPRINT_A', 'lore', '2026-10-01T10:00:00Z', '2026-10-05T10:00:00Z', null, true],
  ]);
});

test('задача: код СПРИНТ/ЗАДАЧА и проект через спринт задачи; без своей даты — дата первой версии', async () => {
  const r = await recordsOf(fakeSrc(store()), { type: 'KnowTaskHist', field: 'status_raw', value: '🟢 DONE' });
  assert.equal(r.items[0].code, 'SPRINT_B/T-1');
  assert.equal(r.items[0].project, 'volva');
  assert.equal(r.items[0].projectVia, 'спринт');
  assert.equal(r.items[0].created, '2026-01-01T00:00:00Z');
  assert.equal(r.items[0].createdVia, 'первая версия');
});

test('запись без версий (решение): ID решения, версии нет', async () => {
  const r = await recordsOf(fakeSrc(store()), { type: 'KnowDecision', field: 'status_raw', value: 'rejected' });
  assert.deepEqual([r.items[0].kind, r.items[0].code, r.items[0].created, r.items[0].open], ['Решение', 'D-2026-X', '2026-08-01T00:00:00Z', null]);
  assert.equal(r.items[0].project, null);
});

test(`больше ${RECORDS_LIMIT} записей — первые ${RECORDS_LIMIT} и число остальных`, async () => {
  const r = await recordsOf(fakeSrc(store()), { type: 'KnowTaskHist', field: 'status_raw', value: 'MANY' });
  assert.equal(r.total, 53);
  assert.equal(r.items.length, 50);
  assert.equal(r.more, 3);
});

test('не смогли прочитать — ошибка названа, а не «записей нет»', async () => {
  const db = { env: {}, src: async () => { throw new Error('база ответила 500'); } };
  const r = await recordsOf(db, { type: 'KnowTaskHist', field: 'status_raw', value: 'X' });
  assert.match(r.error, /500/);
  assert.equal(r.items, undefined);
});

test('кому собирать записи: вне словаря, решённые, подсказанные и любые кружки; распознанное без кружка — нет', () => {
  assert.equal(needsRecords({ state: 'needs_decision', value: 'x' }), true);
  assert.equal(needsRecords({ state: 'decided', value: 'x' }), true);
  assert.equal(needsRecords({ state: 'unified', value: 'DONE' }), false);
  assert.equal(needsRecords({ state: 'unified', value: '🟢 DONE' }), true);
  assert.equal(hasCircle('🟡 в работе'), true);
  assert.equal(hasCircle('⬜ Stub'), false);
});

test('сбор диалога с записями и раздел «Статусы-кружки»: распознанное показано с кодом', async () => {
  const db = fakeSrc(store());
  const dialog = { rows: [
    { type: 'KnowTaskHist', field: 'status_raw', value: '🟢 DONE', n: 1, state: 'unified', code: 'DONE', dict: 'plan_status' },
    { type: 'KnowSprintHist', field: 'status_raw', value: V, n: 2, state: 'needs_decision', dict: 'plan_status', suggest: 'BACKLOG', codes: ['BACKLOG'] },
    { type: 'KnowTaskHist', field: 'status_raw', value: 'ACTIVE', n: 5, state: 'unified', code: 'ACTIVE', dict: 'plan_status' },
  ], summary: {} };
  await attachRecords(db, dialog);
  assert.equal(dialog.rows[0].records.total, 1);
  assert.equal(dialog.rows[2].records, undefined);
  const page = forPage(dialog, RULES);
  assert.deepEqual(page.circles.map(c => [c.value, c.recognized]), [['🟢 DONE', 'DONE']]);
  assert.deepEqual(page.projects, ['lore', 'volva']);
});

test('предложенные коды — подсказка «предложено»; файл решений не меняется', () => {
  const rows = [{ type: 'KnowSprintHist', field: 'status_raw', value: V, state: 'needs_decision' }, { type: 'KnowTaskHist', field: 'status_raw', value: 'x', state: 'needs_decision' }];
  const proposals = { format: 'mig-decisions/1', decisions: [{ id: 'ST-12', scope: { type: 'KnowSprintHist', field: 'status_raw', value: V }, action: 'map_to', to: 'BACKLOG', note: 'версий 2' }] };
  const before = JSON.stringify(proposals);
  attachProposals(rows, proposals);
  assert.deepEqual(rows[0].proposed, { id: 'ST-12', to: 'BACKLOG', note: 'версий 2' });
  assert.equal(rows[1].proposed, undefined);
  assert.equal(JSON.stringify(proposals), before);
});
