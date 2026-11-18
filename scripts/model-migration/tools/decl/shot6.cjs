// Проверка кода схемы: показать, изменить, перерисовать, ошибка в коде видна, вернуть исходный.
const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const url = "file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html";
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on("pageerror", e => errs.push(e.message));
  const sel = '.page[data-page="sprint"] ';
  const wait = () => p.waitForFunction(s => { const e = document.querySelector(s + ".er"); return e && (e.dataset.ok || e.querySelector(".erout.err")); }, sel, { timeout: 60000 });
  const st = () => p.evaluate(s => { const e = document.querySelector(s + ".er"); return { svg: e.querySelectorAll("svg").length, nodes: e.querySelectorAll("svg .node").length, err: !!e.querySelector(".erout.err"), msg: document.querySelector(s + ".ermsg").textContent }; }, sel);
  await p.goto(url + "#/sprint/er"); await wait(); console.log("исходная", JSON.stringify(await st()));
  await p.click(sel + '[data-act=code]');
  const code = await p.inputValue(sel + ".ercode"); console.log("код:", code.split("\n").slice(0, 8).join(" ⏎ "));
  await p.fill(sel + ".ercode", code + '\n  n_extra["Проверка правки"]:::own\n  n_KnowTask --> n_extra');
  await p.click(sel + '[data-act=draw]'); await p.waitForTimeout(300); await wait(); console.log("после правки", JSON.stringify(await st()));
  await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/er-code.png" });
  await p.fill(sel + ".ercode", "flowchart TB\n  a --");
  await p.click(sel + '[data-act=draw]'); await p.waitForTimeout(300); await wait(); console.log("битый код", JSON.stringify(await st()));
  await p.click(sel + '[data-act=reset]'); await p.waitForTimeout(300); await wait(); console.log("вернули", JSON.stringify(await st()));
  console.log("ERRORS", errs.length, errs.slice(0, 2).join(" | "));
  await b.close();
})();
