// SPRINT_UXR_S7A_NEWS/S7A-09: эталонные числа для NewsV2EngineFixtureTest — из JS-модели прототипа.
//
// Берёт ДОСЛОВНО функции docs/prototypes/news-proof/page.tpl.html (prepare, groupCount, burn,
// shipModel, matrix, knowledge, validate) и прогоняет их на фикстуре §10.4, собранной здесь в
// формат data.json по правилам build.cjs. Ожидаемые числа Java-теста скопированы из вывода.
//
// Запуск (из корня репо): node backend/src/test/resources/news-v2/crosscheck-js.cjs
// §7.2b (своё/общее) и §7.2c (реактивация) в прототипе нет — их числа в тесте посчитаны по формулам спеки.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../../../../..');
const T0 = '2026-10-31T21:00:00.000Z', T1 = '2026-11-07T21:00:00.000Z';
const z = s => s + ':00.000Z';

// ---------- фикстура (зеркало NewsV2EngineFixtureTest.fixture()) ----------
const sprints = {
  S1: { p: ['P1'], c: ['C1'], rel: [['P1#v1', '2026-10-20'], ['P1#v2', '2026-11-04']] },
  S2: { p: ['P1', 'P2'], c: ['C2'], rel: [['P2#v3', '2026-11-03']], created: z('2026-11-01T09:00') },
  S3: { p: ['P2'], c: ['C3'], rel: [] },
};
const P = '📋 PLANNED', DONE = '✅ DONE', RFD = '🚀 READY FOR DEPLOY', WIP = '🔄 IN PROGRESS';
const tasks = {
  'S2/A': { s: 'S2', tl: [[z('2026-10-01T10:00'), P], [z('2026-10-10T10:00'), DONE], [z('2026-11-02T10:00'), WIP], [z('2026-11-03T10:00'), DONE]], snap: DONE },
  'S1/B': { s: 'S1', tl: [[z('2026-10-25T10:00'), P], [z('2026-11-02T12:00'), DONE]], snap: DONE },
  'S1/C': { s: 'S1', tl: [[z('2026-11-02T08:00'), P], [z('2026-11-04T09:00'), P], [z('2026-11-04T09:10'), P], [z('2026-11-04T09:20'), P]], snap: P },
  'S1/D': { s: 'S1', tl: [[z('2026-10-20T10:00'), P], [z('2026-11-05T10:00'), RFD]], snap: RFD },
  'S1/F': { s: 'S1', tl: [[z('2026-10-20T10:00'), P], [z('2026-11-03T10:00'), RFD]], snap: RFD },
  'S1/H': { s: 'S1', tl: [[z('2026-10-10T10:00'), P], [z('2026-10-15T10:00'), RFD], [z('2026-11-02T09:00'), DONE]], snap: DONE },
  'S1/K': { s: 'S1', tl: [[z('2026-10-10T10:00'), P], [z('2026-10-15T10:00'), RFD], [z('2026-11-04T10:00'), WIP]], snap: WIP },
  'S3/E': { s: 'S3', tl: [[z('2026-10-20T10:00'), P], [z('2026-11-06T10:00'), RFD]], snap: RFD },
  'S2/G': { s: 'S2', tl: [[z('2026-10-20T10:00'), P], [z('2026-11-05T12:00'), DONE]], snap: DONE },
  'S1/U': { s: 'S1', tl: [[z('2026-09-01T10:00'), P]], snap: P },
};
const agentAt = new Set([z('2026-11-04T09:00'), z('2026-11-04T09:10'), z('2026-11-04T09:20')]);

// ---------- сборка D по правилам build.cjs ----------
const inP = ts => ts && ts >= T0 && ts < T1;
function taskCat(raw) { if (raw == null) return null; const s = String(raw).trim().toUpperCase();
  if (s.startsWith('✅') || /^(DONE|CLOSED|MERGED|ЗАВЕРШ|ЗАКРЫТ)/.test(s)) return 'closed';
  if (s.startsWith('🚫') || /^(CANCEL|ОТМЕН)/.test(s)) return 'closed'; return 'open'; }
