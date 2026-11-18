// Проверка: вкладка, где все вопросы отвечены, уходит в конец ряда (перед справочными).
const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const url = "file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html";
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(url); await p.waitForTimeout(500);
  const nav = () => p.evaluate(() => [...document.querySelectorAll(".nav a")].map(a => a.textContent.trim() + (a.classList.contains("closed") ? " [закрыта]" : "")));
  console.log("до:", JSON.stringify(await nav()));
  // Отвечаем на все вопросы страницы «Дубли» через её же элементы управления и перезагружаем.
  await p.evaluate(() => { document.querySelectorAll('.page[data-page="dups"] .q').forEach(q => { const r = q.querySelector("input[type=radio]"); if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); } }); });
  console.log("сразу после ответов (ряд не прыгает):", JSON.stringify((await nav()).slice(0, 3)));
  await p.reload(); await p.waitForTimeout(500);
  const after = await nav();
  console.log("после перезагрузки:", JSON.stringify(after));
  await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/v25-nav.png", clip: { x: 0, y: 0, width: 1400, height: 90 } });
  await p.evaluate(() => localStorage.clear());
  console.log("ERRORS", errs.length, errs.slice(0, 2).join(" | "));
  await b.close();
})();
