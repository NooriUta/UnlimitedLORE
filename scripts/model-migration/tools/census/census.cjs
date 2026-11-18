// MIG-01, шаг ноль: перепись базы «до» — число записей каждого типа и каждой связи. Только чтение.
// Запуск: node census.cjs [имя_файла_результата]. Ходит на прод тем же путём, что q.sh (SELECT через /api/v1/query).
const { execSync } = require("child_process");
const fs = require("fs");
const q = (sql) => {
  const out = execSync("sh q.sh", { cwd: "C:/AIDA/_audit_scripts", input: JSON.stringify({ language: "sql", command: sql }), maxBuffer: 1 << 28, timeout: 180000 }).toString();
  const j = JSON.parse(out);
  if (!j.result) throw new Error("нет result: " + out.slice(0, 300));
  return j.result;
};
const types = q("SELECT name, type, records, parentTypes, properties.size() AS props FROM schema:types");
const rows = types.map(t => ({ name: t.name, kind: t.type, records: t.records, parents: t.parentTypes || [], props: t.props }))
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
const sum = k => rows.filter(r => r.kind === k).reduce((s, r) => s + (r.records || 0), 0);
const res = {
  taken_at: new Date().toISOString(),
  database: "system_aida_lore",
  totals: { vertex_types: rows.filter(r => r.kind === "vertex").length, edge_types: rows.filter(r => r.kind === "edge").length, document_types: rows.filter(r => r.kind === "document").length, vertices: sum("vertex"), edges: sum("edge"), documents: sum("document") },
  types: rows,
};
// Положительный контроль: число из schema:types обязано совпасть с прямым подсчётом по одному типу.
const ctl = q("SELECT count(*) AS n FROM KnowSprint")[0].n;
const fromSchema = (rows.find(r => r.name === "KnowSprint") || {}).records;
res.control = { type: "KnowSprint", count: ctl, schema_records: fromSchema, match: ctl === fromSchema };
const out = process.argv[2] || "C:/AIDA/_audit_scripts/mig/census-before.json";
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res.totals), "control", JSON.stringify(res.control));
console.log("пустых типов:", rows.filter(r => !r.records).length, "из", rows.length);
