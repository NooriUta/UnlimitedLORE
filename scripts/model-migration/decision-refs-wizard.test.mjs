// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08 (часть 3) · Шаг мастера «Ссылки решений».
// Владелица 20.11.2026 про ссылку решения 23 на «v1.0.0» (тег есть у трёх проектов): «визардом с возможностью
// выбрать в миграции». Общее правило: любая ссылка adr_refs / sprint_refs / pr_refs / release_refs, которая при
// переносе неоднозначна или не нашла цель, попадает в шаг мастера. Человек выбирает кандидата (ставится связь),
// «не ставить связь» (остаток «решено человеком») или «решу позже» (остаток «ждёт решения»). Ответ — в файл
// решений тем же механизмом, что статусы: код DR-NN, область decision_refs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planDecisionRefs, verifyDecisionRefs, withRefAnswer, nextRefId, REF_SCOPE } from './decision-refs.mjs';
import { checkDecisions, resolveRejects } from './decisions.mjs';
import { refsFixture } from './decision-refs-fixture.mjs';

const AT = '2026-11-20T12:00:00Z';
const releases = [
  { rid: '#4:1', release_uid: 'NooriUta/AIDA#v1.0.0', release_id: 'v1.0.0', git_tag: 'v1.0.0', git_project: 'NooriUta/AIDA', released_at: '2025-03-01T10:00:00Z' },
  { rid: '#4:2', release_uid: 'NooriUta/seidr-site#v1.0.0', release_id: 'v1.0.0', git_tag: 'v1.0.0', git_project: 'NooriUta/seidr-site', release_date: '2025-06-10' },
  { rid: '#4:3', release_uid: 'AIDA/miniLORE#v1.0.0', release_id: 'v1.0.0', git_tag: 'v1.0.0', git_project: 'AIDA/miniLORE', released_at: '2026-08-23T09:00:00Z' },
  { rid: '#4:4', release_uid: 'NooriUta/AIDA#v1.3.42', release_id: 'v1.3.42', git_tag: 'v1.3.42', git_project: 'NooriUta/AIDA' },
];
const adrs = [{ rid: '#1:1', adr_id: 'ADR-LORE-001', created_at: '2025-01-02T00:00:00Z', projects: ['NooriUta/UnlimitedLORE'] }];
const dec = o => ({ adr_refs: [], sprint_refs: [], pr_refs: [], release_refs: [], projects: [], adr_projects: [], decided_in: [], refs_out: [], ...o });
const d23 = dec({ rid: '#0:23', decision_id: '23', title: 'Первый релиз', projects: ['AIDA/forgejo-mcp'], release_refs: ['v1.0.0'] });
const d40 = dec({ rid: '#0:40', decision_id: '40', title: 'Ссылка мимо', projects: ['NooriUta/UnlimitedLORE'], adr_refs: ['adr-lore-001x'], release_refs: ['v9.9.9'] });
const world = (decisions, doc) => ({ decisions, adrs, sprints: [], prs: [], releases, dstRid: { get: r => 'D' + r }, doc });
const doc0 = () => ({ format: 'mig-decisions/1', decisions: [] });
const answer = (doc, f) => withRefAnswer(doc, { decision: '23', field: 'release_refs', value: 'v1.0.0', ...f }, 'omiloreadmin', AT, planDecisionRefs(world([d23, d40], doc)));

test('неоднозначная ссылка попадает в шаг: решение (ID, название, проект), исходный текст, причина, кандидаты с проектом и датой', () => {
  const p = planDecisionRefs(world([d23]));
  assert.equal(p.review.length, 1);
  const r = p.review[0];
  assert.equal(r.decision, '23');
  assert.equal(r.title, 'Первый релиз');
  assert.deepEqual(r.projects, ['AIDA/forgejo-mcp']);
  assert.equal(r.field, 'release_refs');
  assert.equal(r.value, 'v1.0.0');
  assert.equal(r.reason, 'ambiguous');
  assert.deepEqual(r.candidates, [
    { uid: 'AIDA/miniLORE#v1.0.0', key: 'v1.0.0', project: 'AIDA/miniLORE', date: '2026-08-23' },
    { uid: 'NooriUta/AIDA#v1.0.0', key: 'v1.0.0', project: 'NooriUta/AIDA', date: '2025-03-01' },
    { uid: 'NooriUta/seidr-site#v1.0.0', key: 'v1.0.0', project: 'NooriUta/seidr-site', date: '2025-06-10' },
  ]);
  assert.equal(r.answer, null);
  assert.equal(p.leftovers[0].status, 'waiting', 'без ответа — «ждёт решения»');
});

test('ссылка без цели — тоже в шаг, причина not_found; близкое написание предлагается кандидатом, но связь само не ставит', () => {
  const p = planDecisionRefs(world([d40]));
  const by = Object.fromEntries(p.review.map(r => [r.field, r]));
  assert.equal(by.adr_refs.reason, 'not_found');
  assert.deepEqual(by.adr_refs.candidates, [{ uid: 'ADR-LORE-001', key: 'ADR-LORE-001', project: 'NooriUta/UnlimitedLORE', date: '2025-01-02' }]);
  assert.equal(by.release_refs.reason, 'not_found');
  assert.deepEqual(by.release_refs.candidates, []);
  assert.equal(p.edges.length, 0);
});

