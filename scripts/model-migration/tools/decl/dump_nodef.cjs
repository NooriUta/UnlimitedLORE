// Печатает поля без определения (кроме служебных и легаси): ключ | название | вид | пример.
const fs = require("fs");
const A = "C:/AIDA/_audit_scripts/decl/";
let s = fs.readFileSync(A + "build.cjs", "utf8");
const hook = 'fs.writeFileSync(OUT, html, "utf8");';
if (!s.includes(hook)) throw new Error("hook");
const add = `
const ND = [];
const seenND = new Set();
const visitND = (ti, page) => { for (const r of ti.fields) { if (r.layer === "legacy" || r.service || r.tx.def || seenND.has(r.k)) continue; seenND.add(r.k); ND.push(page + " | " + r.k + " | " + (r.tx.name ? r.tx.name[0] : "") + " | " + r.kind + " | " + String(r.ex[0] ?? "").replace(/\\s+/g, " ").slice(0, 28)); } };
for (const q of PAGES) for (const ti of mergeHist(q.db)) visitND(ti, q.id);
for (const e of Object.keys(dba.ends)) visitND(typeInfo(e), "edge");
fs.writeFileSync("${A}nodef.txt", ND.join(String.fromCharCode(10)));
console.log("nodef", ND.length);
`;
fs.writeFileSync(A + "build_dump2.cjs", s.replace(hook, "/* dump only */" + add));
