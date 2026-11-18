const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const url = "file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html";
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(url + "#/sprint"); await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector(".page:not([hidden]) table.ft").scrollIntoView()); await p.waitForTimeout(200);
  await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/tbl.png" });
  await p.evaluate(() => document.querySelector(".page:not([hidden]) .pass").scrollIntoView()); await p.waitForTimeout(200);
  await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/pass.png" });
  await p.goto(url + "#/main"); await p.waitForTimeout(400);
  await p.evaluate(() => [...document.querySelectorAll(".page:not([hidden]) h2")].find(h => /Разбор по данным/.test(h.textContent)).scrollIntoView()); await p.waitForTimeout(200);
  await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/main2.png" });
  console.log("ERRORS", errs.length); await b.close();
})();
