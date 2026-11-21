// Владелица 19.11.2026: «веха · решение — ребро между decision и вехой» (TARGETS_MILESTONE, D-2026-MDL04-FIELDS-FROM-DATA);
// «веху храним, просто при переносе вычисляем»; «решения со связью ADR уже сильные — не надо дальше связывать».
// Итог: решение с ADR — без ребра; решение без ADR — веха вычисляется при переносе (спринт → окно по времени → «куда?»)
// и хранится ребром.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECISION_MILESTONES } from './resources.mjs';
import { decisionMilestoneRules, milestoneWindows, pickByTime, sprintsOf, planDecisionMilestones, withDecisionMilestones, applyDecisionMilestones } from './decision-milestones.mjs';

test('правила переноса читаются: с ADR — не связываем, без ADR — вычисляется при переносе', () => {
  const r = decisionMilestoneRules(DECISION_MILESTONES);
  assert.equal(r.with_adr, 'skip');
  assert.equal(r.without_adr, 'computed-at-transfer');
  assert.deepEqual(r.order, ['sprint', 'time-window', 'waiting']);
  assert.deepEqual(r.map, {}, 'решений человека в правилах пока нет');
  assert.match(DECISION_MILESTONES.by, /по вехам ок/);
  assert.throws(() => decisionMilestoneRules({ ...DECISION_MILESTONES, map: { 'D-1': 5 } }), /веха/);
});

const milestones = [
  { milestone_id: 'M-A1', products: ['AIDA'], projects: [] },
  { milestone_id: 'M-A2', products: ['AIDA'], projects: [] },
  { milestone_id: 'M-B1', products: ['BRAGI'], projects: [] },
  { milestone_id: 'M-L1', products: [], projects: [], date_display: '2026-12-01' },
  { milestone_id: 'M0', products: [], projects: [] },
];
const sprints = [
  { sprint_id: 'SPRINT_X', created_at: '2026-06-01 10:00:00', milestones: ['M-A1'] },
  { sprint_id: 'SPRINT_OLD', milestones: ['M0'] },
  { sprint_id: 'SPRINT_X2', created_at: '2026-09-30', milestones: ['M-A1'] },
  { sprint_id: 'SPRINT_Y', created_at: '2026-07-01', milestones: ['M-A2', 'M0'] },
  { sprint_id: 'SPRINT_Y2', created_at: '2026-08-15', milestones: ['M-A2'] },
  { sprint_id: 'SPRINT_B', created_at: '2026-01-01', milestones: ['M-B1'] },
  { sprint_id: 'SPRINT_B2', created_at: '2026-03-01', milestones: ['M-B1'] },
];

test('окно вехи — даты её спринтов, решений, связанных через спринт, и срок; старые вехи забега без окна', () => {
  const w = milestoneWindows({ milestones, sprints, dated: [['M-A1', '2026-10-10']] });
  assert.deepEqual(w['M-A1'], ['2026-06-01', '2026-10-10']);
  assert.deepEqual(w['M-A2'], ['2026-07-01', '2026-08-15']);
  assert.deepEqual(w['M-L1'], ['2026-12-01', '2026-12-01']);
  assert.equal(w.M0, undefined);
});

test('пересечение окон — ближайший конец окна после даты; равенство — по коду', () => {
  const w = { 'M-A1': ['2026-06-01', '2026-09-30'], 'M-A2': ['2026-07-01', '2026-08-15'], 'M-Z': ['2026-07-01', '2026-08-15'] };
  const p = pickByTime('2026-07-20', ['M-A1', 'M-Z', 'M-A2'], w);
  assert.equal(p.milestone, 'M-A2', 'M-A2 и M-Z кончаются 15.08 — раньше M-A1; из равных — по коду');
  assert.deepEqual(p.alternatives, ['M-Z', 'M-A1']);
  assert.equal(pickByTime('2026-09-01', ['M-A1', 'M-A2'], w).milestone, 'M-A1');
  assert.equal(pickByTime('2026-12-31', ['M-A1'], w), null, 'вне окон — нет вехи');
  assert.equal(pickByTime(null, ['M-A1'], w), null, 'даты нет — нет вехи');
});

test('спринты решения: коды в тексте (длиннейший известный префикс) и спринты вопросов, на которые оно отвечает', () => {
  const known = new Set(sprints.map(s => s.sprint_id));
  assert.deepEqual(sprintsOf({ title: 'итог SPRINT_X_REVIEW', refs_raw: 'SPRINT_B2', question_sprints: ['SPRINT_OLD'] }, known), ['SPRINT_B2', 'SPRINT_OLD', 'SPRINT_X']);
  assert.deepEqual(sprintsOf({ body_md: 'SPRINT_NOPE' }, known), []);
});