test('выбор кандидата даёт связь REFERENCES к выбранной цели; сверка «было = связей + дублей + остаток» сходится', () => {
  const doc = answer(doc0(), { action: 'link', to: 'NooriUta/seidr-site#v1.0.0' });
  assert.equal(doc.decisions[0].id, 'DR-01');
  assert.deepEqual(doc.decisions[0].scope, { type: REF_SCOPE, field: 'release_refs', value: 'v1.0.0', decision: '23' });
  assert.deepEqual(checkDecisions(doc), []);
  const p = planDecisionRefs(world([d23, d40], doc));
  assert.deepEqual(p.edges.map(e => [e.decision, e.from, e.to, e.target_key, e.method, e.answer]), [['23', 'D#0:23', 'D#4:2', 'v1.0.0', 'human', 'DR-01']]);
  assert.equal(p.review.find(r => r.decision === '23').answer.id, 'DR-01', 'решённая строка остаётся в шаге — выбор можно переиграть');
  assert.equal(p.ok, true);
  for (const c of Object.values(p.counts)) assert.equal(c.values, c.edges + c.duplicates + c.leftover);
  const v = verifyDecisionRefs(p, [{ decision_id: '23', adr_refs: [], sprint_refs: [], pr_refs: [], release_refs: ['v1.0.0'] }, { decision_id: '40', adr_refs: [], sprint_refs: [], pr_refs: [], release_refs: [] }]);
  assert.equal(v.ok, true);
});

test('«не ставить связь» и «решу позже» — остаток с разным статусом и кодом решения', () => {
  const no = planDecisionRefs(world([d23], answer(doc0(), { action: 'drop' })));
  const later = planDecisionRefs(world([d23], answer(doc0(), { action: 'defer' })));
  assert.equal(no.edges.length + later.edges.length, 0);
  assert.equal(no.leftovers[0].status, 'decided');
  assert.equal(no.leftovers[0].answer, 'DR-01');
  assert.match(no.leftovers[0].why, /решено человеком/);
  assert.equal(later.leftovers[0].status, 'waiting');
  assert.equal(later.leftovers[0].answer, 'DR-01');
  assert.match(later.leftovers[0].why, /ждёт решения/);
  assert.notEqual(no.leftovers[0].status, later.leftovers[0].status);
  assert.equal(no.ok && later.ok, true);
});

test('повтор детерминирован: тот же ответ — тот же план при любом порядке строк; повторная запись ответа не плодит кодов', () => {
  let doc = answer(doc0(), { action: 'link', to: 'AIDA/miniLORE#v1.0.0' });
  doc = withRefAnswer(doc, { decision: '40', field: 'adr_refs', value: 'adr-lore-001x', action: 'link', to: 'ADR-LORE-001' }, 'x', AT, planDecisionRefs(world([d23, d40], doc)));
  const a = planDecisionRefs(world([d23, d40], doc)), b = planDecisionRefs(world([d40, d23], doc));
  assert.deepEqual(a, b);
  assert.deepEqual(a.edges.map(e => e.answer), ['DR-01', 'DR-02']);
  const again = answer(doc, { action: 'link', to: 'NooriUta/AIDA#v1.0.0' });
  assert.equal(again.decisions.length, 2, 'ответ по той же ссылке заменяет прежний');
  assert.equal(again.decisions.find(d => d.scope.decision === '23').id, 'DR-01');
  assert.equal(nextRefId(again), 'DR-03');
});

test('ответ проверяется по плану: кандидат не из списка, чужая строка, нет «кто принял» — отказ; файл с ответом не мешает статусам', () => {
  assert.throws(() => answer(doc0(), { action: 'link', to: 'NooriUta/AIDA#v1.3.42' }), /не из кандидатов/);
  assert.throws(() => answer(doc0(), { value: 'v7', action: 'drop' }), /нет в шаге/);
  assert.throws(() => withRefAnswer(doc0(), { decision: '23', field: 'release_refs', value: 'v1.0.0', action: 'drop' }, ' ', AT, planDecisionRefs(world([d23]))), /кто принял/);
  assert.throws(() => answer(doc0(), { action: 'map_to', to: 'X' }), /действие/);
  const doc = answer(doc0(), { action: 'drop' });
  assert.deepEqual(checkDecisions({ ...doc, decisions: [...doc.decisions, { ...doc.decisions[0], id: 'DR-02', scope: { ...doc.decisions[0].scope, decision: '24' } }] }), [], 'одно значение в двух решениях — разные области');
  assert.match(checkDecisions({ ...doc, decisions: [{ ...doc.decisions[0], action: 'link' }] }).join(), /не сказано, какую цель/);
  const r = resolveRejects('KnowDecision', { rejects: [{ field: 'release_refs', value: 'v1.0.0', why: 'x' }] }, doc);
  assert.equal(r.rejects.length, 1, 'ответ по ссылке не применяется к несоответствиям записей');
});

