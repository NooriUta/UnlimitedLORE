// Все текстовые и md-поля по типам с заполненностью (образец прода 14.11, md04/rows.json).
const fs = require("fs");
const raw = require("C:/AIDA/_audit_scripts/md04/rows.json");
const r = Array.isArray(raw) ? raw : Object.values(raw);
const re = /(_md|_md_ru|_md_en)$|^(description|summary|goal|note|body|text)$/;
const pick = hist => {
  const by = {};
  for (const x of r) {
    if (!x || !x.f || !re.test(x.f)) continue;
    if (/Hist$/.test(x.t) !== hist) continue;
    (by[x.t] = by[x.t] || []).push({ f: x.f, filled: x.filled, sample: x.sample, total: x.total });
  }
  return by;
};
const out = { vertex: pick(false), hist: pick(true) };
fs.writeFileSync("C:/AIDA/_audit_scripts/decl/md_fields.json", JSON.stringify(out, null, 1));
for (const [name, by] of Object.entries(out)) {
  console.log("--- " + name);
  for (const k of Object.keys(by).sort()) console.log(k + ": " + by[k].map(x => x.f + " " + x.filled + "/" + x.sample).join(" · "));
}