const decisions = [
  { decision_id: 'A-1', created_at: '2026-07-20', has_adr: true, products: ['AIDA'], projects: [], body_md: 'SPRINT_X' },
  { decision_id: 'N-1', created_at: '2026-07-20', has_adr: false, products: ['AIDA'], projects: [] },
  { decision_id: 'N-2', created_at: '2026-06-15', has_adr: false, products: [], projects: [], body_md: 'по итогам SPRINT_X_REVIEW и SPRINT_OLD' },
  { decision_id: 'N-3', created_at: null, has_adr: false, products: [], projects: [], title: 'без даты и спринта' },
  { decision_id: 'N-4', created_at: '2026-07-20', has_adr: false, products: [], projects: [], question_sprints: ['SPRINT_OLD'] },
  { decision_id: 'N-5', created_at: '2026-02-01', has_adr: false, products: ['AIDA'], projects: [] },
  { decision_id: 'N-6', created_at: '2025-01-01', has_adr: false, products: [], projects: [] },
];
const rules = decisionMilestoneRules(DECISION_MILESTONES);
const plan = (doc = {}, d = decisions, s = sprints) => planDecisionMilestones({ rules, doc, decisions: d, milestones, sprints: s });

test('решение с ADR — ребра нет: оно уже связано через ADR', () => {
  const p = plan();
  assert.ok(!p.edges.find(x => x.decision === 'A-1'));
  assert.ok(!p.waiting.find(x => x.decision === 'A-1'));
  assert.deepEqual(p.with_adr_skipped, ['A-1']);
});

test('решение без ADR: со спринтом — веха спринта; без спринта — по окну; без даты или окна — «куда?»; повтор даёт те же рёбра', () => {
  const p = plan();
  const e = id => p.edges.find(x => x.decision === id);
  assert.equal(e('N-2').milestone, 'M-A1', 'SPRINT_X_REVIEW → SPRINT_X; старая веха M0 — только если другой нет');
  assert.equal(e('N-2').method, 'sprint');
  assert.equal(e('N-2').basis, 'computed-at-transfer');
  assert.equal(e('N-4').milestone, 'M0', 'спринт смотрит только на старую веху забега — берётся она');
  assert.equal(e('N-1').milestone, 'M-A2', 'без спринта — вехи продукта AIDA, ближайший конец окна после 20.07');
  assert.equal(e('N-1').method, 'time-window');
  assert.deepEqual(e('N-1').alternatives, ['M-A1']);
  assert.equal(e('N-5').milestone, 'M-B1', 'у вех продукта окна на эту дату нет — любая веха, в окно которой попала дата');
  assert.deepEqual(p.waiting.map(w => w.decision), ['N-3', 'N-6']);
  assert.match(p.waiting[0].why, /даты нет/);
  assert.deepEqual(p.counts, { sprint: 2, time: 2, waiting: 2, with_adr_skipped: 1, human: 0 });
  const again = plan({}, [...decisions].reverse(), [...sprints].reverse());
  assert.deepEqual(again.edges, p.edges, 'детерминированно: порядок входа не влияет');
});

test('«куда?» не переносится, пока не решил человек; решение человека — в файле решений; с ADR человек не связывает', () => {
  const doc = withDecisionMilestones({ format: 'mig-decisions/1', decisions: [] }, { 'N-3': 'M-B1', 'N-6': null }, 'omiloreadmin', '2026-11-19T21:00:00Z');
  assert.deepEqual(doc.decision_milestones, { map: { 'N-3': 'M-B1', 'N-6': null }, by: 'omiloreadmin', at: '2026-11-19T21:00:00Z' });
  const p = plan(doc);
  assert.equal(p.edges.find(x => x.decision === 'N-3').method, 'human');
  assert.ok(!p.edges.find(x => x.decision === 'N-6'), '«без вехи» — решение, связи нет');
  assert.deepEqual(p.waiting, []);
  assert.equal(p.counts.human, 2, 'оба решены человеком: одно вехой, одно «без вехи»');
  assert.throws(() => withDecisionMilestones({}, { 'N-3': 'M-A1' }, ''), /кто принял/);
  const p2 = plan(withDecisionMilestones({}, { 'A-1': 'M-A1' }, 'x', 'y'));
  assert.ok(!p2.edges.find(x => x.decision === 'A-1'), 'решение с ADR вехой не связывается и по слову человека');
});

// Приёмник в памяти: KnowDecision, KnowMilestone и рёбра TARGETS_MILESTONE.
function fakeDb({ dec, ms }) {
  const edges = [];
  return {
    edges,
    env: { MIG_DST_DB: 'migration_dst_test' },
    async dstQuery(q) {
      if (/FROM KnowDecision/.test(q)) return dec.map(([id, r, m]) => ({ r, id, ...(m || {}) }));
      if (/FROM KnowMilestone/.test(q)) return ms.map(([id, r, m]) => ({ r, id, ...(m || {}) }));
      if (/FROM TARGETS_MILESTONE/.test(q)) return edges.filter(e => e.c.mig_rule === 'decision-milestone').map(e => ({ o: e.from, i: e.to, s: e.c.mig_decision }));
      if (/schema:types/.test(q)) return [{ name: 'TARGETS_MILESTONE' }];
      throw new Error('запрос не ожидался: ' + q);
    },
    async dstCommand(q, p) {
      const m = /CREATE EDGE TARGETS_MILESTONE FROM (\S+) TO (\S+)/.exec(q);
      if (m) { edges.push({ from: m[1], to: m[2], c: p.c }); return [{}]; }
      if (/DELETE FROM TARGETS_MILESTONE/.test(q)) { for (let i = edges.length - 1; i >= 0; i--) if (edges[i].c.mig_rule === 'decision-milestone') edges.splice(i, 1); return []; }
      if (/CREATE (PROPERTY|EDGE TYPE)/.test(q)) return [];
      throw new Error('команда не ожидалась: ' + q);
    },
  };
}

