// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08 (часть 2) — ссылки решения строкой → связи REFERENCES при переносе 1.18.
// Владелица 20.11.2026: «refs с релизов разобрать пересадить на связи но с проверкой дублей и с проверкой что
// оставшийся функционал перешёл на связи». Каждое значение — связь | дубль (второе ребро не заводится) | остаток
// с причиной; сумма сходится с числом значений. Сверка паспорта: множество «было в refs» = связи после переноса.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REFS, REFS_EDGE, refsRule, refValues, planDecisionRefs, verifyDecisionRefs } from './decision-refs.mjs';
import { ruleFor, proposeMap } from './propose-map-all.mjs';
import { applyMap } from './apply-map.mjs';

const J = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const MAP = J('./map/all-objects.json').types;
const SCHEMA = J('./schema/all-objects.json').types;

// Мир снимка в миниатюре: адреса источника → адреса приёмника (все перенесены, кроме #9:9)
const adrs = [{ rid: '#1:1', adr_id: 'ADR-A' }, { rid: '#1:2', adr_id: 'ADR-B' }, { rid: '#1:3', adr_id: 'ADR-C' }];
const sprints = [{ rid: '#2:1', sprint_id: 'SPRINT_X' }];
const prs = [
  { rid: '#3:1', pr_uid: 'NooriUta/AIDA#13', pr_number: 13, git_project: 'NooriUta/AIDA' },
  { rid: '#3:2', pr_uid: 'AIDA/miniLORE#13', pr_number: 13, git_project: 'AIDA/miniLORE' },
  { rid: '#3:3', pr_uid: 'NooriUta/AIDA#223', pr_number: 223, git_project: 'NooriUta/AIDA' },
];
const releases = [
  { rid: '#4:1', release_uid: 'NooriUta/AIDA#v1.0.0', release_id: 'v1.0.0', git_tag: 'v1.0.0', git_project: 'NooriUta/AIDA' },
  { rid: '#4:2', release_uid: 'NooriUta/seidr-site#v1.0.0', release_id: 'v1.0.0', git_tag: 'v1.0.0', git_project: 'NooriUta/seidr-site' },
  { rid: '#4:3', release_uid: 'NooriUta/AIDA#v1.3.42', release_id: 'v1.3.42', git_tag: 'v1.3.42', git_project: 'NooriUta/AIDA' },
];
const dec = (o) => ({ adr_refs: [], sprint_refs: [], pr_refs: [], release_refs: [], projects: [], adr_projects: [], decided_in: [], refs_out: [], ...o });
const moved = rid => (rid === '#9:9' ? null : 'D' + rid);
const world = decisions => ({ decisions, adrs, sprints, prs, releases, dstRid: { get: moved } });

test('перечень полей и связь — из правила владелицы; имена связей — из модели (REFERENCES, DECIDED_IN)', () => {
  assert.deepEqual(Object.keys(REFS), ['adr_refs', 'sprint_refs', 'pr_refs', 'release_refs']);
  assert.equal(REFS_EDGE, 'REFERENCES');
  const model = J('../../shared/model/lore-model.json');
  const decision = model.types.find(t => t.type === 'decision');
  const rels = decision.relations.map(r => r.rel);
  assert.ok(rels.includes('REFERENCES') && rels.includes('DECIDED_IN'), 'связи есть в модели решения');
  assert.equal(REFS.adr_refs.target, 'KnowADR');
  assert.deepEqual(REFS.adr_refs.dup_edges, ['DECIDED_IN']);
});

test('карта: поля ссылок решения — не «удержать», а «в связи» с основанием владелицы; генератор ставит правило', () => {
  for (const f of Object.keys(REFS)) {
    const r = refsRule('KnowDecision', f);
    assert.equal(r.rule, 'drop');
    assert.equal(r.edge, 'REFERENCES');
    assert.equal(r.basis, 'owner');
    assert.match(r.why, /пересадить на связи/);
    assert.deepEqual(ruleFor('KnowDecision', f), r, f);
    assert.deepEqual(MAP.KnowDecision[f], r, 'map/all-objects.json выведена генератором: ' + f);
  }
  assert.equal(refsRule('KnowSprint', 'pr_refs'), null, 'pr_refs спринта — своё решение владелицы, не это правило');
  assert.equal(ruleFor('KnowSprint', 'pr_refs').rule, 'open');
  assert.equal(proposeMap({ KnowDecision: { fields: [{ name: 'adr_refs' }] } }).types.KnowDecision.adr_refs.edge, 'REFERENCES');
});

