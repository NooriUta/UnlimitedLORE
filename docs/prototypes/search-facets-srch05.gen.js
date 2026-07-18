// Прототип v2: ранжирование + фасеты (тип, компонент, проект) с НАСЛЕДОВАНИЕМ связей.
const AUTH = 'Basic ' + Buffer.from(process.env.U + ':' + process.env.P).toString('base64');
const fs = require('fs');

async function sql(c) {
  const r = await fetch('http://127.0.0.1:2480/api/v1/query/system_aida_lore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: AUTH },
    body: Buffer.from(JSON.stringify({ language: 'sql', command: c }), 'utf8'),
  });
  try { return JSON.parse(await r.text()); } catch { return {}; }
}
const one = (v) => Array.isArray(v) ? v[0] : v;
const arr = (v) => Array.isArray(v) ? v.filter(Boolean).map(String) : (v ? [String(v)] : []);

const BRANCHES = [
  { idx: 'ftKnowADR',      type: 'adr',      cls: 'KnowADR',      id: 'adr_id',      title: 'name'  },
  { idx: 'ftKnowADRHist',  type: 'adr',      cls: 'KnowADRHist',  parent: 'adr_id',  ptitle: 'name', body: 'тело ADR' },
  { idx: 'ftKnowSpec',     type: 'spec',     cls: 'KnowSpec',     id: 'spec_id',     title: 'title' },
  { idx: 'ftKnowSpecHist', type: 'spec',     cls: 'KnowSpecHist', parent: 'spec_id', ptitle: 'title', body: 'тело спеки' },
  { idx: 'ftKnowTask',     type: 'task',     cls: 'KnowTask',     id: 'task_uid',    title: 'title' },
  { idx: 'ftKnowTaskHist', type: 'task',     cls: 'KnowTaskHist', parent: 'task_uid',ptitle: 'title', body: 'заметка задачи' },
  { idx: 'ftKnowDecision', type: 'decision', cls: 'KnowDecision', id: 'decision_id', title: 'title' },
  { idx: 'ftKnowQuestion', type: 'question', cls: 'KnowQuestion', id: 'question_id', title: 'title' },
  { idx: 'ftKnowSprint',   type: 'sprint',   cls: 'KnowSprint',   id: 'sprint_id',   title: 'name'  },
  { idx: 'ftKnowRunbook',  type: 'runbook',  cls: 'KnowRunbook',  id: 'runbook_id',  title: 'name'  },
  { idx: 'ftKnowDoc',      type: 'doc',      cls: 'KnowDoc',      id: 'doc_id',      title: 'title' },
  { idx: 'ftKnowFeature',  type: 'feature',  cls: 'KnowFeature',  id: 'feature_id',  title: 'title' },
  { idx: 'ftKnowUseCase',  type: 'use_case', cls: 'KnowUseCase',  id: 'uc_id',       title: 'title' },
  { idx: 'ftKnowPain',     type: 'pain',     cls: 'KnowPain',     id: 'pain_id',     title: 'title' },
  { idx: 'ftKnowGain',     type: 'gain',     cls: 'KnowGain',     id: 'gain_id',     title: 'title' },
  { idx: 'ftKnowActor',    type: 'actor',    cls: 'KnowActor',    id: 'actor_id',    title: 'name'  },
];
const PRIORITY = {
  feature: 1.30, use_case: 1.30, pain: 1.25, gain: 1.25, job: 1.25, actor: 1.20,
  adr: 1.25, decision: 1.20, spec: 1.10, doc: 1.10, runbook: 1.05, question: 1.00,
  sprint: 0.90, task: 0.70,
};
// Каждый токен идёт как «слово ИЛИ префикс».
// Замерено: голый префикс УБИВАЕТ совпадение на словах, чья основа отличается
// от набранной формы. Индексируется основа («миграц»), а wildcard-терм Lucene
// НЕ анализирует и ищет буквальное «миграция…» — получаем 0 вместо 55.
// (X OR X*) даёт объединение: морфология от X, недонабранные слова и английское
// множественное — от X*. Строго не хуже каждого из них по отдельности.
const lucene = (q) => q.trim().split(/\s+/).filter(Boolean)
  .map(t => `(${t} OR ${t}*)`).join(' AND ');

