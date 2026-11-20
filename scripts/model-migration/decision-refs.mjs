// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08 (часть 2) · Ссылки решения строкой → связи REFERENCES при переносе 1.18.
// Владелица 20.11.2026: «refs с релизов разобрать пересадить на связи но с проверкой дублей и с проверкой что
// оставшийся функционал перешёл на связи».
//
// Каждое значение полей KnowDecision.adr_refs / sprint_refs / pr_refs / release_refs:
//   связь     — REFERENCES решение → цель, если такой связи ещё нет;
//   дубль     — связь уже есть (DECIDED_IN к тому же ADR, REFERENCES к той же цели, второе написание той же цели):
//               второе ребро не заводится, дубль считается в отчёте;
//   остаток   — цель не нашлась, неоднозначна или не перенесена: MigLeftover (kind decision_ref) с причиной.
// Сумма по каждому полю сходится с числом значений, иначе шаг не сошёлся. Сверка паспорта: выражения паспорта
// (rules/decision-refs.json, те же, что в срезе decision сервера) исполняются на приёмнике, и у каждого решения
// множество «было в refs» совпадает с прочитанным по связям. План детерминирован: не зависит от порядка строк.
import RULES from './rules/decision-refs.json' with { type: 'json' };
import { toPrRefs } from './apply-map.mjs';

export const REFS = RULES.fields;
export const REFS_EDGE = RULES.edge;
export const REF_KIND = 'decision_ref';
const RULE = 'decision-refs';
const DATE_RU = d => d.split('-').reverse().join('.');
const WHY = `MDL-08, владелица ${DATE_RU(RULES.approved)}: ${RULES.words}`;

/** Правило карты для поля ссылок решения; null — поле не из перечня. */
export function refsRule(T, f) {
  if (T !== 'KnowDecision' || !REFS[f]) return null;
  return { rule: 'drop', edge: REFS_EDGE, why: `ссылки строкой → связи ${REFS_EDGE} на шаге связей (decision-refs.mjs); дубль не плодит ребро, ненайденное — в остаток; ${WHY}`, basis: RULES.basis };
}

/** Значения поля: список или строка через запятую/точку с запятой; пустые не считаются. */
export function refValues(v) {
  const raw = Array.isArray(v) ? v : v === null || v === undefined ? [] : String(v).split(/[,;]/);
  return raw.map(x => (x === null || x === undefined ? '' : String(x).trim())).filter(Boolean);
}