test('исполнитель карты: значение ссылок не в новую запись и не в «удержано» — его учитывает шаг связей', () => {
  const r = applyMap('KnowDecision', { decision_id: { rule: 'keep', basis: 'owner' }, adr_refs: refsRule('KnowDecision', 'adr_refs') }, { decision_id: '1', adr_refs: ['ADR-A'] });
  assert.deepEqual(r.out, { decision_id: '1' });
  assert.deepEqual(r.held, {});
  assert.deepEqual(r.dropped, ['adr_refs']);
});

test('схема 1.18 не объявляет полей ссылок и не держит их «удержанными»', () => {
  for (const f of Object.keys(REFS)) {
    assert.equal(SCHEMA.KnowDecision.fields[f], undefined, f);
    assert.equal((SCHEMA.KnowDecision.held || {})[f], undefined, f);
  }
});

test('значения поля: список, строка через запятую; пустые не считаются', () => {
  assert.deepEqual(refValues(['ADR-A', ' ', null, 'ADR-B']), ['ADR-A', 'ADR-B']);
  assert.deepEqual(refValues('ADR-A, ADR-B'), ['ADR-A', 'ADR-B']);
  assert.deepEqual(refValues(null), []);
  assert.deepEqual(refValues([]), []);
});

test('ADR: уже связанный DECIDED_IN — дубль (второго ребра нет); прочий — REFERENCES; ненайденный — остаток', () => {
  const p = planDecisionRefs(world([dec({ rid: '#0:1', decision_id: '108', adr_refs: ['ADR-A', 'ADR-B', 'ADR-ZZ'], decided_in: ['#1:1'] })]));
  assert.deepEqual(p.edges.map(e => [e.from, e.to, e.field, e.value]), [['D#0:1', 'D#1:2', 'adr_refs', 'ADR-B']]);
  assert.deepEqual(p.duplicates.map(d => [d.decision, d.value, d.edge]), [['108', 'ADR-A', 'DECIDED_IN']]);
  assert.equal(p.leftovers.length, 1);
  assert.match(p.leftovers[0].why, /не найден/);
  assert.deepEqual(p.counts.adr_refs, { values: 3, edges: 1, duplicates: 1, leftover: 1 });
});

test('спринт: по ключу; второе упоминание той же цели — дубль, а не второе ребро', () => {
  const p = planDecisionRefs(world([dec({ rid: '#0:2', decision_id: '105', sprint_refs: ['SPRINT_X', 'SPRINT_X', 'SPRINT_PLAN'] })]));
  assert.equal(p.edges.length, 1);
  assert.equal(p.duplicates.length, 1);
  assert.equal(p.duplicates[0].edge, 'REFERENCES');
  assert.equal(p.leftovers.length, 1);
  assert.deepEqual(p.counts.sprint_refs, { values: 3, edges: 1, duplicates: 1, leftover: 1 });
});

test('уже существующая REFERENCES к той же цели — дубль', () => {
  const p = planDecisionRefs(world([dec({ rid: '#0:3', decision_id: '7', sprint_refs: ['SPRINT_X'], refs_out: ['#2:1'] })]));
  assert.equal(p.edges.length, 0);
  assert.deepEqual(p.duplicates.map(d => d.edge), ['REFERENCES']);
});

test('PR: номер без проекта — по проекту решения, иначе по проекту его ADR; неоднозначный — остаток', () => {
  const p = planDecisionRefs(world([
    dec({ rid: '#0:4', decision_id: '101', pr_refs: ['PR#223'], projects: ['NooriUta/AIDA'] }),
    dec({ rid: '#0:5', decision_id: '16', pr_refs: ['PR13'], adr_projects: ['NooriUta/AIDA'] }),
    dec({ rid: '#0:6', decision_id: '17', pr_refs: ['PR13'] }),
  ]));
  assert.deepEqual(p.edges.map(e => [e.decision, e.target_key, e.method]), [['101', 'NooriUta/AIDA#223', 'key'], ['16', 'NooriUta/AIDA#13', 'adr_project']]);
  assert.equal(p.leftovers.length, 1);
  assert.match(p.leftovers[0].why, /неоднозначн.*2/);
});

test('PR с адресом репозитория — точно по pr_uid', () => {
  const p = planDecisionRefs(world([dec({ rid: '#0:7', decision_id: '8', pr_refs: ['AIDA/miniLORE#13'] })]));
  assert.deepEqual(p.edges.map(e => e.target_key), ['AIDA/miniLORE#13']);
});

