// Проверка страницы результата с разделом «Новая схема — предложение»: ошибок нет, раздел на месте, скрин.
const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const r = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  r.on("pageerror", e => errs.push(e.message));
  await r.goto("file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-result.html"); await r.waitForTimeout(400);
  const h = await r.evaluate(() => { const x = [...document.querySelectorAll("h2")].find(e => e.textContent.startsWith("Новая схема")); if (x) x.scrollIntoView(); return { есть: !!x, заголовки: [...document.querySelectorAll(".page:not([hidden]) h2")].map(e => e.textContent), таблиц: document.querySelectorAll(".page:not([hidden]) table").length, допущений: x ? x.parentElement.querySelectorAll("ul.sub li").length : 0 }; });
  console.log(JSON.stringify(h));
  await r.waitForTimeout(200);
  await r.screenshot({ path: "C:/AIDA/_audit_scripts/decl/v27-schema.png" });
  const p = await b.newPage({ viewport: { width: 390, height: 800 } });
  await p.goto("file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-result.html"); await p.waitForTimeout(300);
  console.log("телефон: ширина страницы", await p.evaluate(() => document.documentElement.scrollWidth));
  console.log("ERRORS", errs.length, errs.slice(0, 2).join(" | "));
  await b.close();
})();
