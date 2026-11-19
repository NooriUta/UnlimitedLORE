// Печатает уникальные имена полей без названия или краткого названия (кроме легаси и служебных).
const fs = require("fs");
const A = "C:/AIDA/_audit_scripts/decl/";
let s = fs.readFileSync(A + "build.cjs", "utf8");
const hook = 'fs.writeFileSync(OUT, html, "utf8");';
if (!s.includes(hook)) throw new Error("hook");
const add = `
const NN = {};
const visit = (T, short) => { for (const r of typeInfo(T).fields) { if (r.layer === "legacy" || r.service) continue; if (!r.tx.name || !r.tx.short) { const e = (NN[r.f] = NN[r.f] || { t: [], d: "", n: r.tx.name ? r.tx.name[0] : "", ex: "" }); e.t.push(short); if (!e.d && r.tx.def) e.d = r.tx.def[0].slice(0, 80); if (!e.ex && r.ex.length) e.ex = String(r.ex[0]).slice(0, 24); } } };
for (const p of PAGES) for (const T of p.db) visit(T, T.replace(/^Know|^Lore/, ""));
for (const e of Object.keys(dba.ends)) visit(e, e);
fs.writeFileSync("${A}noname.txt", Object.entries(NN).sort().map(([f, v]) => f + " | " + (v.n || "") + " | " + [...new Set(v.t)].slice(0, 3).join(",") + (new Set(v.t).size > 3 ? "+" + (new Set(v.t).size - 3) : "") + " | " + v.d + " | " + v.ex).join(String.fromCharCode(10)));
console.log("unique", Object.keys(NN).length);
`;
fs.writeFileSync(A + "build_dump.cjs", s.replace(hook, "/* dump only */" + add));