test('выбранная цель исчезла из свежего снимка — строка снова «ждёт решения», связь не ставится', () => {
  const doc = answer(doc0(), { action: 'link', to: 'NooriUta/seidr-site#v1.0.0' });
  const p = planDecisionRefs({ ...world([d23], doc), releases: releases.filter(x => x.rid !== '#4:2') });
  assert.equal(p.edges.length, 0);
  assert.equal(p.leftovers[0].status, 'waiting');
  assert.match(p.leftovers[0].why, /DR-01.*не найдена/);
});

test('мастер: шаг «Ссылки решений» читает план и пишет ответ в файл решений (код DR-NN, область decision_refs)', async () => {
  const { serve } = await import('./ui.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'));
  const file = path.join(dir, 'decisions.json');
  const server = await serve({ port: 0, db: refsFixture(), decisionsFile: file });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await (await fetch(base + '/')).text();
    assert.match(page, /data-step="r"[^>]*>.*Ссылки решений/);
    const g = await (await fetch(base + '/api/decision-refs')).json();
    const r23 = g.rows.find(r => r.decision === '23');
    assert.equal(r23.reason, 'ambiguous');
    assert.equal(r23.candidates.length, 3);
    assert.ok(g.projects.includes('AIDA/forgejo-mcp'));
    const post = await fetch(base + '/api/decision-refs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: '23', field: 'release_refs', value: 'v1.0.0', action: 'link', to: 'AIDA/miniLORE#v1.0.0', by: 'tester' }) });
    assert.equal(post.status, 200);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.decisions[0].id, 'DR-01');
    assert.equal(saved.decisions[0].scope.type, 'decision_refs');
    const g2 = await (await fetch(base + '/api/decision-refs')).json();
    assert.equal(g2.rows.find(r => r.decision === '23').answer.to, 'AIDA/miniLORE#v1.0.0');
    const bad = await fetch(base + '/api/decision-refs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: '23', field: 'release_refs', value: 'v1.0.0', action: 'drop', by: '' }) });
    assert.equal(bad.status, 400);
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('повторный перенос пишет ответ в приёмник: ребро с кодом ответа, остаток со статусом, сверка сходится; второй прогон — то же', async () => {
  const { applyDecisionRefs } = await import('./decision-refs.mjs');
  let doc = answer(doc0(), { action: 'link', to: 'NooriUta/seidr-site#v1.0.0' });
  doc = withRefAnswer(doc, { decision: '40', field: 'release_refs', value: 'v9.9.9', action: 'drop' }, 'x', AT, planDecisionRefs(world([d23, d40], doc)));
  const plan = planDecisionRefs(world([d23, d40], doc));
  // приёмник в памяти: рёбра шага и остаток; паспорт читает релизы по рёбрам
  const store = { edges: [], left: [] };
  const keyOf = new Map(releases.map(r => ['D' + r.rid, r.release_id]));
  const db = {
    async dstQuery(sql) {
      if (sql.startsWith('SELECT name FROM schema:types')) return [{ name: 'REFERENCES' }];
      if (sql.includes('FROM REFERENCES WHERE mig_rule')) return store.edges.map(e => ({ o: e.from, i: e.to, d: e.c.mig_decision, f: e.c.mig_field, v: e.c.mig_value }));
      if (sql.includes('count(*) AS n FROM MigLeftover')) return [{ n: store.left.length }];
      if (sql.startsWith('SELECT decision_id,')) return ['23', '40'].map(id => ({ decision_id: id, adr_refs: [], sprint_refs: [], pr_refs: [],
        release_refs: store.edges.filter(e => e.c.mig_decision === id).map(e => keyOf.get(e.to)) }));
      throw new Error('нет запроса ' + sql.slice(0, 60));
    },
    async dstCommand(sql, p = {}) {
      if (sql.startsWith('DELETE FROM REFERENCES')) store.edges = [];
      else if (sql.startsWith('DELETE FROM MigLeftover')) store.left = [];
      else if (sql.startsWith('CREATE EDGE REFERENCES')) { const m = /FROM (\S+) TO (\S+)/.exec(sql); store.edges.push({ from: m[1], to: m[2], c: p.c }); }
      else if (sql.startsWith('INSERT INTO MigLeftover')) store.left.push(p.c);
    },
  };
  for (let run = 0; run < 2; run++) {
    const r = await applyDecisionRefs(db, plan, { log: () => {} });
    assert.equal(r.ok, true);
    assert.deepEqual(store.edges.map(e => [e.from, e.to, e.c.mig_method, e.c.mig_answer]), [['D#0:23', 'D#4:2', 'human', 'DR-01']]);
    assert.deepEqual(store.left.map(x => [x.value, x.status, x.answer]).sort(), [['adr-lore-001x', 'waiting', undefined], ['v9.9.9', 'decided', 'DR-02']]);
    assert.deepEqual(r.review, { rows: 3, linked: 1, decided: 1, waiting: 1 });
  }
});