test('релиз: тег у нескольких проектов — по проекту решения/ADR; без проекта — остаток с числом кандидатов', () => {
  const p = planDecisionRefs(world([
    dec({ rid: '#0:8', decision_id: '79', release_refs: ['v1.3.42'], adr_projects: ['NooriUta/AIDA'] }),
    dec({ rid: '#0:9', decision_id: '23', release_refs: ['v1.0.0'], adr_projects: ['AIDA/forgejo-mcp'] }),
  ]));
  assert.deepEqual(p.edges.map(e => [e.decision, e.target_key]), [['79', 'v1.3.42']]);
  assert.equal(p.leftovers.length, 1);
  assert.match(p.leftovers[0].why, /неоднозначн.*2/);
});

test('цель или решение не перенесены — остаток с причиной, ребра нет', () => {
  const p = planDecisionRefs({ ...world([dec({ rid: '#9:9', decision_id: '99', adr_refs: ['ADR-A'] })]) });
  assert.equal(p.edges.length, 0);
  assert.match(p.leftovers[0].why, /решение не перенесено/);
  const q = planDecisionRefs({ ...world([dec({ rid: '#0:1', decision_id: '1', adr_refs: ['ADR-C'] })]), adrs: [{ rid: '#9:9', adr_id: 'ADR-C' }] });
  assert.match(q.leftovers[0].why, /цель не перенесена/);
});

test('сумма сходится: значений = связей + дублей + остатка, по каждому полю и в итоге; порядок детерминирован', () => {
  const ds = [
    dec({ rid: '#0:2', decision_id: '2', adr_refs: ['ADR-B', 'ADR-A'], sprint_refs: ['SPRINT_X'], decided_in: ['#1:1'] }),
    dec({ rid: '#0:1', decision_id: '1', pr_refs: ['PR#223'], release_refs: ['v1.0.0'], projects: ['NooriUta/AIDA'] }),
  ];
  const a = planDecisionRefs(world(ds)), b = planDecisionRefs(world([...ds].reverse()));
  assert.deepEqual(a, b);
  for (const c of Object.values(a.counts)) assert.equal(c.values, c.edges + c.duplicates + c.leftover);
  assert.equal(a.total.values, 5);
  assert.equal(a.total.values, a.total.edges + a.total.duplicates + a.total.leftover);
  assert.equal(a.ok, true);
});

test('конвейер связей вызывает шаг пересадки и роняет сверку, если он не сошёлся', () => {
  const src = fs.readFileSync(new URL('./transfer-edges.mjs', import.meta.url), 'utf8');
  assert.match(src, /report\.decision_refs = await applyDecisionRefs\(db, planDecisionRefs\(\{ \.\.\.\(await readDecisionRefsInput\(db\)\), dstRid \}\)/);
  assert.match(src, /if \(!report\.decision_refs\.ok\) ok = false;/);
});

test('повторный перенос (--reset) считает связи шагов связей своими: REFERENCES и ANSWERABLE_BY не «чужие типы»', async () => {
  const { ownTypes } = await import('./transfer.mjs');
  const own = ownTypes();
  assert.ok(own.includes('REFERENCES'), 'REFERENCES — заводит шаг пересадки ссылок решения');
  assert.ok(own.includes('ANSWERABLE_BY'), 'ANSWERABLE_BY — заводит шаг «ответственный вопроса»');
});

test('сверка паспорта: «было в refs» (найденные цели; у ADR — и родитель DECIDED_IN) = прочитанное по связям', () => {
  const p = planDecisionRefs(world([dec({ rid: '#0:1', decision_id: '108', adr_refs: ['ADR-A', 'ADR-B'], sprint_refs: ['SPRINT_X'], decided_in: ['#1:1'] })]));
  const passport = [{ decision_id: '108', adr_refs: ['ADR-A', 'ADR-B'], sprint_refs: ['SPRINT_X'], pr_refs: [], release_refs: [] }];
  const v = verifyDecisionRefs(p, passport);
  assert.equal(v.ok, true);
  assert.equal(v.decisions, 1);
  assert.equal(v.same, 1);
  // Паспорт потерял ссылку — сверка ловит
  const bad = verifyDecisionRefs(p, [{ ...passport[0], sprint_refs: [] }]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.mismatched.map(m => [m.decision, m.field]), [['108', 'sprint_refs']]);
  // Родительский ADR без строки в refs — показан по связи: это не расхождение, а «родитель», и он считается отдельно
  const p2 = planDecisionRefs(world([dec({ rid: '#0:1', decision_id: '1', decided_in: ['#1:3'] })]));
  const v2 = verifyDecisionRefs(p2, [{ decision_id: '1', adr_refs: ['ADR-C'], sprint_refs: [], pr_refs: [], release_refs: [] }]);
  assert.equal(v2.ok, true);
  assert.equal(v2.parent_only, 1);
});
