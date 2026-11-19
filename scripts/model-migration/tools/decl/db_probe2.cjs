// Чтение прода (только SELECT, q.sh): версии схемы по датам; название спринта против его кода; что привязано к проектам UDWE.
const { spawnSync } = require("child_process");
const fs = require("fs");
const A = "C:/AIDA/_audit_scripts/";
function q(sql) {
  const r = spawnSync("sh", [A + "q.sh"], { input: JSON.stringify({ language: "sql", command: sql }), encoding: "utf8", timeout: 120000 });
  if (r.status !== 0) return { error: "exit " + r.status + " " + String(r.stderr).slice(0, 200) };
  try { const j = JSON.parse(r.stdout); return j.result !== undefined ? { rows: j.result } : { error: JSON.stringify(j).slice(0, 300) }; } catch (e) { return { error: "не JSON: " + String(r.stdout).slice(0, 200) }; }
}
const one = x => x.rows ? (x.rows[0] ? x.rows[0].n : 0) : "ОШИБКА " + x.error;
const out = {};
out.control = q("SELECT count(*) AS n FROM KnowSprint");
out.schema = q("SELECT version, applied_at, compat_major FROM LoreSchemaVersion ORDER BY version");
out.sprintTotal = q("SELECT count(*) AS n FROM KnowSprint");
out.nameEqId = q("SELECT count(*) AS n FROM KnowSprint WHERE name = sprint_id");
out.nameStartsSprint = q("SELECT count(*) AS n FROM KnowSprint WHERE name LIKE 'SPRINT_%'");
out.nameNull = q("SELECT count(*) AS n FROM KnowSprint WHERE name IS NULL");
out.nameSample = q("SELECT sprint_id, name FROM KnowSprint WHERE name IS NOT NULL AND name <> sprint_id LIMIT 12");
out.nameSampleEq = q("SELECT sprint_id, name FROM KnowSprint WHERE name = sprint_id LIMIT 4");
out.taskTitleEqId = q("SELECT count(*) AS n FROM KnowTask WHERE title = task_id");
out.taskTitleNull = q("SELECT count(*) AS n FROM KnowTask WHERE title IS NULL");
out.adrNameEqId = q("SELECT count(*) AS n FROM KnowADR WHERE name = adr_id");
out.specTitleEqId = q("SELECT count(*) AS n FROM KnowSpec WHERE title = spec_id");
out.decTitleEqId = q("SELECT count(*) AS n FROM KnowDecision WHERE title = decision_id");
out.docTitleEqId = q("SELECT count(*) AS n FROM KnowDoc WHERE title = doc_id");
for (const p of ["ivanovalex32/UDWE", "AIDA/udwe-mig-gen"]) {
  out["udwe:" + p] = {
    belongs: q("SELECT @out.@type AS t, count(*) AS n FROM BELONGS_TO_PROJECT WHERE @in.slug = '" + p + "' GROUP BY @out.@type"),
    releases: q("SELECT count(*) AS n FROM KnowRelease WHERE git_project = '" + p + "'"),
    prs: q("SELECT count(*) AS n FROM KnowPR WHERE git_project = '" + p + "'"),
    roles: q("SELECT count(*) AS n FROM HAS_PROJECT_ROLE WHERE @in.slug = '" + p + "'"),
  };
}
fs.writeFileSync(A + "decl/db3.json", JSON.stringify(out, null, 1));
console.log("контроль спринтов:", one(out.control));
if (out.schema.rows) { const r = out.schema.rows; console.log("версий схемы:", r.length, "первая", JSON.stringify(r[0]), "последняя", JSON.stringify(r[r.length - 1])); for (const v of r) if ([1, 10, 13, 16, 17, 18, 20, 30, 34, 40, 50, 60, 70, 80, 85, 88, 91, 92].includes(v.version)) console.log("  V" + v.version + " " + String(v.applied_at).slice(0, 10) + " major " + v.compat_major); const sep = r.filter(v => String(v.applied_at) < "2026-10-01"); console.log("  последняя до 01.10.2026:", sep.length ? "V" + sep[sep.length - 1].version + " " + String(sep[sep.length - 1].applied_at).slice(0, 10) : "нет"); const s15 = r.filter(v => String(v.applied_at) < "2026-09-16"); console.log("  на 15.09.2026:", s15.length ? "V" + s15[s15.length - 1].version : "нет"); } else console.log("schema", out.schema.error);
console.log("спринт: всего", one(out.sprintTotal), "name = sprint_id:", one(out.nameEqId), "name начинается с SPRINT_:", one(out.nameStartsSprint), "name пусто:", one(out.nameNull));
console.log("примеры name ≠ id:", (out.nameSample.rows || []).slice(0, 8).map(r => r.sprint_id + " → " + String(r.name).slice(0, 70)).join(" || "));
console.log("название = код: задача", one(out.taskTitleEqId), "(пусто " + one(out.taskTitleNull) + ")", "ADR", one(out.adrNameEqId), "спека", one(out.specTitleEqId), "решение", one(out.decTitleEqId), "документ", one(out.docTitleEqId));
for (const p of ["ivanovalex32/UDWE", "AIDA/udwe-mig-gen"]) { const u = out["udwe:" + p]; console.log(p + ": привязано " + (u.belongs.rows ? u.belongs.rows.map(r => r.t + "×" + r.n).join(", ") || "ничего" : u.belongs.error) + "; релизов " + one(u.releases) + ", PR " + one(u.prs) + ", ролей " + one(u.roles)); }