/** Значения поля для пересадки: у pr_refs — приведённые MDL-06 (toPrRefs: ссылки markdown, номера); приписка — отдельным значением. */
export function fieldValues(f, v) {
  const vals = refValues(v);
  if (f !== 'pr_refs' || !vals.length) return vals;
  const r = toPrRefs(vals);
  return r.note ? [...r.prs, r.note] : r.prs;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const uniq = a => [...new Set(a)];

/** Кандидаты цели по значению: [{rid, key}], без учёта проекта. */
function candidates(field, value, t) {
  if (field === 'adr_refs') return t.adrs.filter(x => x.adr_id === value).map(x => ({ rid: x.rid, key: x.adr_id }));
  if (field === 'sprint_refs') return t.sprints.filter(x => x.sprint_id === value).map(x => ({ rid: x.rid, key: x.sprint_id }));
  if (field === 'pr_refs') {
    const full = value.match(/^(?:https?:\/\/[^/]+\/|[^/\s]+\.[^/\s]+\/)?([^/\s#]+\/[^/\s#]+)(?:#|\/pulls?\/)(\d+)$/);
    if (full) return t.prs.filter(x => x.pr_uid === `${full[1]}#${full[2]}`).map(x => ({ rid: x.rid, key: x.pr_uid, project: x.git_project }));
    const n = value.match(/^(?:PR)?\s*#?\s*(\d+)$/i);
    if (!n) return null; // не номер PR
    return t.prs.filter(x => Number(x.pr_number) === Number(n[1])).map(x => ({ rid: x.rid, key: x.pr_uid, project: x.git_project }));
  }
  if (field === 'release_refs') {
    const byUid = t.releases.filter(x => x.release_uid === value);
    const hit = byUid.length ? byUid : t.releases.filter(x => x.release_id === value || x.git_tag === value);
    const seen = new Set();
    return hit.filter(x => !seen.has(x.rid) && seen.add(x.rid)).map(x => ({ rid: x.rid, key: x.release_id, project: x.git_project }));
  }
  return [];
}

/** Одна цель из кандидатов: прямо, по проекту решения, по проекту его ADR. */
function pick(cands, d) {
  if (cands.length === 1) return { hit: cands[0], method: 'key' };
  for (const [method, projects] of [['project', d.projects || []], ['adr_project', d.adr_projects || []]]) {
    if (!projects.length) continue;
    const c = cands.filter(x => projects.includes(x.project));
    if (c.length === 1) return { hit: c[0], method };
  }
  return null;
}

/**
 * План связей, дублей и остатка.
 * decisions: [{rid, decision_id, adr_refs, sprint_refs, pr_refs, release_refs, projects[], adr_projects[], decided_in[rid], refs_out[rid]}]
 * adrs [{rid, adr_id}], sprints [{rid, sprint_id}], prs [{rid, pr_uid, pr_number, git_project}],
 * releases [{rid, release_uid, release_id, git_tag, git_project}] — адреса источника; dstRid.get(rid) → адрес приёмника или пусто.
 */
export function planDecisionRefs({ decisions, adrs, sprints, prs, releases, dstRid }) {
  const t = { adrs, sprints, prs, releases };
  const keyOf = new Map();
  for (const x of adrs) keyOf.set(x.rid, x.adr_id);
  const edges = [], duplicates = [], leftovers = [], expected = [];
  const counts = Object.fromEntries(Object.keys(REFS).map(f => [f, { values: 0, edges: 0, duplicates: 0, leftover: 0 }]));
  const list = [...decisions].sort((a, b) => cmp(String(a.decision_id), String(b.decision_id)) || cmp(String(a.rid), String(b.rid)));
  for (const d of list) {
    const from = dstRid.get(d.rid);
    const linked = new Set([...(d.refs_out || [])]); // цели, к которым REFERENCES уже есть или заведена этим шагом
    const decided = new Set(d.decided_in || []);
    const exp = { decision: d.decision_id, fields: {}, parents: uniq((d.decided_in || []).filter(r => dstRid.get(r)).map(r => keyOf.get(r)).filter(Boolean)).sort() };
    for (const f of Object.keys(REFS)) {
      exp.fields[f] = [];
      for (const value of fieldValues(f, d[f])) {
        counts[f].values++;
        const left = why => { leftovers.push({ decision: d.decision_id, src_rid: d.rid, field: f, value, why }); counts[f].leftover++; };
        if (!from) { left('решение не перенесено — связи не от чего строить'); continue; }
        const cands = candidates(f, value, t);
        if (cands === null) { left('значение не похоже на номер или адрес PR'); continue; }
        if (!cands.length) { left(`${REFS[f].target} «${value}» не найден по ${REFS[f].key}`); continue; }
        const p = pick(cands, d);
        if (!p) { left(`неоднозначно: «${value}» — кандидатов ${cands.length} (${cands.map(c => c.key + (c.project ? ' · ' + c.project : '')).sort().join(', ')}), проект решения и его ADR не выбирают одного`); continue; }
        const to = dstRid.get(p.hit.rid);
        if (!to) { left(`цель не перенесена: ${p.hit.key}`); continue; }
        exp.fields[f].push(p.hit.key);
        if ((REFS[f].dup_edges || []).includes('DECIDED_IN') && decided.has(p.hit.rid)) {
          duplicates.push({ decision: d.decision_id, field: f, value, target_key: p.hit.key, edge: 'DECIDED_IN' }); counts[f].duplicates++; continue;
        }
        if (linked.has(p.hit.rid)) {
          duplicates.push({ decision: d.decision_id, field: f, value, target_key: p.hit.key, edge: REFS_EDGE }); counts[f].duplicates++; continue;
        }
        linked.add(p.hit.rid);
        edges.push({ decision: d.decision_id, from, to, field: f, value, target_key: p.hit.key, method: p.method });
        counts[f].edges++;
      }
      exp.fields[f] = uniq(exp.fields[f]).sort();
    }
    expected.push(exp);
  }
  const total = Object.values(counts).reduce((a, c) => ({ values: a.values + c.values, edges: a.edges + c.edges, duplicates: a.duplicates + c.duplicates, leftover: a.leftover + c.leftover }), { values: 0, edges: 0, duplicates: 0, leftover: 0 });
  const ok = Object.values(counts).every(c => c.values === c.edges + c.duplicates + c.leftover);
  return { edges, duplicates, leftovers, counts, total, ok, expected };
}

/**
 * Сверка паспорта: passport — строки {decision_id, adr_refs, sprint_refs, pr_refs, release_refs}, прочитанные
 * выражениями паспорта на приёмнике. Ожидаемое — найденные цели значений; у ADR — ещё родитель (DECIDED_IN):
 * паспорт читает ссылки на ADR как родителя и ссылки вместе. Решение без строк в refs, у которого паспорт
 * показывает только родителя, — «parent_only», не расхождение.
 */
export function verifyDecisionRefs(plan, passport) {
  const got = new Map(passport.map(r => [String(r.decision_id), r]));
  const mismatched = [];
  let decisions = 0, same = 0, parent_only = 0;
  for (const e of plan.expected) {
    const r = got.get(String(e.decision)) || {};
    const hasRefs = Object.values(e.fields).some(v => v.length);
    let eq = true;
    for (const f of Object.keys(REFS)) {
      const want = f === 'adr_refs' ? uniq([...e.fields[f], ...e.parents]).sort() : e.fields[f];
      const have = uniq(refValues(r[f])).sort();
      if (JSON.stringify(want) !== JSON.stringify(have)) { eq = false; mismatched.push({ decision: e.decision, field: f, want, have }); }
    }
    if (hasRefs) { decisions++; if (eq) same++; }
    else if (eq && e.parents.length) parent_only++;
  }
  return { ok: mismatched.length === 0, decisions, same, parent_only, mismatched };
}

/** Данные источника: решения с полями ссылок и проектами, цели. */
export async function readDecisionRefsInput(db) {
  const cols = Object.keys(REFS).join(', ');
  const all = async sql => { const out = []; let last = '#-1:-1'; for (;;) { const rows = await db.src(sql(last)); out.push(...rows); if (rows.length < 5000) return out; last = rows[rows.length - 1].rid; } };
  const decisions = (await all(last => `SELECT @rid AS rid, decision_id, ${cols}, out('BELONGS_TO_PROJECT').slug AS projects, out('DECIDED_IN').out('BELONGS_TO_PROJECT').slug AS adr_projects, out('DECIDED_IN').@rid AS decided_in, out('${REFS_EDGE}').@rid AS refs_out FROM KnowDecision WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`))
    .map(d => ({ ...d, projects: uniq(d.projects || []), adr_projects: uniq((d.adr_projects || []).flat()), decided_in: (d.decided_in || []).map(String), refs_out: (d.refs_out || []).map(String) }));
  return {
    decisions,
    adrs: await all(last => `SELECT @rid AS rid, adr_id FROM KnowADR WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`),
    sprints: await all(last => `SELECT @rid AS rid, sprint_id FROM KnowSprint WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`),
    prs: await all(last => `SELECT @rid AS rid, pr_uid, pr_number, git_project FROM KnowPR WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`),
    releases: await all(last => `SELECT @rid AS rid, release_uid, release_id, git_tag, git_project FROM KnowRelease WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`),
  };
}

/** Паспорт по связям на приёмнике — те же выражения, что в срезе decision сервера. */
export const passportSql = () => `SELECT decision_id, ${Object.entries(REFS).map(([f, r]) => `${r.passport} AS ${f}`).join(', ')} FROM KnowDecision`;

/**
 * Записать связи и остаток в приёмник, сверить паспорт. Прежние рёбра шага (mig_rule = decision-refs) и его остаток
 * снимаются — повтор не плодит дублей.
 */
export async function applyDecisionRefs(db, plan, { log = console.log } = {}) {
  const types = new Set((await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name));
  if (!types.has(REFS_EDGE)) await db.dstCommand(`CREATE EDGE TYPE ${REFS_EDGE}`);
  await db.dstCommand(`CREATE PROPERTY ${REFS_EDGE}.mig_src_rid IF NOT EXISTS STRING`);
  await db.dstCommand(`DELETE FROM ${REFS_EDGE} WHERE mig_rule = '${RULE}'`);
  await db.dstCommand(`DELETE FROM MigLeftover WHERE kind = '${REF_KIND}'`);
  const want = new Map();
  for (const e of plan.edges) {
    const key = `${e.decision}|${e.field}|${e.value}`;
    await db.dstCommand(`CREATE EDGE ${REFS_EDGE} FROM ${e.from} TO ${e.to} CONTENT :c`, { c: {
      mig_rule: RULE, mig_src_rid: 'decision-refs:' + key, mig_decision: e.decision, mig_field: e.field, mig_value: e.value, mig_method: e.method, origin: 'migration:' + RULE } });
    want.set(key, `${e.from}>${e.to}`);
  }
  for (const x of plan.leftovers)
    await db.dstCommand('INSERT INTO MigLeftover CONTENT :c', { c: { src_type: 'KnowDecision', src_rid: x.src_rid, field: x.field, value: x.value, kind: REF_KIND, why: x.why } });
  const got = await db.dstQuery(`SELECT @out AS o, @in AS i, mig_decision AS d, mig_field AS f, mig_value AS v FROM ${REFS_EDGE} WHERE mig_rule = '${RULE}'`);
  let wrong = 0;
  for (const x of got) if (want.get(`${x.d}|${x.f}|${x.v}`) !== `${x.o}>${x.i}`) wrong++;
  const leftGot = (await db.dstQuery(`SELECT count(*) AS n FROM MigLeftover WHERE kind = '${REF_KIND}'`))[0].n;
  const passport = await db.dstQuery(passportSql());
  const verify = verifyDecisionRefs(plan, passport);
  const ok = plan.ok && got.length === plan.edges.length && !wrong && leftGot === plan.leftovers.length && verify.ok;
  const t = plan.total;
  log(`ссылки решений → ${REFS_EDGE}: значений ${t.values} · связей ${t.edges} · дублей ${t.duplicates} · остаток ${t.leftover} · по полям ${JSON.stringify(plan.counts)}`);
  log(`сверка паспорта решений: решений со ссылками ${verify.decisions}, совпало ${verify.same}, расхождений ${verify.mismatched.length}; только родитель ADR ${verify.parent_only}`);
  log('сверка «ссылки решений → связи»:', ok ? 'сошлась' : 'НЕ сошлась');
  return { ok, counts: plan.counts, total: t, edges: got.length, wrong_ends: wrong, leftovers: leftGot,
    duplicates: plan.duplicates, leftover_list: plan.leftovers.map(x => ({ decision: x.decision, field: x.field, value: x.value, why: x.why })),
    edge_list: plan.edges.map(e => ({ decision: e.decision, field: e.field, value: e.value, target: e.target_key, method: e.method })),
    passport: verify };
}
