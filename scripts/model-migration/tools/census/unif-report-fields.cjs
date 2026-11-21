// Дописывает в отчёт раздел «Поля по объектам: что не проверено владелицей».
const fs = require('fs');
const f = 'C:/AIDA/UnlimitedLORE/docs/reports/lore-unification-blockers-2026-11-16.html';
const m = JSON.parse(fs.readFileSync('C:/AIDA/_audit_scripts/mig/unif-model-develop.json', 'utf8'));
let s = fs.readFileSync(f, 'utf8');
const mark = '<h2 id="fields">';
if (s.includes(mark)) s = s.slice(0, s.indexOf(mark)) + s.slice(s.indexOf('<footer>'));
const b = s.indexOf('<footer>');
const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pr2 = new Set(['adr', 'decision', 'spec', 'doc']); // PR #1545 — определения написаны, не влиты
let total = 0, withDef = 0, inPr = 0;
let rows = '';
for (const t of m.types) {
  const fields = t.fields || [];
  const d = fields.filter(x => x.definition).length;
  total += fields.length; withDef += d;
  const chips = fields.map(x => {
    const cls = x.definition ? 'wrn' : (pr2.has(t.type) ? 'inf' : 'dng');
    return `<span class="chip ${cls}">${esc(x.label)}${x.dict ? ' ▾' : ''}</span>`;
  }).join(' ');
  rows += `<tr><td><b>${esc(t.label)}</b></td><td class="n">${fields.length}</td><td class="n">${d}</td><td style="line-height:2">${chips}</td></tr>\n`;
}
inPr = 37;
const part = `<h2 id="fields">Поля по объектам: что вами не проверено</h2>
<div class="lead">
<b>Отметки «проверено владелицей» в модели нет</b> — ни у одного поля. Поэтому непроверенными считаются все ${total} полей у ${m.types.length} объектов. Ниже — полный список и то, что по каждому полю уже подготовлено к вашей проверке.
</div>
<div class="grid">
  <div class="tile"><b>${total}</b><span>полей всего, проверенных — 0</span></div>
  <div class="tile"><b>${withDef}</b><span>с определением в модели (спринт, задача) — ждут проверки</span></div>
  <div class="tile"><b>${inPr}</b><span>определение написано, но не влито: вы сказали «стоп»</span></div>
  <div class="tile"><b>${total - withDef - inPr}</b><span>определения нет</span></div>
</div>
<p class="sub"><span class="chip wrn">жёлтое</span> определение есть, ждёт вашей проверки · <span class="chip inf">синее</span> определение написано, лежит невлитым · <span class="chip dng">красное</span> определения нет · ▾ значение из справочника</p>
<div class="wrap"><table>
<tr><th>Объект</th><th>Полей</th><th>С определением</th><th>Поля</th></tr>
${rows}</table></div>
<p><b>Предложение.</b> Завести у поля отметку «проверено: кем и когда» и ставить её на экране модели. Тогда этот список станет счётчиком в админке, а не отчётом. Отметка — настройка модели, схему базы не меняет.</p>

`;
s = s.slice(0, b) + part + s.slice(b);
fs.writeFileSync(f, s);
console.log('ok', total, withDef, m.types.length);
