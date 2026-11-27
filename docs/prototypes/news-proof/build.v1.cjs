// Сборка сырого массива событий за неделю из выгрузок LORE (MCP query_slice) → data.json
// Никаких вычислений метрик: только нормализация. Метрики считает страница (JS).
const fs = require('fs');
const W = __dirname;
const R = p => JSON.parse(fs.readFileSync(W + '/raw/' + p, 'utf8')).rows;

const T0 = '2026-10-31T21:00:00.000Z';   // 01.11.2026 00:00 МСК
const T1 = '2026-11-07T17:30:00.000Z';   // момент выгрузки (срез)
const D0 = '2026-11-01', D1 = '2026-11-07'; // дни периода для записей «только дата»
const inP = ts => ts && ts >= T0 && ts < T1;
const inPday = d => d && d >= D0 && d <= D1;

// ---------- справочники ----------
const sprints = {};
for (const s of R('sprints.json')) sprints[s.sprint_id] = {
  name: s.name, projects: [...new Set(s.git_projects || [])].sort(), components: [...new Set(s.components || [])].sort(),
  created: s.created_date || null, done: s.done_date || null, status: s.status_raw || null };

const allTasks = [];
for (let i = 0; i < 6; i++) allTasks.push(...R(`alltasks_${i}.json`));
const taskCur = {};
for (const t of allTasks) taskCur[t.task_uid] = t;

// категория статуса задачи: closed = done | cancelled (тот же словарь префиксов, что LoreStatusVocabulary)
function taskCat(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  if (s.startsWith('✅') || /^(DONE|CLOSED|MERGED|ЗАВЕРШ|ЗАКРЫТ)/.test(s)) return 'closed';
  if (s.startsWith('🚫') || /^(CANCEL|ОТМЕН)/.test(s)) return 'closed';
  return 'open';
}
const isCancel = raw => raw != null && (String(raw).trim().startsWith('🚫') || /^(CANCEL|ОТМЕН)/i.test(String(raw).trim()));

// ---------- строки истории задач (task_created_dates: uid, sprint, valid_from — без статуса) ----------
const histRows = JSON.parse(fs.readFileSync(W + '/task_hist_rows.json', 'utf8'));
const vfBy = {}, sprintOf = {};
for (const r of histRows) { (vfBy[r.task_uid] = vfBy[r.task_uid] || []).push(r.valid_from); sprintOf[r.task_uid] = r.sprint_id; }
for (const k in vfBy) vfBy[k].sort();

