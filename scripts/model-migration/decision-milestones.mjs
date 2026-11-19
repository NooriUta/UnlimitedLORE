// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Решение → веха: ребро TARGETS_MILESTONE от KnowDecision к KnowMilestone.
// Владелица 19.11.2026: «веха · решение — ребро между decision и вехой» (та же связь, что у спринта и фичи,
// D-2026-MDL04-FIELDS-FROM-DATA); «веху храним, просто при переносе вычисляем»; «решения со связью ADR уже сильные —
// не надо дальше связывать».
//
// Правило (rules/decision-milestones.json):
//   - решение с ADR — ребра нет (связано через ADR); и по слову человека не связывается;
//   - решение без ADR — веха вычисляется при переносе по данным источника и хранится ребром:
//       1) спринт решения → его веха (голосование, равенство — по коду; старые вехи забега M0–M7 — если других нет);
//       2) иначе окно по времени: сначала вехи продукта/проекта решения, потом любые; при пересечении — ближайший
//          конец окна после даты, равенство — по коду;
//       3) иначе — «куда?» в мастере; выбор человека — раздел decision_milestones файла решений
//          ({ map: { РЕШЕНИЕ: ВЕХА | null }, by, at }; null — «без вехи», связи нет).
// Вычисление детерминированное: результат не зависит от порядка строк источника.

import { edgeHistoryDdl } from './edge-history.mjs';

const LEGACY = /^M[0-7]$/;
const day = x => (x ? String(x).slice(0, 10) : null);
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Правила из файла: порядок вычисления и решения человека, вшитые в правила (map). Негодная веха — отказ. */
export function decisionMilestoneRules(doc) {
  if (!doc || doc.format !== 'mig-decision-milestones/1') throw new Error('правила «решение → веха»: неизвестный формат');
  const map = doc.map || {};
  for (const [k, v] of Object.entries(map)) if (v !== null && typeof v !== 'string') throw new Error(`правила «решение → веха»: веха решения ${k} — не код`);
  const r = doc.rule || {};
  return { with_adr: r.with_adr || 'skip', without_adr: r.without_adr || 'computed-at-transfer', order: r.order || ['sprint', 'time-window', 'waiting'], map: { ...map } };
}

/** Решения человека из файла решений: { РЕШЕНИЕ: ВЕХА | null }. */
export function decisionMilestoneMap(doc) {
  const m = doc && doc.decision_milestones && typeof doc.decision_milestones === 'object' ? doc.decision_milestones.map || {} : {};
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v === null || (typeof v === 'string' && v)));
}

/** Записать выбор человека: прежние сохраняются; null — «без вехи». Без «кто принял» — отказ. */
export function withDecisionMilestones(doc, map, by, at = new Date().toISOString()) {
  if (!by) throw new Error('не записано: не сказано, кто принял');
  const next = { ...decisionMilestoneMap(doc) };
  for (const [k, v] of Object.entries(map || {})) {
    if (v !== null && (typeof v !== 'string' || !v.trim())) throw new Error(`веха решения ${k} — не код`);
    next[k] = v === null ? null : v.trim();
  }
  return { ...doc, decision_milestones: { map: next, by, at } };
}

/** Спринты решения: коды SPRINT_… в тексте (длиннейший известный префикс) и спринты вопросов. Отсортированы. */
export function sprintsOf(d, known) {
  const out = new Set();
  const text = [d.title, d.body_md, d.refs_raw, ...(Array.isArray(d.sprint_refs) ? d.sprint_refs : [d.sprint_refs])].filter(Boolean).join(' ');
  for (const tok of text.match(/SPRINT_[A-Z0-9_]+/g) || []) {
    const parts = tok.replace(/_+$/, '').split('_');
    for (let i = parts.length; i >= 2; i--) { const c = parts.slice(0, i).join('_'); if (known.has(c)) { out.add(c); break; } }
  }
  for (const s of d.question_sprints || []) if (known.has(s)) out.add(s);
  return [...out].sort(byCode);
}

/** Окна вех: [начало, конец] по датам спринтов, датированным привязкам (dated: [[веха, дата]]) и сроку. */
export function milestoneWindows({ milestones, sprints, dated = [] }) {
  const dates = {};
  const add = (m, d) => { if (!m || LEGACY.test(m) || !isDay(d)) return; (dates[m] ||= []).push(d); };
  for (const s of sprints) for (const m of s.milestones || []) add(m, day(s.created_at));
  for (const [m, d] of dated) add(m, day(d));
  for (const m of milestones) { const x = /\d{4}-\d{2}-\d{2}/.exec(String(m.date_display || '')); if (x) add(m.milestone_id, x[0]); }
  return Object.fromEntries(Object.entries(dates).sort(([a], [b]) => byCode(a, b)).map(([m, v]) => { v.sort(); return [m, [v[0], v[v.length - 1]]]; }));
}