test('перенос: рёбра создаются, сверка сходится, valid_from — момент переноса, повтор не плодит дублей', async () => {
  const db = fakeDb({ dec: [['N-2', '#10:1'], ['N-1', '#10:2']], ms: [['M-A1', '#20:1'], ['M-A2', '#20:2']] });
  const p = { edges: [{ decision: 'N-2', milestone: 'M-A1', method: 'sprint', basis: 'computed-at-transfer', reason: 'спринт SPRINT_X', alternatives: [] }, { decision: 'N-1', milestone: 'M-A2', method: 'time-window', basis: 'computed-at-transfer', reason: 'r', alternatives: ['M-A1'] }], waiting: [] };
  let r = await applyDecisionMilestones(db, p, { at: '2026-11-19T22:00:00Z', log: () => {} });
  assert.equal(r.ok, true);
  assert.deepEqual({ rules: r.rules, edges: r.edges, missing: r.missing.length, duplicates: r.duplicates.length }, { rules: 2, edges: 2, missing: 0, duplicates: 0 });
  assert.equal(db.edges[0].from, '#10:1');
  assert.equal(db.edges[0].to, '#20:1');
  assert.equal(db.edges[0].c.valid_from, '2026-11-19T22:00:00Z');
  assert.equal(db.edges[0].c.mig_basis, 'computed-at-transfer');
  assert.deepEqual(r.by_method, { sprint: 1, 'time-window': 1 });
  r = await applyDecisionMilestones(db, p, { at: '2026-11-19T22:05:00Z', log: () => {} });
  assert.equal(db.edges.length, 2, 'повторный перенос не плодит рёбра');
  assert.equal(r.ok, true);
});

test('отсутствующая веха или решение — в отчёте и журнале, сверка не сходится, ребро не выдумывается', async () => {
  const db = fakeDb({ dec: [['N-2', '#10:1']], ms: [['M-A1', '#20:1']] });
  const p = { edges: [{ decision: 'N-2', milestone: 'M-A1', method: 'sprint' }, { decision: 'N-7', milestone: 'M-NOPE', method: 'sprint' }, { decision: 'N-8', milestone: 'M-A1', method: 'time-window' }], waiting: [{ decision: 'N-3' }] };
  const logs = [];
  const r = await applyDecisionMilestones(db, p, { at: 'x', log: (...s) => logs.push(s.join(' ')) });
  assert.equal(r.ok, false);
  assert.equal(r.edges, 1);
  assert.deepEqual(r.missing, [{ decision: 'N-7', milestone: 'M-NOPE', why: 'нет решения N-7 в приёмнике; нет вехи M-NOPE в приёмнике' }, { decision: 'N-8', milestone: 'M-A1', why: 'нет решения N-8 в приёмнике' }]);
  assert.equal(r.waiting, 1);
  assert.ok(logs.some(s => /M-NOPE/.test(s)), 'отсутствующая веха — в журнале, не молча');
});

// Владелица 19.11.2026 (ответ «2 дата новых связей последняя дата обновления объектов», подтверждено «да»):
// новое ребро «решение → веха» действует с самой поздней даты обновления двух его концов; ничего не известно —
// момент снимка источника (at), и это видно в mig_valid_from_source.
test('valid_from нового ребра — последнее обновление концов (решение, веха), иначе момент снимка', async () => {
  const db = fakeDb({
    dec: [['N-2', '#10:1', { c: '2026-08-01T00:00:00Z', u: '2026-10-01T00:00:00Z' }], ['N-1', '#10:2']],
    ms: [['M-A1', '#20:1', { v: ['2026-09-01T00:00:00Z', '2026-11-10T00:00:00Z'] }], ['M-A2', '#20:2']],
  });
  const p = { edges: [{ decision: 'N-2', milestone: 'M-A1', method: 'sprint' }, { decision: 'N-1', milestone: 'M-A2', method: 'sprint' }], waiting: [] };
  const r = await applyDecisionMilestones(db, p, { at: '2026-11-18T10:22:09.589Z', log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(db.edges[0].c.valid_from, '2026-11-10T00:00:00.000Z');
  assert.equal(db.edges[0].c.mig_valid_from_source, 'ends.last_update');
  assert.equal(db.edges[1].c.valid_from, '2026-11-18T10:22:09.589Z');
  assert.equal(db.edges[1].c.mig_valid_from_source, 'transfer');
  assert.deepEqual(r.valid_from_source, { 'ends.last_update': 1, transfer: 1 });
});
