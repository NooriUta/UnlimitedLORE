// Проверка HTML «Новая модель против прода»: все блоки Mermaid отрисованы (svg = блокам), ошибок нет; скрины.
const path = require('path');
const { chromium } = require(path.join(process.argv[2], 'node_modules', 'playwright'));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 390, height: 900 } });
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file:///C:/AIDA/UnlimitedLORE/docs/reports/lore-model-v2-vs-prod-2026-11-17.html');
  await p.waitForFunction(() => document.body.dataset.rendered !== undefined, null, { timeout: 60000 }).catch(() => {});
  const r = await p.evaluate(() => ({ blocks: document.querySelectorAll('pre.mermaid').length, svg: document.querySelectorAll('pre.mermaid svg').length, syntax: document.body.innerText.includes('Syntax error'), nodes: [...document.querySelectorAll('pre.mermaid')].map(x => x.querySelectorAll('svg .node').length), width: document.documentElement.scrollWidth }));
  console.log(JSON.stringify(r));
  const h = await p.$$('pre.mermaid');
  if (h[0]) await h[0].screenshot({ path: 'C:/AIDA/_audit_scripts/mig/v2-schema-1.png' });
  if (h[5]) await h[5].screenshot({ path: 'C:/AIDA/_audit_scripts/mig/v2-schema-3.png' });
  console.log('ERRORS', errs.length, errs.slice(0, 3).join(' | ').slice(0, 400));
  await b.close();
})();