/** Веха по времени: среди кандидатов, в чьё окно попала дата, — ближайший конец после даты, равенство — по коду. */
export function pickByTime(date, candidates, windows) {
  const d = day(date);
  if (!isDay(d)) return null;
  const hit = [...new Set(candidates)].filter(m => windows[m] && windows[m][0] <= d && d <= windows[m][1])
    .sort((a, b) => byCode(windows[a][1], windows[b][1]) || byCode(a, b));
  return hit.length ? { milestone: hit[0], window: windows[hit[0]], alternatives: hit.slice(1) } : null;
}

function vote(list) {
  const c = new Map();
  for (const m of list) c.set(m, (c.get(m) || 0) + 1);
  const ranked = [...c.entries()].sort((a, b) => b[1] - a[1] || byCode(a[0], b[0]));
  return ranked.length ? { best: ranked[0][0], alternatives: ranked.slice(1).map(x => x[0]) } : null;
}

/**
 * План рёбер.
 * decisions: [{decision_id, created_at, has_adr, products[], projects[], title?, body_md?, refs_raw?, sprint_refs?, question_sprints?}]
 * milestones: [{milestone_id, products[], projects[], date_display?}]; sprints: [{sprint_id, created_at, milestones[]}]
 */
export function planDecisionMilestones({ rules, doc, decisions, milestones, sprints }) {
  const human = { ...(rules.map || {}), ...decisionMilestoneMap(doc) };
  const known = new Set(sprints.map(s => s.sprint_id).filter(Boolean));
  const msOfSprint = new Map(sprints.map(s => [s.sprint_id, s.milestones || []]));
  const list = [...decisions].sort((a, b) => byCode(a.decision_id, b.decision_id));
  const edges = [], waiting = [], with_adr_skipped = [];
  const counts = { sprint: 0, time: 0, waiting: 0, with_adr_skipped: 0, human: 0 };
  const bySprint = new Map();
  // проход 1: спринт решения → его веха
  for (const d of list) {
    if (d.has_adr) continue;
    const sp = sprintsOf(d, known);
    const all = sp.flatMap(s => msOfSprint.get(s) || []);
    const prod = all.filter(m => !LEGACY.test(m));
    const v = vote(prod.length ? prod : all);
    if (v) bySprint.set(d.decision_id, { ...v, sprints: sp, legacy: !prod.length });
  }
  // окна: спринты, решения, связанные через спринт, срок вехи
  const windows = milestoneWindows({ milestones, sprints, dated: list.filter(d => bySprint.has(d.decision_id)).map(d => [bySprint.get(d.decision_id).best, d.created_at]) });
  const allMs = milestones.map(m => m.milestone_id).sort(byCode);
  for (const d of list) {
    const id = d.decision_id;
    if (d.has_adr) { with_adr_skipped.push(id); counts.with_adr_skipped++; continue; }
    const base = { decision: id, basis: 'computed-at-transfer' };
    if (Object.prototype.hasOwnProperty.call(human, id)) {
      counts.human++;
      if (human[id]) edges.push({ decision: id, milestone: human[id], basis: 'human', method: 'human', reason: 'выбор человека в мастере', alternatives: [] });
      continue;
    }
    const s = bySprint.get(id);
    if (s) {
      counts.sprint++;
      edges.push({ ...base, milestone: s.best, method: 'sprint', reason: `спринт ${s.sprints.join(', ')} → ${s.best}` + (s.legacy ? ' (только старая веха забега)' : ''), alternatives: s.alternatives });
      continue;
    }
    const dt = day(d.created_at);
    const own = milestones.filter(m => (m.products || []).some(p => (d.products || []).includes(p)) || (m.projects || []).some(p => (d.projects || []).includes(p))).map(m => m.milestone_id);
    let t = pickByTime(dt, own, windows), scope = 'вехи продукта или проекта решения';
    if (!t) { t = pickByTime(dt, allMs, windows); scope = 'любая веха'; }
    if (t) {
      counts.time++;
      edges.push({ ...base, milestone: t.milestone, method: 'time-window', reason: `time-window: дата ${dt} в окне ${t.window[0]}…${t.window[1]} (${scope}; ближайший конец после даты)`, alternatives: t.alternatives });
      continue;
    }
    counts.waiting++;
    waiting.push({ decision: id, title: d.title || null, created_at: dt, why: !isDay(dt) ? 'нет спринта, даты нет' : `нет спринта, дата ${dt} не попала ни в одно окно вех`, candidates: own.sort(byCode) });
  }
  return { edges, waiting, with_adr_skipped, counts, windows };
}