// ── карты связей: прямые + для наследования ────────────────────────────────
const MAP = { sprint: {}, adr: {}, spec: {}, doc: {}, question: {}, decisionAdr: {} };
async function loadMaps() {
  const s = await sql("SELECT sprint_id, out('BELONGS_TO').component_id AS c, out('BELONGS_TO_PROJECT').slug AS p FROM KnowSprint");
  (s.result || []).forEach(r => MAP.sprint[r.sprint_id] = { c: arr(r.c), p: arr(r.p) });
  const a = await sql("SELECT adr_id, out('BELONGS_TO').component_id AS c, out('BELONGS_TO_PROJECT').slug AS p FROM KnowADR");
  (a.result || []).forEach(r => MAP.adr[r.adr_id] = { c: arr(r.c), p: arr(r.p) });
  const sp = await sql("SELECT spec_id, out('BELONGS_TO').component_id AS c FROM KnowSpec");
  (sp.result || []).forEach(r => MAP.spec[r.spec_id] = { c: arr(r.c), p: [] });
  const dc = await sql("SELECT doc_id, out('BELONGS_TO').component_id AS c FROM KnowDoc");
  (dc.result || []).forEach(r => MAP.doc[r.doc_id] = { c: arr(r.c), p: [] });
  const qq = await sql("SELECT question_id, out('BELONGS_TO').component_id AS c, out('BELONGS_TO_PROJECT').slug AS p FROM KnowQuestion");
  (qq.result || []).forEach(r => MAP.question[r.question_id] = { c: arr(r.c), p: arr(r.p) });
  const d = await sql("SELECT decision_id, out('DECIDED_IN').adr_id AS a FROM KnowDecision");
  (d.result || []).forEach(r => MAP.decisionAdr[r.decision_id] = one(r.a));
}

// Разрешение фасетов. Возвращает {c, p, inherited} — inherited помечает, что
// связь не прямая, а выведена: это НЕ то же самое, и в UI различается.
function facets(type, id) {
  const direct = (m) => (m && (m.c.length || m.p.length)) ? { ...m, from: null } : null;
  if (type === 'sprint')   return direct(MAP.sprint[id])   || { c: [], p: [], from: null };
  if (type === 'adr')      return direct(MAP.adr[id])      || { c: [], p: [], from: null };
  if (type === 'spec')     return direct(MAP.spec[id])     || { c: [], p: [], from: null };
  if (type === 'doc')      return direct(MAP.doc[id])      || { c: [], p: [], from: null };
  if (type === 'question') return direct(MAP.question[id]) || { c: [], p: [], from: null };
  if (type === 'task') {                     // спринт зашит префиксом task_uid
    const sid = String(id).split('/')[0];
    const m = MAP.sprint[sid];
    return m ? { c: m.c, p: m.p, from: 'спринт ' + sid } : { c: [], p: [], from: null };
  }
  if (type === 'decision') {                 // решение наследует от родительского ADR
    const adr = MAP.decisionAdr[id];
    const m = adr && MAP.adr[adr];
    return m ? { c: m.c, p: m.p, from: adr } : { c: [], p: [], from: null };
  }
  return { c: [], p: [], from: null };
}

async function search(userQuery, perBranch = 10) {
  const lq = lucene(userQuery).replace(/'/g, '');
  const toks = userQuery.trim().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const b of BRANCHES) {
    const sel = b.parent
      ? `in('HAS_STATE').${b.parent} AS pid, in('HAS_STATE').${b.ptitle} AS ptitle, $score AS s`
      : `${b.id} AS pid, ${b.title} AS ptitle, $score AS s`;
    const r = await sql(`SELECT ${sel} FROM ${b.cls} WHERE SEARCH_INDEX('${b.idx}','${lq}') = true ORDER BY s DESC LIMIT ${perBranch}`);
    if (r.error) continue;
    for (const row of r.result || []) {
      const pid = one(row.pid); if (!pid) continue;
      const pt = one(row.ptitle);
      const titleStr = pt ? String(pt).toLowerCase() : '';
      const f = facets(b.type, String(pid));
      hits.push({
        type: b.type, ref_id: String(pid), title: pt ? String(pt) : '',
        score: Number(row.s) || 0,
        where: b.body ? b.body : (toks.some(t => titleStr.includes(t.toLowerCase())) ? 'заголовок' : 'тело'),
        rank: (Number(row.s) || 0) * (PRIORITY[b.type] ?? 1),
        comp: f.c, proj: f.p, inheritedFrom: f.from,
      });
    }
  }
  const best = new Map();
  for (const h of hits) {
    const k = h.type + '|' + h.ref_id;
    if (!best.has(k) || best.get(k).rank < h.rank) best.set(k, h);
  }
  return [...best.values()].sort((a, b) => b.rank - a.rank);
}

(async () => {
  await loadMaps();
  const out = {};
  for (const q of process.argv.slice(2)) {
    const rows = await search(q);
    out[q] = rows;
    const noComp = rows.filter(r => !r.comp.length).length;
    const inh = rows.filter(r => r.inheritedFrom).length;
    console.log(`«${q}» → ${rows.length} результатов | без компонента: ${noComp} | связь выведена: ${inh}`);
  }
  fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1), 'utf8');
  console.log('сохранено:', process.env.OUT);
})();
