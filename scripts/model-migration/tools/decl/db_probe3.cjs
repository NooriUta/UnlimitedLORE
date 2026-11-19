// Чтение прода (только SELECT, q.sh): пары полей одного смысла внутри типа — заполненность, пересечение, совпадение значений.
const { spawnSync } = require("child_process");
const fs = require("fs");
const A = "C:/AIDA/_audit_scripts/";
function q(sql) {
  const r = spawnSync("sh", [A + "q.sh"], { input: JSON.stringify({ language: "sql", command: sql }), encoding: "utf8", timeout: 120000 });
  if (r.status !== 0) return { error: "exit " + r.status };
  try { const j = JSON.parse(r.stdout); return j.result !== undefined ? { rows: j.result } : { error: JSON.stringify(j).slice(0, 200) }; } catch (e) { return { error: "не JSON" }; }
}
const n = sql => { const x = q(sql); return x.rows ? (x.rows[0] ? x.rows[0].n : 0) : "ОШ:" + x.error; };
const PAIRS = [
  ["KnowSprint", "name", "sprint_id"], ["KnowSprint", "created_date", "date_created"], ["KnowSprint", "goal", "context_md"],
  ["KnowPhase", "name", "title"], ["KnowPhase", "phase_id", "phase_uid"],
  ["KnowTask", "summary_md", "note_md"], ["KnowTask", "task_id", "task_uid"],
  ["KnowADR", "date_created", "created_at"], ["KnowDecision", "date_created", "created_at"],
  ["KnowRelease", "release_id", "git_tag"], ["KnowRelease", "release_id", "version"], ["KnowRelease", "release_id", "release_name"], ["KnowRelease", "release_date", "released_at"],
  ["KnowMilestone", "label", "milestone_id"], ["KnowMilestone", "date_display", "week"],
  ["KnowQuestion", "opened_date", "created_at"], ["KnowQuestion", "owner", "raised_by"],
  ["KnowDoc", "content_md", "content_md_ru"], ["KnowDoc", "title", "doc_id"],
  ["LoreComponent", "name", "full_name"], ["LoreComponent", "name", "component_id"],
  ["KnowPR", "pr_id", "pr_uid"], ["KnowPR", "repo", "git_project"], ["KnowPR", "release_id", "pr_uid"],
  ["KnowGitProject", "slug", "full_name"], ["KnowGitProject", "name", "slug"],
  ["KnowUseCase", "uc_id", "feature_id"], ["KnowUseCase", "body_md", "scenario_md"],
  ["KnowSpec", "title", "summary"], ["KnowRunbook", "date_created", "created_at"],
];
const out = { at: new Date().toISOString(), control: n("SELECT count(*) AS n FROM KnowSprint"), pairs: [] };
for (const [T, a, b] of PAIRS) {
  const tot = n("SELECT count(*) AS n FROM " + T);
  const fa = n("SELECT count(*) AS n FROM " + T + " WHERE " + a + " IS NOT NULL");
  const fb = n("SELECT count(*) AS n FROM " + T + " WHERE " + b + " IS NOT NULL");
  const both = n("SELECT count(*) AS n FROM " + T + " WHERE " + a + " IS NOT NULL AND " + b + " IS NOT NULL");
  const eq = n("SELECT count(*) AS n FROM " + T + " WHERE " + a + " = " + b);
  const ex = q("SELECT " + a + " AS a, " + b + " AS b FROM " + T + " WHERE " + a + " IS NOT NULL AND " + b + " IS NOT NULL LIMIT 3");
  const item = { T, a, b, tot, fa, fb, both, eq, ex: (ex.rows || []).map(r => [String(r.a).slice(0, 50), String(r.b).slice(0, 50)]) };
  out.pairs.push(item);
  console.log(T + ": " + a + " (" + fa + ") / " + b + " (" + fb + ") из " + tot + " · оба " + both + " · равны " + eq + (item.ex[0] ? " · " + item.ex[0].join(" ↔ ") : ""));
}
fs.writeFileSync(A + "decl/db4.json", JSON.stringify(out, null, 1));
console.log("контроль спринтов:", out.control);
