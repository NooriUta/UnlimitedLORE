// Проверка схемы «Как это работает вместе: LORE и miniLORE» на сводной странице мест и людей: svg отрисован, ошибок нет, скрин.
const path = require("path");
const { chromium } = require(path.join(process.argv[2], "node_modules", "playwright"));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const r = await b.newPage({ viewport: { width: 1400, height: 1100 } });
  r.on("pageerror", e => errs.push(e.message));
  r.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await r.goto("file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-declaration-2026-11-15.html#/places");
  await r.waitForTimeout(1500); await r.evaluate(() => { const pg = document.querySelector('section.page[data-page="places"]'); const x = [...pg.querySelectorAll("h2")].find(e => e.textContent.startsWith("Как это работает вместе")); x && x.scrollIntoView(); }); await r.waitForTimeout(8000);
  const h = await r.evaluate(() => {
    const pg = document.querySelector('section.page[data-page="places"]');
    const x = [...pg.querySelectorAll("h2")].find(e => e.textContent.startsWith("Как это работает вместе"));
    let block = x; while (block && !(block.classList && block.classList.contains("erw"))) block = block.nextElementSibling;
    if (x) x.scrollIntoView();
    return { видна: !pg.hidden, заголовок: !!x, svgНаСтранице: pg.querySelectorAll("svg").length, mermaidБлоков: pg.querySelectorAll(".mermaid, pre.mermaid, [data-mmd]").length,
      svgВБлоке: block ? block.querySelectorAll("svg").length : -1, узлы: block ? [...block.querySelectorAll("svg .node")].length : -1, ошибкаMermaid: pg.innerText.includes("Syntax error"), сообщение: block ? block.querySelector(".erout").innerText.slice(0,120) : "" };
  });
  console.log(JSON.stringify(h));
  await r.waitForTimeout(300);
  await r.screenshot({ path: "C:/AIDA/_audit_scripts/decl/v28-together.png" });
  console.log("ERRORS", errs.length, errs.slice(0, 3).join(" | "));
  await b.close();
})();
