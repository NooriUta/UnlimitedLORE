// MIG-01: поля спринта, фазы и задачи на проде — объявленные в схеме и встречающиеся в записях, с числом заполненных. Только чтение.
const { execSync } = require("child_process");
const fs = require("fs");
const q = (sql) => JSON.parse(execSync("sh q.sh", { cwd: "C:/AIDA/_audit_scripts", input: JSON.stringify({ language: "sql", command: sql }), maxBuffer: 1 << 29, timeout: 300000 }).toString()).result;
const TYPES = ["KnowSprint", "KnowSprintHist", "KnowPhase", "KnowPhaseHist", "KnowTask", "KnowTaskHist"];
const schema = q("SELECT name, properties FROM schema:types WHERE name IN [" + TYPES.map(t => "'" + t + "'").join(",") + "]");
const out = {};
for (const t of TYPES) {
  const declared = {};
  const s = schema.find(x => x.name === t);
  for (const p of (s && s.properties) || []) declared[p.name] = p.type;
  const total = q("SELECT count(*) AS n FROM " + t)[0].n;
  // Заполненность считаем по всем записям постранично: только имена ключей и признак «не пусто».
  const filled = {};
  let seen = 0;
  for (let skip = 0; skip < total; skip += 4000) {
    const rows = q("SELECT FROM " + t + " SKIP " + skip + " LIMIT 4000");
    for (const r of rows) {
      seen++;
      for (const k of Object.keys(r)) {
        if (k.startsWith("@")) continue;
        const v = r[k];
        const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
        filled[k] = filled[k] || { filled: 0, present: 0 };
        filled[k].present++;
        if (!empty) filled[k].filled++;
      }
    }
  }
  const names = [...new Set([...Object.keys(declared), ...Object.keys(filled)])].sort();
  out[t] = { total, seen, fields: names.map(n => ({ name: n, declared: declared[n] || null, filled: (filled[n] || {}).filled || 0 })) };
  console.log(t, "записей", total, "прочитано", seen, "полей", names.length, "необъявленных", names.filter(n => !declared[n]).length);
}
fs.writeFileSync("C:/AIDA/_audit_scripts/mig/fields-sprint-phase-task.json", JSON.stringify(out, null, 1));
