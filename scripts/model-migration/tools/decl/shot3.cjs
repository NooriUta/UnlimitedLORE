// Проверка листа ответов: с доступом к буферу и без него (как во встроенном просмотрщике).
const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch();
  const url = "file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html#/main";
  for (const mode of ["normal", "no-clipboard"]) {
    const ctx = await b.newContext({ viewport: { width: 400, height: 860 } });
    const p = await ctx.newPage(); const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    if (mode === "no-clipboard") await p.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      document.execCommand = () => false;
    });
    await p.goto(url); await p.waitForTimeout(500);
    await p.click(".page:not([hidden]) .q label span");
    await p.fill(".page:not([hidden]) .q .qn", "проверка");
    await p.click("#copy"); await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({ sheet: !document.getElementById("sheet").hidden, msg: document.getElementById("cst").textContent, text: document.getElementById("copyout").value.slice(0, 120), sel: document.getElementById("copyout").selectionEnd - document.getElementById("copyout").selectionStart, len: document.getElementById("copyout").value.length }));
    console.log(mode, JSON.stringify(r), "errors:", errs.length);
    await p.screenshot({ path: "C:/AIDA/_audit_scripts/decl/sheet-" + mode + ".png" });
    await ctx.close();
  }
  await b.close();
})();
