// Сверка списка V91 первого захода: что можно объявлять сразу, что требует проверки.
const fs = require("fs");
const J = f => JSON.parse(fs.readFileSync(f, "utf8"));
const A = "C:/AIDA/_audit_scripts/";
const v = J(A + "decl/v91-candidates.json").filter(r => r.first);
const sample = J(A + "md04/sample.json"), schema = J(A + "schema.json"), rows = J(A + "md04/rows.json"), D = J(A + "decl/defs.json");
const WT = "C:/AIDA/UnlimitedLORE/.claude/worktrees/mdl-03-v91/backend/src/main/java/studio/seer/heimdall/lore/";
const files = fs.readdirSync(WT).filter(f => f.endsWith(".java"));
const src = Object.fromEntries(files.map(f => [f, fs.readFileSync(WT + f, "utf8")]));
const TECH = new Set(["state_uid", "content_hash", "source_commit", "updated_at", "created_at", "valid_from", "valid_to", "changed_by", "changed_by_kind"]);
const out = { A_code_declares: [], B_tech: [], C_copy_on_vertex: [], D_mixed: [], E_check: [] };
for (const r of v) {
  const [T, f] = r.k.split(".");
  const sc = (schema.vertex[T] || schema.edge[T] || { props: {} }).props || {};
  const sf = (sample.fields[T] || { fields: {} }).fields[f] || { filled: 0, types: {} };
  const tot = (sample.fields[T] || {}).sample || 0;
  const hist = sample.fields[T + "Hist"];
  const inHist = !!(hist && hist.fields[f] && hist.fields[f].filled > 0);
  const row = rows[r.k], def = D.defs[r.k];
  // объявление в коде develop: CREATE PROPERTY T.f или prop(T, f)
  const declRe = new RegExp("(PROPERTY\\s+" + T + "\\." + f + "\\b)|(\"" + T + "\"\\s*,\\s*\"" + f + "\")");
  const declNow = files.filter(x => /Schema/.test(x) && declRe.test(src[x]));
  // упоминания имени поля в файлах, где есть имя типа
  const re = new RegExp("\\b" + f + "\\b");
  const mention = files.filter(x => !/Schema/.test(x) && src[x].includes(T) && re.test(src[x])).length;
  const types = Object.keys(sf.types || {});
  const item = { k: r.k, ddl: r.ddl, fill: sf.filled + "/" + tot, why: r.why.slice(0, 2), declCode: !!sc[f] || declNow.length > 0, files: mention, writers: row && row.writers ? row.writers.length : null, def: def ? def[0] + "/" + def[3] : null };
  if (types.length > 1 && !(types.includes("int") && types.includes("float") && types.length === 2)) out.D_mixed.push(item);
  else if (item.declCode) out.A_code_declares.push(item);
  else if (TECH.has(f)) out.B_tech.push(item);
  else if (!T.endsWith("Hist") && inHist) out.C_copy_on_vertex.push(item);
  else out.E_check.push(item);
}
for (const [g, arr] of Object.entries(out)) {
  console.log("\n== " + g + " (" + arr.length + ")");
  for (const i of arr) console.log("  " + i.k + " " + i.ddl + " fill " + i.fill + " " + i.why + " files:" + i.files + " writers:" + i.writers + " def:" + i.def);
}
fs.writeFileSync(A + "decl/v91-verify.json", JSON.stringify(out, null, 1));
