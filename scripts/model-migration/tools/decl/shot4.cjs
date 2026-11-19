// Проверка схем: на каждой странице объекта схема нарисована (svg есть, ошибок нет), вкладки переключаются.
const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const url = "file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html";
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(url + "#/main"); await p.waitForTimeout(500);
  const ids = await p.evaluate(() => [...document.querySelectorAll(".page")].filter(x => x.querySelector(".er")).map(x => x.dataset.page));
  let ok = 0; const bad = [];
  for (const id of ids) {
    await p.goto(url + "#/" + id + "/er");
    try { await p.waitForFunction(i => { const e = document.querySelector('.page[data-page="' + i + '"] .er'); return e && (e.dataset.ok || e.querySelector(".erout.err")); }, id, { timeout: 60000 }); } catch (e) { bad.push(id + ": не дождались"); continue; }
    const r = await p.evaluate(i => { const e = document.querySelector('.page[data-page="' + i + '"] .er'); return { svg: e.querySelectorAll("svg").length, err: (e.querySelector(".erout.err") || {}).textContent || "", nodes: e.querySelectorAll("svg .node").length }; }, id);
    if (r.svg === 1 && !r.err) ok++; else bad.push(id + ": " + JSON.stringify(r).slice(0, 200));
    if (id === "sprint") { await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/er-sprint.png" }); console.log("sprint nodes", r.nodes); }
  }
  console.log("схем нарисовано", ok, "из", ids.length, bad.length ? "ПЛОХО: " + bad.join(" | ") : "");
  // вкладка типа
  await p.goto(url + "#/sprint/t-KnowTask"); await p.waitForTimeout(500);
  const t = await p.evaluate(() => ({ vis: [...document.querySelectorAll('.page[data-page=sprint] .tab')].filter(x => !x.hidden).map(x => x.dataset.tab), wire: document.querySelectorAll('.page[data-page=sprint] .tab:not([hidden]) .wire').length, rows: document.querySelectorAll('.page[data-page=sprint] .tab:not([hidden]) table.ft tbody tr').length, on: (document.querySelector('.page[data-page=sprint] .tabs a.on') || {}).textContent }));
  console.log("вкладка задачи", JSON.stringify(t));
  await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/tab-task.png" });
  const ph = await b.newPage({ viewport: { width: 400, height: 860 } });
  await ph.goto(url + "#/sprint/er"); await ph.waitForFunction(() => { const e = document.querySelector('.page[data-page="sprint"] .er'); return e && e.dataset.ok; }, null, { timeout: 60000 });
  await ph.screenshot({ path: "C:/AIDA/_audit_scripts/decl/er-sprint-phone.png" });
  console.log("телефон: ширина страницы не шире экрана:", await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  console.log("ERRORS", errs.length, errs.slice(0, 3).join(" || "));
  await b.close();
})();
