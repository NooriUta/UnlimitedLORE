// Проверка 26-й редакции книги и страницы результата: ошибок нет, зелёная вкладка, решённое свёрнуто, скрины.
const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
const S = "C:/AIDA/_audit_scripts/decl/";
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", e => errs.push("book: " + e.message));
  await p.goto("file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html"); await p.waitForTimeout(600);
  console.log("счётчик:", await p.textContent("#cnt"));
  console.log("дельта на главной:", JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.page[data-page=main] .delta .kpi')].map(k => k.textContent.trim()))));
  await p.screenshot({ path: S + "v26-main.png" });
  await p.goto("file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html#/sprint/q"); await p.waitForTimeout(500);
  console.log("вкладки объекта:", JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.page[data-page=sprint] .tabs a')].map(a => a.textContent.trim() + (a.classList.contains("ok") ? " [зелёная]" : "")))));
  console.log("спринт: открытых", await p.evaluate(() => document.querySelectorAll('.page[data-page=sprint] .tab[data-tab=q] > .q').length), "свёрнуто решённых", await p.evaluate(() => document.querySelectorAll('.page[data-page=sprint] .tab[data-tab=q] details.dnd .dn').length));
  await p.screenshot({ path: S + "v26-sprint-q.png" });
  await p.goto("file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html#/sprint/t-KnowTask"); await p.waitForTimeout(500);
  console.log("задача: полей ввода текста на вкладке", await p.evaluate(() => document.querySelectorAll('.page[data-page=sprint] .tab[data-tab="t-KnowTask"] input.fx').length), "· строка status_raw:", await p.evaluate(() => { const c = [...document.querySelectorAll('.page[data-page=sprint] .tab[data-tab="t-KnowTask"] code.fname')].find(x => x.textContent === "status_raw"); return c ? c.closest("tr").textContent.replace(/\s+/g, " ").slice(0, 260) : "нет"; }));
  await p.screenshot({ path: S + "v26-task.png" });
  const ph = await b.newPage({ viewport: { width: 390, height: 800 } });
  ph.on("pageerror", e => errs.push("book-phone: " + e.message));
  await ph.goto("file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html#/sprint/q"); await ph.waitForTimeout(500);
  await ph.screenshot({ path: S + "v26-sprint-q-phone.png" });

  const r = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  r.on("pageerror", e => errs.push("result: " + e.message));
  await r.goto("file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-result.html"); await r.waitForTimeout(500);
  console.log("результат: вкладки", JSON.stringify(await r.evaluate(() => [...document.querySelectorAll(".nav a")].map(a => a.textContent))), "строк полей", await r.evaluate(() => document.querySelectorAll(".page:not([data-page=universal]) tbody tr").length), "паспортов", await r.evaluate(() => document.querySelectorAll(".wire").length));
  await r.screenshot({ path: S + "v26-result.png" });
  await r.evaluate(() => document.querySelector(".wire").scrollIntoView()); await r.waitForTimeout(200);
  await r.screenshot({ path: S + "v26-result-pass.png" });
  const rp = await b.newPage({ viewport: { width: 390, height: 800 } });
  await rp.goto("file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-result.html"); await rp.waitForTimeout(400);
  console.log("телефон: ширина страницы", await rp.evaluate(() => document.documentElement.scrollWidth));
  await rp.screenshot({ path: S + "v26-result-phone.png" });
  console.log("ERRORS", errs.length, errs.slice(0, 3).join(" | "));
  await b.close();
})();
