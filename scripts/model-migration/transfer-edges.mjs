#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Перенос связей ВСЕХ объектов по общей карте map/all.edges.json (18.11.2026;
// прежде — только спринт, фаза, задача). Запускается после transfer.mjs. Правило на каждый вид — edgePlan
// (keep / drop / convert; связь вне карты — ошибка), что записать — edgeWrites (свойства как есть + mig_src_rid;
// конец не перенесён — в отчёт; дубль отсекается только при переводе). HAS_STATE пишет этап записи версий — здесь сверка.
// Источник только читается; в приёмнике пересоздаются только виды связей этого шага.
// Сверка: число связей каждого вида и концы каждой связи (по адресам приёмника) совпали с расчётом.
import fs from 'node:fs';
import { connect } from './db.mjs';
import { EDGES, SCHEMA, DECISION_MILESTONES } from './resources.mjs';
import { edgePlan, edgeWrites, schemaOnlyEdgeDdl } from './edge-plan.mjs';
import { planSessionModel } from './session-model.mjs';
import { loadDecisions } from './decisions.mjs';
import { proposeRegroup, readRegroupInput, regroupOverrides, regroupPlan, applyRegroup, repoOverrides } from './regroup.mjs';
import { applyRepos } from './repos.mjs';
import { readProductKindInput, applyProductKinds } from './product-kind.mjs';
import { applyOrphanSprints } from './orphan-sprints.mjs';
import { isHistoric, edgeHistoryDdl, outMomentsQuery, stampEdgeHistory, sourceMoment } from './edge-history.mjs';
import { decisionMilestoneRules, readDecisionMilestoneInput, planDecisionMilestones, applyDecisionMilestones } from './decision-milestones.mjs';
import { readQuestionOwnerInput, planQuestionOwners, applyQuestionOwners } from './question-owner.mjs';
import { readDecisionRefsInput, planDecisionRefs, applyDecisionRefs } from './decision-refs.mjs';

// Значения machine_id, которые не машина (D-2026-LORE-SESSION-MACHINE-PLACE-MODEL: «LEGION — имя пользователя Windows»).
const NOT_MACHINES = ['legion'];

const VERSION_EDGE = 'HAS_STATE';

