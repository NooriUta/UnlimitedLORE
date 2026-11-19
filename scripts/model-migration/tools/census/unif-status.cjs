// Сверка: какие значения статуса реально стоят в данных и есть ли они в справочнике.
// Только чтение. Запуск: node mig/unif-status.cjs (из C:/AIDA/_audit_scripts).
const { execSync } = require('child_process');
const fs = require('fs');
function q(sql) {
  const out = execSync('sh q.sh', { input: JSON.stringify({ language: 'sql', command: sql }), cwd: 'C:/AIDA/_audit_scripts', maxBuffer: 1 << 26 }).toString();
  const j = JSON.parse(out);
  if (!j.result) throw new Error(sql + ' -> ' + out.slice(0, 300));
  return j.result;
}
const dicts = {};
for (const r of q('SELECT dict_type, code FROM KnowDictEntry')) (dicts[r.dict_type] ||= new Set()).add(r.code);
// [подпись, запрос группировки, справочник]
const probes = [
  ['task (открытая версия)', "SELECT status_raw AS v, count(*) AS n FROM KnowTaskHist WHERE valid_to IS NULL GROUP BY status_raw", 'task_status'],
    ['sprint (открытая версия)', "SELECT status_raw AS v, count(*) AS n FROM KnowSprintHist WHERE valid_to IS NULL GROUP BY status_raw", 'sprint_status'],
  ['phase (открытая версия)', "SELECT status_raw AS v, count(*) AS n FROM KnowPhaseHist WHERE valid_to IS NULL GROUP BY status_raw", 'phase_status'],
  ['adr (открытая версия)', "SELECT status_raw AS v, count(*) AS n FROM KnowADRHist WHERE valid_to IS NULL GROUP BY status_raw", 'adr_status'],
  ['decision (открытая версия)', "SELECT status_raw AS v, count(*) AS n FROM KnowDecisionHist WHERE valid_to IS NULL GROUP BY status_raw", 'decision_status'],
  ['decision (вершина)', "SELECT status_raw AS v, count(*) AS n FROM KnowDecision GROUP BY status_raw", 'decision_status'],
  ['spec (открытая версия)', "SELECT status AS v, count(*) AS n FROM KnowSpecHist WHERE valid_to IS NULL GROUP BY status", 'spec_status'],
        ['milestone (открытая версия)', "SELECT status_raw AS v, count(*) AS n FROM KnowMilestoneHist WHERE valid_to IS NULL GROUP BY status_raw", 'milestone_status'],
  ['question', "SELECT status AS v, count(*) AS n FROM KnowQuestion GROUP BY status", 'question_status'],
  ['feature/usecase', "SELECT status AS v, count(*) AS n FROM KnowUseCase GROUP BY status", 'feature_status'],
  ['quality_gate', "SELECT status AS v, count(*) AS n FROM QualityGate GROUP BY status", 'qg_status'],
  ['task.priority', "SELECT priority AS v, count(*) AS n FROM KnowTaskHist WHERE valid_to IS NULL GROUP BY priority", 'priority'],
  ['sprint.priority', "SELECT priority AS v, count(*) AS n FROM KnowSprintHist WHERE valid_to IS NULL GROUP BY priority", 'priority'],
  ['question.priority', "SELECT priority AS v, count(*) AS n FROM KnowQuestion GROUP BY priority", 'priority'],
  ['task.task_type', "SELECT task_type AS v, count(*) AS n FROM KnowTask GROUP BY task_type", 'task_type'],
  ['task.work_class', "SELECT work_class AS v, count(*) AS n FROM KnowTask GROUP BY work_class", 'work_class'],
];
const out = [];
for (const [label, sql, dict] of probes) {
  let rows;
  try { rows = q(sql); } catch (e) { out.push({ label, error: String(e.message).slice(0, 200) }); continue; }
  const known = dict ? dicts[dict] || new Set() : null;
  const total = rows.reduce((s, r) => s + r.n, 0);
  const empty = rows.filter(r => r.v == null || r.v === '').reduce((s, r) => s + r.n, 0);
  const outside = known ? rows.filter(r => r.v != null && r.v !== '' && !known.has(r.v)) : [];
  const norm = v => String(v).replace(/^[^A-Za-zА-Яа-я]+/, "").trim().toLowerCase().replace(/[ -]+/g, "_");
  const caseOnly = known ? outside.filter(r => [...known].some(k => k.toLowerCase() === norm(r.v))) : [];
  const unused = known ? [...known].filter(k => !rows.some(r => r.v === k)) : [];
  out.push({ label, dict, total, empty, values: rows.map(r => `${r.v}:${r.n}`).join(' '),
    outside: outside.map(r => `${r.v}:${r.n}`).join(' '), caseOnly: caseOnly.map(r => r.v).join(' ; '), hard: outside.filter(r=>!caseOnly.includes(r)).map(r => r.v+':'+r.n).join(' ; '), unused: unused.join(' ') });
}
fs.writeFileSync('C:/AIDA/_audit_scripts/mig/unif-status.json', JSON.stringify(out, null, 1));
for (const o of out) {
  if (o.error) { console.log('!!', o.label, o.error); continue; }
  console.log(`\n## ${o.label} [${o.dict || 'справочника нет'}] всего ${o.total}, пусто ${o.empty}`);
  console.log('  значения:', o.values);
  if (o.outside) console.log('  ВНЕ справочника:', o.outside, o.caseOnly ? `(сводится приведением: ${o.caseOnly})` : '');
  if (o.hard) console.log('  НЕ СВОДИТСЯ:', o.hard);
  if (o.unused) console.log('  в справочнике, но не встречается:', o.unused);
}