const isCancel = raw => raw != null && (String(raw).trim().startsWith('🚫') || /^(CANCEL|ОТМЕН)/i.test(String(raw).trim()));
const events = [], taskStates = [], timelines = {}, untouched = {};
for (const [uid, t] of Object.entries(tasks)) {
  const vfs = t.tl.map(r => r[0]); const created = vfs[0];
  if (!vfs.some(inP) && created < T0) { const u = untouched[t.s] = untouched[t.s] || { sprint_id: t.s, open: 0, closed: 0, unknown: 0 };
    if (taskCat(t.snap) === 'open') u.open++; else u.closed++; continue; }
  const at = ts => { let s; for (const r of t.tl) { if (r[0] <= ts) s = r; else break; } return s; };
  const s0 = at(T0), s1 = at(T1); const createdInP = inP(created);
  taskStates.push({ uid, sprint_id: t.s, created, cur_status: t.snap, src: 'history',
    cat_t0: createdInP ? 'absent' : (s0 ? taskCat(s0[1]) : 'absent'), cat_t1: s1 ? taskCat(s1[1]) : 'absent', cat_t1_snapshot: taskCat(t.snap) });
  timelines[uid] = t.tl.filter(r => r[0] < T1);
  let prev = null;
  for (const r of t.tl) { if (r[0] >= T1) break; let kind;
    if (!prev) kind = 'created'; else { const pc = taskCat(prev[1]), nc = taskCat(r[1]);
      if (pc === 'open' && nc === 'closed') kind = isCancel(r[1]) ? 'cancelled' : 'closed';
      else if (pc === 'closed' && nc === 'open') kind = 'reopened'; else if (prev[1] !== r[1]) kind = 'status'; else kind = 'changed'; }
    if (inP(r[0])) events.push({ t: 'task', el: uid, k: kind, at: r[0], s: t.s, to: r[1], w: agentAt.has(r[0]) && uid === 'S1/C' ? 'agent:claude' : null,
      a: agentAt.has(r[0]) && uid === 'S1/C' ? true : null, p: sprints[t.s].p, c: sprints[t.s].c, src: 'history_task' });
    prev = r; }
}
events.push({ t: 'sprint', el: 'S2', k: 'created', at: sprints.S2.created, s: 'S2', w: null, a: null, p: sprints.S2.p, c: sprints.S2.c });
events.push({ t: 'release', el: 'P1#v2', k: 'released', at: null, day: '2026-11-04', w: null, a: null, p: ['P1'], c: [] });
events.push({ t: 'release', el: 'P2#v3', k: 'released', at: null, day: '2026-11-03', w: null, a: null, p: ['P2'], c: [] });
events.push({ t: 'adr', el: 'ADR-1', k: 'created', at: null, day: '2026-11-02', w: null, a: null, p: ['P1'], c: [] });
events.push({ t: 'adr', el: 'ADR-1', k: 'changed', at: z('2026-11-02T15:00'), w: null, a: null, p: ['P1'], c: [] });
events.push({ t: 'adr', el: 'ADR-2', k: 'changed', at: z('2026-11-03T10:00'), w: null, a: null, p: ['P1', 'P2'], c: [] });
events.push({ t: 'adr', el: 'ADR-3', k: 'changed', at: z('2026-11-05T11:00'), w: null, a: null, p: ['P2'], c: [] });
events.push({ t: 'decision', el: 'DEC-1', k: 'created', at: null, day: '2026-11-02', w: null, a: null, p: ['P1'], c: [], parent: 'ADR-1' });
events.push({ t: 'spec', el: 'SPEC-1', k: 'created', at: z('2026-11-03T12:00'), w: null, a: null, p: ['P2'], c: [] });
events.push({ t: 'spec', el: 'SPEC-1', k: 'version', at: z('2026-11-06T10:00'), w: null, a: null, p: ['P2'], c: [] });
const key = e => e.at || e.day + 'T00:00:00.000Z';
events.sort((x, y) => key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : x.el < y.el ? -1 : x.el > y.el ? 1 : x.k < y.k ? -1 : 1);
events.forEach((e, i) => e.id = 'e' + (i + 1));
const shipSprints = {};
for (const [sid, s] of Object.entries(sprints))
  shipSprints[sid] = { found: true, tags: [], resolved: s.rel.map(([uid, date]) => ({ uid, date, how: 'project' })), unresolved: [] };
