// Печатает markdown-таблицу из results/results.json (оба прогона в ячейке: «прогон1 / прогон2»).
// Положительный контроль жестов: «сдвиг» (px, насколько реально уехал вид при панораме)
// и «×зум» (во сколько раз менялся масштаб при щипке). 0 = жест не сработал, fps в такой ячейке не значит ничего.
const fs = require('fs');
const path = require('path');
const { results } = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'results.json'), 'utf8'));
const key = (r) => `${r.n}|${r.cfg}`;
const groups = new Map();
for (const r of results) { if (!groups.has(key(r))) groups.set(key(r), []); groups.get(key(r)).push(r); }
const pair = (rs, f) => rs.map((r) => (f(r) ?? '—')).join(' / ');
const gest = (fps, p95, ctl, ok) => (ok ? `${Math.round(fps)} fps, p95 ${p95} мс (${ctl})` : `не сработал (${ctl})`);
console.log('| N | вариант | загрузка, мс | куча, МБ | DOM fit / z1 | панорама «весь холст» | щипок | панорама z=1 | drag p50/p95, мс |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const rs of groups.values()) {
  const r0 = rs[0];
  console.log(`| ${r0.n} | ${r0.cfg} | ${pair(rs, (r) => Math.round(r.load))} | ${pair(rs, (r) => r.heapMB)} | ${r0.domFit} / ${r0.dom1} | `
    + `${pair(rs, (r) => gest(r.panFitFps, r.panFitP95, `${r.panFitMoved}px`, r.panFitMoved > 0))} | `
    + `${pair(rs, (r) => gest(r.pinchFps, r.pinchP95, `×${r.pinchZoomX}`, r.pinchZoomX > 1.01))} | `
    + `${pair(rs, (r) => gest(r.pan1Fps, r.pan1P95, `${r.pan1Moved}px`, r.pan1Moved > 0))} | `
    + `${pair(rs, (r) => (r.dragSamples ? `${r.dragP50}/${r.dragP95}` : 'не сработал'))} |`);
}
