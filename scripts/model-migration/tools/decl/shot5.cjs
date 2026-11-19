const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const url = "file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html";
  const p = await b.newPage({ viewport: { width: 1500, height: 1100 } });
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(url + "#/sprint/t-KnowTask"); await p.waitForTimeout(700);
  await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/tab-sprint.png" });
  await p.evaluate(() => document.querySelector('.page[data-page=sprint] .tab:not([hidden]) table.ft').scrollIntoView()); await p.waitForTimeout(200);
  await p.click('.page[data-page=sprint] .tab:not([hidden]) table.ft .take');
  const v = await p.evaluate(() => { const i = document.querySelector('.page[data-page=sprint] .tab:not([hidden]) table.ft input.fx.filled'); return i ? i.dataset.fix + " = " + i.value : "нет"; });
  console.log("взять моё:", v);
  await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/tab-sprint-fields.png" });
  const n = await p.evaluate(() => ({ rm: document.querySelectorAll('.q[data-q^="поле · "]').length, lp: document.querySelectorAll('.lp').length, ch: document.querySelectorAll('input[data-fix^="характеристика"]').length }));
  console.log(JSON.stringify(n), "ERRORS", errs.length, errs.slice(0, 2).join(" | "));
  await b.close();
})();