const D = {
  timelines, timelinesAfterT1: {}, ship: { sprints: shipSprints, untouchedReady: [], prProbe: [], src: { releases: 3, sprint_rows: 3 } },
  meta: { t0: T0, t1: T1, days_local: ['2026-11-01', '2026-11-07'], counts: { decisions: 1 },
    histCoverage: { pre: 0, preWithHist: 0, newMulti: 0, newMultiWithHist: 0, newSingle: 0, rowsMismatch: [], rowsMismatchCount: 0 }, noDated: [] },
  sprints: Object.fromEntries(Object.entries(sprints).map(([k, v]) => [k, { name: k, p: v.p, c: v.c }])),
  events, taskStates, untouchedBySprint: Object.values(untouched),
  knowledge: {
    adrs: [{ id: 'ADR-1', status: 'PROPOSED', created: '2026-11-02' }, { id: 'ADR-2', status: 'ACCEPTED', created: '2026-10-01' }, { id: 'ADR-3', status: 'PROPOSED', created: '2026-09-01' }],
    decisions: [{ id: 'DEC-1', status: 'accepted', created: '2026-11-02', parent: 'ADR-1' }],
    specs: [{ id: 'SPEC-1', status: 'draft', version: '1.0.0' }] },
};

// ---------- функции прототипа, дословно ----------
// NEWS_PROOF_DIR — если прототипа нет в этом чекауте (он есть не во всех ветках).
const tpl = fs.readFileSync(path.join(process.env.NEWS_PROOF_DIR || path.join(ROOT, 'docs/prototypes/news-proof'), 'page.tpl.html'), 'utf8');
const a = tpl.indexOf("'use strict';"), b = tpl.indexOf('// ---------- рендер v2');
const code = tpl.slice(a, b).replace(/const D = JSON\.parse\([^;]*\);/, 'const D = __D;');
const F = vm.runInNewContext(code + '\n;({prepare, groupCount, VARIANTS, burn, shipModel, shipPure, matrix, matrixPure, knowledge, validate, rollup})',
  { __D: D, document: null, console });

const Pp = F.prepare('msk');
const gc = v => { const R = F.groupCount(Pp.E, F.VARIANTS.find(x => x.id === v).g, 'msk');
  return { list: R.list.map(g => [g.g, g.ev, g.el, g.multi]), totEv: R.totEv, totEl: R.totEl, M: R.M, extra: R.extra, agEvT: R.agEvT }; };
const B = F.burn(); const SM = F.shipModel('msk'); const K = F.knowledge();
const out = {
  prepare: { E: Pp.E.length, dropped: Pp.dropped.length, rows: Pp.rows.length, multRows: Pp.rows.filter(r => r.mult > 1).map(r => [r.key, r.mult]) },
  project: gc('project'), type: gc('type'), author: gc('author'),
  rollup: F.rollup(Pp.E).filter(s => s.items.length > 1).map(s => [s.key, s.items.length]),
  burnOldRule: { all: B.all, P1: B.project.P1, P2: B.project.P2 },
  ship: F.shipPure(SM), waitsMedian: SM.med, oldest: SM.oldest.map(o => [o.uid, +o.age.toFixed(4), o.ship]),
  matrix1: F.matrixPure(F.matrix('msk', 1)),
  knowledge: { adr: { Q1: K.adr.Q1, Q0lo: K.adr.Q0lo, Q0hi: K.adr.Q0hi, newAll: K.adr.newAll, newProp: K.adr.newProp },
    dec: { Q1: K.dec.Q1, Q0lo: K.dec.Q0lo, Q0hi: K.dec.Q0hi, newAll: K.dec.newAll, newDecided: K.dec.newDecided },
    revEv: K.revEv, adrChEv: K.adrChEv, adrChEl: K.adrChEl, specVev: K.specVev, specNew: K.specNew, adrNewChildren: K.adrNewChildren },
  validateFailed: F.validate('msk').filter(c => c.ok === false).map(c => c.inv + ' ' + c.name),
};
console.log(JSON.stringify(out, (k, v) => v instanceof Set ? [...v] : v, 1));