// ---------- полная история (history_task, по задаче) ----------
const hist = {}; const histErr = {};
for (const f of fs.readdirSync(W + '/hist').filter(f => /^out_\d+\.tsv$/.test(f)).sort()) {
  for (const line of fs.readFileSync(W + '/hist/' + f, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [uid, vf, ...rest] = line.split('\t'); const st = rest.join('\t');
    if (vf === 'ERROR' || vf === 'NOROWS') { histErr[uid] = vf + ' ' + st; continue; }
    (hist[uid] = hist[uid] || []).push({ vf, st: st === 'null' ? null : st });
  }
}
for (const k in hist) { const seen = new Set(); hist[k] = hist[k].filter(r => { const key = r.vf; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => a.vf < b.vf ? -1 : 1); }

// ---------- атрибуция «кто» (agent_actions: журнал вызовов MCP, хранит последние 500) ----------
const aa = R('agent_actions.json');
const AA_FROM = aa.reduce((m, a) => a.ts < m ? a.ts : m, '9'), AA_TO = aa.reduce((m, a) => a.ts > m ? a.ts : m, '');
const aaBy = {};
for (const a of aa) if (a.status === 200) (aaBy[a.entity_id] = aaBy[a.entity_id] || []).push(a);
function who(entity, at) {
  if (!at || at < AA_FROM || at > AA_TO) return { w: null, a: null };           // вне окна журнала — неизвестно
  const list = aaBy[entity] || []; const t = Date.parse(at);
  const hit = list.find(a => Math.abs(Date.parse(a.ts) - t) <= 10000);
  return hit ? { w: 'agent:' + hit.caller, a: true } : { w: null, a: null };
}

const events = []; let seq = 0;
const ev = o => { o.id = 'e' + (++seq); events.push(o); };

// ---------- задачи ----------
const taskStates = []; const touched = new Set();
const histCoverage = { pre: 0, preWithHist: 0, newMulti: 0, newMultiWithHist: 0, newSingle: 0, rowsMismatch: [] };
const projOfSprint = sid => (sprints[sid] && sprints[sid].projects) || [];
const compOfTask = uid => { const c = taskCur[uid] && taskCur[uid].component_id; const sc = (sprints[sprintOf[uid]] && sprints[sprintOf[uid]].components) || []; return c ? [c] : sc; };

const untouchedBySprint = {}; const noDated = [];
for (const uid of Object.keys(vfBy).concat(Object.keys(taskCur).filter(u => !vfBy[u])).filter((v, i, a) => a.indexOf(v) === i)) {
  const sid = sprintOf[uid] || (taskCur[uid] && taskCur[uid].sprint_id) || null;
  const vfs = vfBy[uid] || []; const created = vfs[0] || null;
  const rowsInP = vfs.filter(inP);
  const cur = taskCur[uid]; const curCat = cur ? taskCat(cur.status_raw) : null;
  if (!rowsInP.length) {
    // нет ни одной версии в периоде: состояние на t0 = на t1 = текущее (точно, если версий после t1 нет)
    const after = vfs.some(v => v >= T1);
    if (!after && created && created < T0) {
      const u = untouchedBySprint[sid] = untouchedBySprint[sid] || { sprint_id: sid, open: 0, closed: 0, unknown: 0 };
      if (curCat === 'open') u.open++; else if (curCat === 'closed') u.closed++; else u.unknown++;
      continue;
    }
    if (!created) { const u = untouchedBySprint[sid] = untouchedBySprint[sid] || { sprint_id: sid, open: 0, closed: 0, unknown: 0 }; u.unknown++; noDated.push(uid + " (" + (cur ? cur.status_raw : "?") + ")"); continue; }
  }
  touched.add(uid);
  const H = hist[uid];
  const st = { uid, sprint_id: sid, created, rows_in_p: rowsInP.length, cur_status: cur ? cur.status_raw : null };
  const createdInP = inP(created);
  if (!createdInP && created < T0) histCoverage.pre++; else if (vfs.length > 1) histCoverage.newMulti++; else histCoverage.newSingle++;
  if (H) {
    if (!createdInP) histCoverage.preWithHist++; else histCoverage.newMultiWithHist++;
    // сверка множества версий: история задачи ↔ task_created_dates
    const a = H.map(r => r.vf).filter(v => v < T1).join('|'), b = vfs.filter(v => v < T1).join('|');
    if (a !== b) histCoverage.rowsMismatch.push(uid);
    const at = t => { let s; for (const r of H) { if (r.vf <= t) s = r; else break; } return s; };
    const s0 = at(T0), s1 = at(T1);
    st.cat_t0 = createdInP ? 'absent' : (s0 ? taskCat(s0.st) : 'absent');
    st.cat_t1 = s1 ? taskCat(s1.st) : 'absent';
    st.src = 'history';
    // события из истории
    let prev = null;
    for (const r of H) {
      if (r.vf >= T1) break;
      let kind;
      if (!prev) kind = 'created';
      else {
        const pc = taskCat(prev.st), nc = taskCat(r.st);
        if (pc === 'open' && nc === 'closed') kind = isCancel(r.st) ? 'cancelled' : 'closed';
        else if (pc === 'closed' && nc === 'open') kind = 'reopened';
        else if ((prev.st || '') !== (r.st || '')) kind = 'status';
        else kind = 'changed';
      }
      if (inP(r.vf)) ev({ t: 'task', el: uid, k: kind, at: r.vf, s: sid, to: r.st, ...who(uid, r.vf), p: projOfSprint(sid), c: compOfTask(uid), src: 'history_task' });
      prev = r;
    }
  } else {
    // истории нет: состояние на t1 = текущее, на t0 — «отсутствовала», если заведена в периоде, иначе НЕИЗВЕСТНО
    st.cat_t0 = createdInP ? 'absent' : 'unknown';
    st.cat_t1 = curCat;
    st.src = createdInP ? (vfs.length === 1 ? 'created_in_P_single_version' : 'created_in_P_no_history') : 'no_history';
    vfs.forEach((v, i) => {
      if (!inP(v)) return;
      let kind = i === 0 ? 'created' : 'version?';
      // одна-единственная версия: заведена и сразу в текущем статусе
      ev({ t: 'task', el: uid, k: kind, at: v, s: sid, to: (i === 0 && vfs.length === 1) ? (cur && cur.status_raw) : null, ...who(uid, v), p: projOfSprint(sid), c: compOfTask(uid), src: 'task_created_dates' });
    });
  }
  // снимок t1 по «текущему» срезу all_tasks — для сверки с историей
  st.cat_t1_snapshot = curCat;
  taskStates.push(st);
}

// ---------- спринты ----------
for (const [sid, s] of Object.entries(sprints)) {
  if (inP(s.created)) ev({ t: 'sprint', el: sid, k: 'created', at: s.created, s: sid, ...who(sid, s.created), p: s.projects, c: s.components, src: 'sprints.created_date' });
  if (inP(s.done)) ev({ t: 'sprint', el: sid, k: 'closed', at: s.done, s: sid, ...who(sid, s.done), p: s.projects, c: s.components, src: 'sprints.done_date' });
}
// ---------- релизы (только дата) ----------
for (const r of R('releases_window.json')) if (inPday(r.release_date))
  ev({ t: 'release', el: r.release_id, k: 'released', at: null, day: r.release_date, w: null, a: null, p: [r.project], c: [], src: 'releases_since' });

// ---------- ADR ----------
const adrs = R('adrs.json'); const adrById = {}; for (const a of adrs) adrById[a.adr_id] = a;
const adrHist = R('adr_history_all.json'); const adrFirst = {};
for (const h of adrHist) if (!adrFirst[h.adr_id] || h.valid_from < adrFirst[h.adr_id]) adrFirst[h.adr_id] = h.valid_from;
for (const a of adrs) if (inPday(a.date_created))
  ev({ t: 'adr', el: a.adr_id, k: 'created', at: null, day: a.date_created, w: null, a: null, p: [...new Set(a.git_projects || [])].sort(), c: [...new Set(a.components || [])].sort(), to: a.status, src: 'adrs.date_created' });
for (const h of adrHist) if (inP(h.valid_from) && h.valid_from !== adrFirst[h.adr_id]) {
  const a = adrById[h.adr_id] || {};
  ev({ t: 'adr', el: h.adr_id, k: 'changed', at: h.valid_from, ...who(h.adr_id, h.valid_from), p: [...new Set(h.projects || a.git_projects || [])].sort(), c: [...new Set(a.components || [])].sort(), src: 'adr_history_all' });
}
// ---------- решения ----------
const decs = []; for (const f of ['decisions.json']) decs.push(...R(f));
const decTl = {}; for (const d of R('timeline_decisions.json')) decTl[d.decision_id] = d;
for (const d of decs) {
  const tl = decTl[d.decision_id] || {};
  let p = (d.projects && d.projects.length) ? d.projects : (tl.adr_projects || []);
  p = [...new Set(p)].sort(); const c = [...new Set(d.components || [])].sort();
  if (inPday(d.date_created)) ev({ t: 'decision', el: d.decision_id, k: 'created', at: null, day: d.date_created, w: null, a: null, p, c, to: d.status_raw, parent: d.parent_adr, src: 'decisions.date_created' });
  if (tl.updated_at && inP(tl.updated_at) && String(tl.updated_at).slice(0, 10) !== d.date_created)
    ev({ t: 'decision', el: d.decision_id, k: 'changed', at: tl.updated_at.replace(/(\.\d{3})\d+Z$/, '$1Z'), ...who(d.decision_id, tl.updated_at), p, c, parent: d.parent_adr, src: 'timeline_decisions.updated_at' });
}
// ---------- спеки ----------
const specs = R('specs.json'); const specById = {}; for (const s of specs) specById[s.spec_id] = s;
const tspec = {}; for (const s of R('timeline_specs.json')) tspec[s.spec_id] = s;
const specHist = R('spec_history_all.json'); const specFirst = {};
for (const h of specHist) if (!specFirst[h.spec_id] || h.valid_from < specFirst[h.spec_id]) specFirst[h.spec_id] = h.valid_from;
const SPEC_HIST_MIN = specHist.reduce((m, h) => h.valid_from < m ? h.valid_from : m, '9');
for (const s of specs) {
  const created = (tspec[s.spec_id] && tspec[s.spec_id].date_created) || (specFirst[s.spec_id] > SPEC_HIST_MIN ? specFirst[s.spec_id] : null);
  const p = [...new Set(s.projects || [])].sort(), c = s.component_id ? [s.component_id] : [];
  if (inP(created)) ev({ t: 'spec', el: s.spec_id, k: 'created', at: created, ...who(s.spec_id, created), p, c, to: s.status, src: tspec[s.spec_id] ? 'timeline_specs' : 'spec_history_all(min)' });
}
for (const h of specHist) if (inP(h.valid_from) && h.valid_from !== ((tspec[h.spec_id] && tspec[h.spec_id].date_created) || specFirst[h.spec_id])) {
  const s = specById[h.spec_id] || {};
  ev({ t: 'spec', el: h.spec_id, k: 'version', at: h.valid_from, ...who(h.spec_id, h.valid_from), p: [...new Set(h.projects || s.projects || [])].sort(), c: s.component_id ? [s.component_id] : [], src: 'spec_history_all' });
}

// ---------- знания: текущие состояния (для очереди) ----------
const knowledge = {
  adrs: adrs.map(a => ({ id: a.adr_id, status: a.status, created: a.date_created, p: a.git_projects || [], c: a.components || [], children: a.decision_count })),
  decisions: decs.map(d => ({ id: d.decision_id, status: d.status_raw, created: d.date_created, parent: d.parent_adr })),
  specs: specs.map(s => ({ id: s.spec_id, status: s.status, version: s.version })),
};

// детерминизм: сортировка по (at|day, id элемента, вид)
events.sort((x, y) => ((x.at || x.day + 'T00:00:00.000Z') < (y.at || y.day + 'T00:00:00.000Z') ? -1 : (x.at || x.day + 'T00:00:00.000Z') > (y.at || y.day + 'T00:00:00.000Z') ? 1 : x.el < y.el ? -1 : x.el > y.el ? 1 : x.k < y.k ? -1 : 1));
events.forEach((e, i) => e.id = 'e' + (i + 1));
taskStates.sort((a, b) => a.uid < b.uid ? -1 : 1);

const out = {
  meta: { t0: T0, t1: T1, days_local: [D0, D1], tz: 'Europe/Moscow (UTC+3)', pulled_at_utc: '2026-11-07T17:30Z..17:45Z', agent_actions_window: [AA_FROM, AA_TO], spec_hist_min: SPEC_HIST_MIN,
    counts: { task_hist_rows: histRows.length, tasks_total: allTasks.length, sprints: Object.keys(sprints).length, adrs: adrs.length, decisions: decs.length, specs: specs.length, adr_hist_rows: adrHist.length, spec_hist_rows: specHist.length, agent_actions: aa.length, releases_window: R('releases_window.json').length, history_task_fetched: Object.keys(hist).length, history_task_errors: Object.keys(histErr).length },
    histCoverage: { ...histCoverage, rowsMismatchCount: histCoverage.rowsMismatch.length, rowsMismatch: histCoverage.rowsMismatch.slice(0, 20) }, noDated },
  sprints: Object.fromEntries(Object.entries(sprints).filter(([k]) => events.some(e => e.s === k) || taskStates.some(t => t.sprint_id === k) || untouchedBySprint[k]).map(([k, v]) => [k, { name: v.name, p: v.projects, c: v.components }])),
  events, taskStates, untouchedBySprint: Object.values(untouchedBySprint).sort((a, b) => String(a.sprint_id) < String(b.sprint_id) ? -1 : 1), knowledge,
};
fs.writeFileSync(W + '/data.json', JSON.stringify(out));
console.log('events', events.length, 'taskStates', taskStates.length, 'untouched sprints', out.untouchedBySprint.length, 'size', JSON.stringify(out).length);
console.log(out.meta.histCoverage);
const kc = {}; for (const e of events) kc[e.t + ':' + e.k] = (kc[e.t + ':' + e.k] || 0) + 1; console.log(kc);
