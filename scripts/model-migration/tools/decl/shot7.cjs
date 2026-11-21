// Проверка шестнадцатой редакции: порядок вкладок, первая страница с вопросами, схема на «Проекты и рабочие места».
const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const url = "file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html";
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(url); await p.waitForTimeout(600);
  const nav = await p.evaluate(() => [...document.querySelectorAll(".nav a")].map(a => a.textContent));
  console.log("вкладки:", nav.slice(0, 3).join(" | "), "…", nav.slice(-3).join(" | "), "всего", nav.length);
  const main = await p.evaluate(() => ({ vis: [...document.querySelectorAll(".page")].filter(x => !x.hidden).map(x => x.dataset.page), q: document.querySelectorAll('.page[data-page=main] .q').length, h1: document.querySelector('.page[data-page=main] h1').textContent }));
  console.log("первая:", JSON.stringify(main));
  await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/v16-main.png" });
  await p.goto(url + "#/places");
  await p.waitForFunction(() => { const e = document.querySelector('.page[data-page="places"] .er'); return e && (e.dataset.ok || e.querySelector(".erout.err")); }, null, { timeout: 60000 });
  const pl = await p.evaluate(() => { const e = document.querySelector('.page[data-page="places"] .er'); return { svg: e.querySelectorAll("svg").length, nodes: e.querySelectorAll("svg .node").length, err: (e.querySelector(".erout.err") || {}).textContent || "" }; });
  console.log("схема рабочих мест:", JSON.stringify(pl));
  await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/v16-places.png" });
  for (const id of ["rules", "decisions", "log"]) { await p.goto(url + "#/" + id); await p.waitForTimeout(300); console.log(id + ":", await p.evaluate(i => { const s = document.querySelector('.page[data-page="' + i + '"]'); return s && !s.hidden ? s.querySelector("h1").textContent + " · разделов " + s.querySelectorAll("h2").length : "НЕТ"; }, id)); }
  const ph = await b.newPage({ viewport: { width: 400, height: 860 } });
  await ph.goto(url); await ph.waitForTimeout(500);
  console.log("телефон: не шире экрана:", await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await ph.screenshot({ path: "C:/AIDA/_audit_scripts/decl/v16-main-phone.png" });
  console.log("ERRORS", errs.length, errs.slice(0, 3).join(" || "));
  await b.close();
})();
