// Чтение прода (только SELECT через /api/v1/query, скрипт q.sh; разрешение владелицы 15.11.2026).
// 1) что лежит в полях статуса; 2) есть ли в полях-кодах текст для показа (пробел или кириллица).
const { spawnSync } = require("child_process");
const fs = require("fs");
const A = "C:/AIDA/_audit_scripts/";
function q(sql) {
  const r = spawnSync("sh", [A + "q.sh"], { input: JSON.stringify({ language: "sql", command: sql }), encoding: "utf8", timeout: 120000 });
  if (r.status !== 0) return { error: "exit " + r.status + " " + String(r.stderr).slice(0, 200) };
  try { const j = JSON.parse(r.stdout); return j.result !== undefined ? { rows: j.result } : { error: JSON.stringify(j).slice(0, 300) }; } catch (e) { return { error: "не JSON: " + String(r.stdout).slice(0, 200) }; }
}
const out = { at: new Date().toISOString(), status: {}, ids: {}, control: null };
// положительный контроль: запрос, ответ на который известен из образца
out.control = q("SELECT count(*) AS n FROM KnowPhase");
const STATUS = [["KnowPhaseHist", "status_raw"], ["KnowPhase", "status_raw"], ["KnowSprintHist", "status_raw"], ["KnowSprint", "status_raw"], ["KnowTaskHist", "status_raw"], ["KnowTask", "status_raw"], ["KnowADRHist", "status_raw"], ["KnowADR", "status"], ["KnowDecision", "status_raw"], ["KnowDecisionHist", "status_raw"], ["KnowSpecHist", "status_raw"], ["KnowSpec", "status"], ["KnowMilestoneHist", "status_raw"], ["KnowQuestion", "status"], ["KnowUseCase", "status"], ["KnowSprintHist", "priority"], ["KnowSprint", "priority"], ["KnowMilestone", "priority"], ["KnowQuestion", "priority"]];
for (const [T, f] of STATUS) out.status[T + "." + f] = q("SELECT " + f + " AS v, count(*) AS n FROM " + T + " GROUP BY " + f + " ORDER BY n DESC LIMIT 80");
const IDS = [["KnowPhase", "phase_id"], ["KnowPhase", "phase_uid"], ["KnowTask", "task_id"], ["KnowTask", "task_uid"], ["KnowSprint", "sprint_id"], ["KnowADR", "adr_id"], ["KnowDecision", "decision_id"], ["KnowSpec", "spec_id"], ["KnowDoc", "doc_id"], ["KnowQuestion", "question_id"], ["KnowMilestone", "milestone_id"], ["KnowRelease", "release_id"], ["KnowRelease", "release_uid"], ["LoreComponent", "component_id"], ["LoreComponent", "parent_id"], ["KnowUseCase", "uc_id"], ["KnowUseCase", "feature_id"], ["KnowRunbook", "runbook_id"], ["KnowSprint", "plan_id"], ["KnowSprintHist", "track_id"], ["KnowPR", "pr_uid"], ["KnowPR", "pr_id"], ["KnowProjectActor", "actor_id"], ["KnowPain", "pain_id"], ["KnowGain", "gain_id"], ["KnowJob", "job_id"]];
for (const [T, f] of IDS) {
  const tot = q("SELECT count(*) AS n FROM " + T + " WHERE " + f + " IS NOT NULL");
  const sp = q("SELECT count(*) AS n FROM " + T + " WHERE " + f + " LIKE '% %'");
  const ex = q("SELECT " + f + " AS v FROM " + T + " WHERE " + f + " LIKE '% %' LIMIT 4");
  out.ids[T + "." + f] = { filled: tot, withSpace: sp, examples: ex };
}
fs.writeFileSync(A + "decl/db2.json", JSON.stringify(out, null, 1));
const n = x => x.rows ? x.rows[0].n : "ОШИБКА " + x.error;
console.log("контроль KnowPhase:", n(out.control));
for (const [k, v] of Object.entries(out.status)) console.log("STATUS " + k + ": " + (v.rows ? v.rows.length + " значений; " + v.rows.slice(0, 14).map(r => JSON.stringify(r.v) + "×" + r.n).join(", ") : "ОШИБКА " + v.error));
for (const [k, v] of Object.entries(out.ids)) console.log("ID " + k + ": заполнено " + n(v.filled) + ", с пробелом " + n(v.withSpace) + (v.examples.rows && v.examples.rows.length ? " — " + v.examples.rows.map(r => JSON.stringify(r.v)).join(", ").slice(0, 160) : ""));