/** Перенос связей и их сверка. log — куда писать ход. */
export async function transferEdges(db, { log = console.log, at: atGiven } = {}) {
  if (!/^migration_dst/.test(db.env.MIG_DST_DB)) throw new Error('приёмник должен называться migration_dst*');
  const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); };
  const pages = async (query, sql, fn, key = 'r') => {
    let last = '#-1:-1';
    for (;;) {
      const rows = await query(sql(last));
      if (!rows.length) break;
      for (const x of rows) fn(x);
      last = rows[rows.length - 1][key]; if (rows.length < 5000) break;
    }
  };
  const OWN = Object.keys(SCHEMA);

  // адрес записи источника → адрес в приёмнике (все перенесённые типы)
  const dstRid = new Map();
  for (const T of OWN) await pages(q => db.dstQuery(q), last => `SELECT @rid AS r, mig_src_rid AS s FROM ${T} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`, x => dstRid.set(x.s, x.r));
  if (!dstRid.size) throw new Error('в приёмнике нет перенесённых записей — сначала transfer.mjs');
  // момент переноса для связей без своего момента — снимок источника (детерминизм), не часы машины
  const at = atGiven || await sourceMoment(db, OWN.filter(T => T.endsWith('Hist')));

  // перепись связей источника: вид, тип начала, тип конца, число
  const srcTypes = await db.src('SELECT name, type, records FROM schema:types');
  const triples = [];
  for (const e of srcTypes.filter(t => t.type === 'edge' && t.records > 0)) {
    const ends = await db.src(`SELECT o, i, count(*) AS n FROM (SELECT @out.@type AS o, @in.@type AS i FROM ${e.name}) GROUP BY o, i`);
    for (const x of ends) triples.push({ edge: e.name, from: x.o, to: x.i, n: x.n });
  }
  const plan = edgePlan(triples, EDGES, new Set(OWN)); // связь вне карты — исключение с её именем

  // связи источника (кроме версий — их пишет этап записи)
  const src = {};
  for (const [e, p] of Object.entries(plan)) {
    if (p.rule === 'drop' || e === VERSION_EDGE) continue;
    const list = (src[e] = []);
    await pages(q => db.src(q), last => `SELECT FROM ${e} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`, row => {
      const props = {};
      for (const [k, v] of Object.entries(row)) if (!k.startsWith('@') && k !== 'out' && k !== 'in' && v !== null && v !== undefined && v !== '') props[k] = v;
      list.push({ r: row['@rid'], o: row['@out'], i: row['@in'], props });
    }, '@rid');
  }
  // MDL-02: у историчной связи (edge_history модели) читаются ещё моменты записи-начала, из которых выводится valid_from
  const outMoments = new Map();
  for (const [e, p] of Object.entries(plan)) {
    if (p.rule === 'drop' || e === VERSION_EDGE || !isHistoric(p.rule === 'convert' ? p.to : e)) continue;
    await pages(q => db.src(q), last => outMomentsQuery(e, last), x => outMoments.set(x.r, x));
  }
  const planNoVersions = Object.fromEntries(Object.entries(plan).filter(([e]) => e !== VERSION_EDGE));
  const { writes, missingEnds, duplicates } = edgeWrites(src, dstRid, planNoVersions);

  const report = { source: db.env.MIG_SRC_DB, target: db.env.MIG_DST_DB, plan: Object.fromEntries(Object.entries(plan).map(([e, p]) => [e, { rule: p.rule, to: p.to, reverse: p.reverse || undefined, dropped_ends: p.dropped_ends.length ? p.dropped_ends : undefined }])), transfer_at: at, moved: {}, missing_ends: missingEnds, duplicates };
  let ok = true;
  const dstTypes = new Set((await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name));
  for (const [T, list] of Object.entries(writes)) {
    if (dstTypes.has(T)) await db.dstCommand(`DROP TYPE ${T} UNSAFE`);
    await db.dstCommand(`CREATE EDGE TYPE ${T}`);
    await db.dstCommand(`CREATE PROPERTY ${T}.mig_src_rid STRING`);
    for (const ddl of edgeHistoryDdl(T)) await db.dstCommand(ddl);
    const sources = stampEdgeHistory(T, list, outMoments, at);
    await pool(list, 8, w => db.dstCommand(`CREATE EDGE ${T} FROM ${w.from} TO ${w.to} CONTENT :c`, { c: w.content }));
    // сверка: каждая связь приёмника соединяет те записи, что дал расчёт
    const want = new Map(list.map(w => [w.content.mig_src_rid, `${w.from}>${w.to}`]));
    let got = 0, bad = 0;
    await pages(q => db.dstQuery(q), last => `SELECT @rid AS r, mig_src_rid AS s, @out AS o, @in AS i FROM ${T} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`, x => { got++; if (want.get(x.s) !== `${x.o}>${x.i}`) bad++; });
    report.moved[T] = { expected: list.length, target: got, wrong_ends: bad, ...(sources ? { valid_from_source: sources } : {}) };
    if (got !== list.length || bad) ok = false;
  }
  // MD-02 8а: пустые связи, которые пишет или читает код сервера, — вид связи без данных, свойства старой схемы
  report.schema_only_edges = [];
  for (const ddl of schemaOnlyEdgeDdl(EDGES, new Set(Object.keys(writes)))) {
    await db.dstCommand(ddl);
    const m = /^CREATE EDGE TYPE (\w+)/.exec(ddl); if (m) report.schema_only_edges.push(m[1]);
  }
  // версии: пишет этап записи; здесь — что число связей версий в приёмнике не меньше расчётного по своим типам
  const hs = triples.filter(t => t.edge === VERSION_EDGE && OWN.includes(t.from) && t.to === t.from + 'Hist').reduce((a, t) => a + t.n, 0);
  const hsGot = dstTypes.has(VERSION_EDGE) ? (await db.dstQuery(`SELECT count(*) AS n FROM ${VERSION_EDGE}`))[0].n : 0;
  // ожидаемое — связи версий источника, у которых оба конца перенесены: запись, не перенесённая этапом записи
  // (дубль — остаток с причиной), не переносит и свои версии (задачи без спринта, 19.11.2026)
  let hsKept = 0;
  // (та же выборка, что hs: запись своего типа → её тип версий; прочие направления — аномалии, не переносятся)
  await pages(q => db.src(q), last => `SELECT @rid AS r, @out AS o, @in AS i, @out.@type AS ot, @in.@type AS it FROM ${VERSION_EDGE} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`,
    x => { if (OWN.includes(x.ot) && x.it === x.ot + 'Hist' && dstRid.has(x.o) && dstRid.has(x.i)) hsKept++; });
  report.moved[VERSION_EDGE] = { source: hs, expected: hsKept, target: hsGot };
  if (hsKept !== hsGot) ok = false;
  // задачи без спринта (шаг «З» мастера): ребро PART_OF задача → спринт только по ответу человека (orphan_sprints)
  const decisionsOs = loadDecisions();
  report.orphan_sprints = await applyOrphanSprints(db, decisionsOs, { log });
  if (!report.orphan_sprints.ok) ok = false;
  // новые связи модели сессий (D-2026-LORE-SESSION-MACHINE-PLACE-MODEL) — по перенесённым записям приёмника
  const sm = await sessionModel(db, { pages });
  report.session_model = sm;
  if (!sm.ok) ok = false;
  // перегруппировка проектов (шаг П установщика): только если таблица принята человеком — в файле решений
  // есть раздел projects; иначе проекты переносятся как есть (группа не выдумывается)
  const decisions = loadDecisions();
  const regroupInput = await readRegroupInput(db); // проекты источника — и для перегруппировки, и для репозиториев
  const anchorOf = {};
  if (decisions && decisions.projects && Object.keys(regroupOverrides(decisions)).length) {
    const proposal = proposeRegroup({ ...regroupInput, overrides: regroupOverrides(decisions) });
    const rp = regroupPlan(proposal.rows);
    for (const g of Object.values(rp)) for (const m of g.merge) anchorOf[m] = g.anchor;
    report.regroup = await applyRegroup(db, rp, { log });
    if (!report.regroup.ok) ok = false;
  } else log('перегруппировка проектов: таблица не принята (нет раздела projects в файле решений) — проекты как есть');
  // репозитории (D-2026-MIG-REPOSITORY-ORGANIZATION, владелица 19.11): по адресам проектов ИСТОЧНИКА — проект →
  // основной, влитый проект → репозиторий его компонента, зеркала — связью репозиторий → репозиторий
  report.repositories = await applyRepos(db, regroupInput.projects, anchorOf, { log, overrides: repoOverrides(decisions) });
  if (!report.repositories.ok) ok = false;
  // вид продукта (шаг В установщика, владелица 19.11.2026): решение человека из файла решений — в запись продукта
  // приёмника; сверка — у всех продуктов вид задан
  report.product_kind = await applyProductKinds(db, (await readProductKindInput(db)).products, decisions, { log });
  if (!report.product_kind.ok) ok = false;
  // решение → веха (владелица 19.11.2026): с ADR — не связываем; без ADR — веха вычисляется при переносе
  // (спринт → окно по времени → «куда?» в мастере) и хранится ребром TARGETS_MILESTONE; довод computed-at-transfer
  const dmPlan = planDecisionMilestones({ rules: decisionMilestoneRules(DECISION_MILESTONES), doc: decisions, ...(await readDecisionMilestoneInput(db)) });
  report.decision_milestones = await applyDecisionMilestones(db, dmPlan, { log, at });
  if (!report.decision_milestones.ok) ok = false;
  // ответственный вопроса (MT-MCP-TRUTH A6, владелица 19.11.2026 «1а»): текст owner → ребро ANSWERABLE_BY к человеку
  // или агенту реестра; пять написаний владелицы → omiloreadmin; несовпавшее — в остаток с причиной, счёт по случаям
  const qoIn = await readQuestionOwnerInput(db);
  report.question_owner = await applyQuestionOwners(db, planQuestionOwners(qoIn), { log, at,
    moments: new Map(qoIn.questions.map(x => [x.rid, [x.updated_at, x.opened_date]])) });
  if (!report.question_owner.ok) ok = false;
  // ссылки решения строкой → связи REFERENCES (MDL-08 ч.2, владелица 20.11.2026: «refs … пересадить на связи но с проверкой
  // дублей и с проверкой что оставшийся функционал перешёл на связи»): связь | дубль | остаток; сверка паспорта по связям
  report.decision_refs = await applyDecisionRefs(db, planDecisionRefs({ ...(await readDecisionRefsInput(db)), dstRid }), { log });
  if (!report.decision_refs.ok) ok = false;
  report.ok = ok;
  for (const [k, v] of Object.entries(report.moved)) log(`связь ${k}: ${JSON.stringify(v)}`);
  log('модель сессий: машин зарегистрировано', sm.new_machines.length, '· сессий восстановлено из версий', sm.restored_sessions, '· связи', JSON.stringify(sm.counts), '· не стали связью', JSON.stringify(sm.unresolved_counts));
  log('не перенесены (конец не в приёмнике):', JSON.stringify(missingEnds), '· дубли при переводе:', JSON.stringify(duplicates));
  log('не переносится по карте:', Object.entries(plan).filter(([, p]) => p.rule === 'drop').map(([e]) => e).join(', '));
  log('сверка связей:', ok ? 'сошлась' : 'НЕ сошлась');
  return report;
}

