const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const url = "file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html";
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(url + "#/dups"); await p.waitForTimeout(600);
  console.log("дубли:", JSON.stringify(await p.evaluate(() => { const s = document.querySelector('.page[data-page=dups]'); return { vis: !s.hidden, rows: s.querySelectorAll("tbody tr").length, ctl: s.querySelectorAll(".q").length }; })));
  await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/v17-dups.png" });
  await p.goto(url + "#/main"); await p.waitForTimeout(400);
  console.log("первая:", JSON.stringify(await p.evaluate(() => ({ q: document.querySelectorAll('.page[data-page=main] .q').length, ids: [...document.querySelectorAll('.page[data-page=main] .q')].map(x => x.dataset.q), checked: document.querySelectorAll('.page[data-page=main] input:checked').length }))));
  await p.goto(url + "#/places"); await p.waitForTimeout(400);
  console.log("паспорта:", await p.evaluate(() => document.querySelectorAll('.page[data-page=places] .wire').length));
  console.log("ERRORS", errs.length, errs.slice(0, 2).join(" | "));
  await b.close();
})();