/** Данные источника (только чтение): решения, вехи, спринты. */
export async function readDecisionMilestoneInput(db) {
  const L = v => (Array.isArray(v) ? v.filter(x => x !== null && x !== undefined && x !== '') : []);
  const dec = await db.src(`SELECT decision_id, title, body_md, refs_raw, sprint_refs, created_at, out('DECIDED_IN').size() AS adrs,
    out('BELONGS_TO').out('IN_PRODUCT').code AS products, out('BELONGS_TO_PROJECT').slug AS projects,
    out('ANSWERS').out('RAISED_IN')[@type = 'KnowSprint'].sprint_id AS qs, out('ANSWERS').out('RAISED_IN')[@type = 'KnowTask'].out('PART_OF').sprint_id AS qts FROM KnowDecision`);
  const ms = await db.src("SELECT milestone_id, date_display, out('TARGETS_PRODUCT').code AS products, out('BELONGS_TO_PROJECT').slug AS projects FROM KnowMilestone");
  const sp = await db.src("SELECT sprint_id, created_at, out('TARGETS_MILESTONE').milestone_id AS ms FROM KnowSprint");
  return {
    decisions: dec.map(d => ({ decision_id: d.decision_id, title: d.title || null, body_md: d.body_md || null, refs_raw: d.refs_raw || null, sprint_refs: d.sprint_refs || null,
      created_at: d.created_at || null, has_adr: Number(d.adrs) > 0, products: L(d.products), projects: L(d.projects), question_sprints: [...L(d.qs), ...L(d.qts).flat()] })),
    milestones: ms.map(m => ({ milestone_id: m.milestone_id, date_display: m.date_display || null, products: L(m.products), projects: L(m.projects) })),
    sprints: sp.map(s => ({ sprint_id: s.sprint_id, created_at: s.created_at || null, milestones: L(s.ms) })),
  };
}

/**
 * Записать рёбра в приёмник. Прежние рёбра этого шага (mig_rule = decision-milestone) снимаются — повтор не плодит дублей.
 * Сверка: рёбер столько же, сколько в плане, концы те, дублей нет; отсутствующее решение или веха — в отчёт.
 */
export async function applyDecisionMilestones(db, plan, { at = new Date().toISOString(), log = console.log } = {}) {
  const types = new Set((await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name));
  if (!types.has('TARGETS_MILESTONE')) {
    await db.dstCommand('CREATE EDGE TYPE TARGETS_MILESTONE');
    // MDL-02: связь историчная — поля версии объявляются, как у остальных историчных связей шага
    for (const ddl of edgeHistoryDdl('TARGETS_MILESTONE')) await db.dstCommand(ddl);
  }
  await db.dstCommand("DELETE FROM TARGETS_MILESTONE WHERE mig_rule = 'decision-milestone'");
  const dRid = new Map((await db.dstQuery('SELECT @rid AS r, decision_id AS id FROM KnowDecision')).map(x => [x.id, x.r]));
  const mRid = new Map((await db.dstQuery('SELECT @rid AS r, milestone_id AS id FROM KnowMilestone')).map(x => [x.id, x.r]));
  const missing = [], want = new Map(), by_method = {};
  for (const e of plan.edges) {
    const a = dRid.get(e.decision), b = mRid.get(e.milestone);
    if (!a || !b) { missing.push({ decision: e.decision, milestone: e.milestone, why: [!a && `нет решения ${e.decision} в приёмнике`, !b && `нет вехи ${e.milestone} в приёмнике`].filter(Boolean).join('; ') }); continue; }
    await db.dstCommand(`CREATE EDGE TARGETS_MILESTONE FROM ${a} TO ${b} CONTENT :c`, { c: { mig_rule: 'decision-milestone', mig_decision: e.decision, mig_basis: e.basis || null, mig_method: e.method || null, mig_reason: e.reason || null, mig_alternatives: e.alternatives || [], valid_from: at } });
    want.set(e.decision, `${a}>${b}`);
    by_method[e.method] = (by_method[e.method] || 0) + 1;
  }
  const got = await db.dstQuery("SELECT @out AS o, @in AS i, mig_decision AS s FROM TARGETS_MILESTONE WHERE mig_rule = 'decision-milestone'");
  const seen = new Map(); let wrong = 0;
  for (const x of got) { seen.set(x.s, (seen.get(x.s) || 0) + 1); if (want.get(x.s) !== `${x.o}>${x.i}`) wrong++; }
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
  const ok = !missing.length && got.length === plan.edges.length && !wrong && !duplicates.length;
  for (const m of missing) log(`решение → веха: НЕ перенесено ${m.decision} → ${m.milestone}: ${m.why}`);
  log(`решение → веха (computed-at-transfer): рёбер ${got.length} из ${plan.edges.length} · по способу ${JSON.stringify(by_method)} · «куда?» ждут решения ${(plan.waiting || []).length} · с ADR не связываются ${(plan.with_adr_skipped || []).length}`);
  log('сверка «решение → веха»:', ok ? 'сошлась' : 'НЕ сошлась');
  return { ok, rules: plan.edges.length, edges: got.length, wrong_ends: wrong, missing, duplicates, by_method, counts: plan.counts, waiting: (plan.waiting || []).length, waiting_list: plan.waiting || [] };
}
