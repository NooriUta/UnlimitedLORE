const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch();
  const url = "file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html";
  const errs = [];
  for (const [name, vp, hash] of [["main-desk", { width: 1400, height: 900 }, "#/decisions"], ["sprint-desk", { width: 1400, height: 900 }, "#/milestone"], ["sprint-phone", { width: 400, height: 860 }, "#/sprint"], ["main-phone", { width: 400, height: 860 }, "#/main"]]) {
    const p = await b.newPage({ viewport: vp });
    p.on("pageerror", e => errs.push(name + ": " + e.message)); p.on("console", m => { if (m.type() === "error") errs.push(name + " console: " + m.text()); });
    await p.goto(url + hash); await p.waitForTimeout(800);
    const info = await p.evaluate(() => ({ visible: [...document.querySelectorAll(".page")].filter(x => !x.hidden).map(x => x.dataset.page), pages: document.querySelectorAll(".page").length, q: document.querySelectorAll(".q").length, cnt: document.getElementById("cnt").textContent, overflow: document.documentElement.scrollWidth > innerWidth + 2 }));
    console.log(name, JSON.stringify(info));
    await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/" + name + ".png" });
    if (name === "sprint-phone") { await p.click(".page:not([hidden]) .q label span"); await p.click("#copy"); console.log("after click", await p.evaluate(() => document.getElementById("cnt").textContent + " | " + document.getElementById("copyout").value.slice(0, 160))); }
    await p.close();
  }
  console.log("ERRORS", errs.length, errs.slice(0, 5).join(" || "));
  await b.close();
})();