/** Модель сессий: регистрация машин из сессий и связи NEW_ON_MACHINE, NEW_IN_PROJECT, NEW_RUNS_IN, NEW_CHANGED_IN. */
async function sessionModel(db, { pages }) {
  const dq = q => db.dstQuery(q);
  const read = async (T, cols, where = '') => { const out = []; await pages(dq, last => `SELECT @rid AS r, ${cols} FROM ${T} WHERE @rid > ${last}${where} ORDER BY @rid LIMIT 5000`, x => out.push(x)); return out; };
  const has = new Set((await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name));
  const sessions = has.has('KnowAgentSession') ? await read('KnowAgentSession', 'mig_src_rid, session_id, machine_id, started_at, last_activity_at') : [];
  // строка project у сессии в новую схему не входит (становится связью) — берётся из источника
  const projOf = new Map();
  await pages(q => db.src(q), last => `SELECT @rid AS r, project FROM KnowAgentSession WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`, x => projOf.set(x.r, x.project));
  for (const s of sessions) { s.rid = s.r; s.project = projOf.get(s.mig_src_rid); }
  const machines = (has.has('KnowMachine') ? await read('KnowMachine', 'machine_id') : []).map(x => ({ rid: x.r, machine_id: x.machine_id }));
  const projects = (has.has('KnowGitProject') ? await read('KnowGitProject', 'slug, full_name, name') : []).map(x => ({ rid: x.r, slug: x.slug, full_name: x.full_name, name: x.name }));
  const harness = (has.has('KnowDictEntry') ? await read('KnowDictEntry', 'code', " AND dict_type = 'harness'") : []).map(x => ({ rid: x.r, code: x.code }));
  const actors = (has.has('KnowActor') ? await read('KnowActor', 'harness') : []).map(x => ({ rid: x.r, harness: x.harness }));
  const versions = [];
  for (const T of Object.keys(SCHEMA).filter(t => t.endsWith('Hist') && SCHEMA[t].fields.changed_by_session))
    for (const x of await read(T, 'changed_by_session, changed_by_machine, changed_by_harness, valid_from', ' AND changed_by_session IS NOT NULL')) versions.push({ rid: x.r, changed_by_session: x.changed_by_session, changed_by_machine: x.changed_by_machine, changed_by_harness: x.changed_by_harness, valid_from: x.valid_from });
  const plan = planSessionModel({ sessions, machines, projects, harness, actors, versions, notMachines: NOT_MACHINES });

  for (const m of plan.newMachines) await db.dstCommand('INSERT INTO KnowMachine CONTENT :c', { c: { ...m, mig_src_rid: 'registered-from-sessions:' + m.machine_id } });
  const machineRid = new Map((await read('KnowMachine', 'machine_id')).map(x => [String(x.machine_id).toLowerCase(), x.r]));
  // сессии, восстановленные из версий (D-2026-MIG-UNREGISTERED-SESSIONS): заводятся до связей, заглушка session:<машина|код> → адрес
  const sessionRid = new Map();
  for (const r of plan.restoredSessions) {
    const key = r.machine_id + '|' + r.session_id;
    const res = await db.dstCommand('INSERT INTO KnowAgentSession CONTENT :c', { c: { ...r, mig_src_rid: 'restored-from-versions:' + key } });
    sessionRid.set(key, res[0]['@rid']);
  }
  const resolve = b => b.startsWith('machine:') ? machineRid.get(b.slice(8)) : b.startsWith('session:') ? sessionRid.get(b.slice(8)) : b;
  const counts = {}; let ok = true;
  for (const [E, list] of Object.entries(plan.edges)) {
    if (has.has(E)) await db.dstCommand(`DROP TYPE ${E} UNSAFE`);
    await db.dstCommand(`CREATE EDGE TYPE ${E}`);
    const rows = list.map(([a, b]) => [resolve(a), resolve(b)]);
    for (const [a, b] of rows) await db.dstCommand(`CREATE EDGE ${E} FROM ${a} TO ${b} CONTENT :c`, { c: { mig_rule: 'session-model' } });
    const got = (await db.dstQuery(`SELECT count(*) AS n FROM ${E}`))[0].n;
    counts[E] = { expected: rows.length, target: got };
    if (got !== rows.length || rows.some(([a, b]) => !a || !b)) ok = false;
  }
  return { ok, new_machines: plan.newMachines, restored_sessions: plan.restoredSessions.length, counts, unresolved_counts: Object.fromEntries(Object.entries(plan.unresolved).map(([k, v]) => [k, v.length])), unresolved: plan.unresolved };
}

if (process.argv[1] === 'edges') {
  const db = connect();
  const report = await transferEdges(db);
  const o = process.argv.indexOf('--out');
  if (o > 0) fs.writeFileSync(process.argv[o + 1], JSON.stringify(report, null, 1));
  process.exit(report.ok ? 0 : 1);
}
