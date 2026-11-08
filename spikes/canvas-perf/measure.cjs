// SPRINT_UXR_S7C_WHY_CANVAS/S7C-07 — замер под мобильной эмуляцией.
// Запуск: npm run build, затем node measure.cjs [runs=2] (NS=100,500 — выбрать размеры)
// Edge (chromium channel msedge), 412×915 @2.6, touch, CPU throttling 4× (CDP).
const { chromium } = require('C:/AIDA/TestPlayGround/node_modules/playwright');
const fs = require('fs');
const path = require('path');

// dist/ отдаётся через page.route — без сетевого сервера (детерминированно, нет зависимости от порта).
const BASE = 'http://spike.local/';
const DIST = path.join(__dirname, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const RUNS = Number(process.argv[2] ?? 2);
const NS = (process.env.NS ?? '100,300,500,1000').split(',').map(Number);
const CONFIGS = [
  { key: 'base', label: 'без memo (inline nodeTypes)', q: 'memo=0' },
  { key: 'memo', label: 'memo nodeTypes', q: 'memo=1' },
  { key: 'memo+lod', label: 'memo + LOD<0.5', q: 'memo=1&lod=1' },
  { key: 'memo+lod+ovr', label: 'memo + LOD + onlyRenderVisible', q: 'memo=1&lod=1&ovr=1' },
];
const W = 412, H = 915;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// radius 1: у Chrome есть «подстройка касания» (touch adjustment) — палец радиусом 4px
// рядом с 12-пиксельным стикером (вид «весь холст») цепляет стикер, а не холст.
async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 1, radiusY: 1, force: 1 })),
  });
}

// Счётчик кадров + положительный контроль: в каждом кадре пишем вид, чтобы доказать, что жест двигал холст.
async function startFrames(page) {
  await page.evaluate(() => {
    const st = (window.__frames = { t: [], on: true, x0: null, dx: 0, zmin: Infinity, zmax: 0 });
    const tick = (ts) => {
      if (!st.on) return;
      st.t.push(ts);
      const v = window.__rf.getViewport();
      if (st.x0 == null) st.x0 = [v.x, v.y];
      st.dx = Math.max(st.dx, Math.hypot(v.x - st.x0[0], v.y - st.x0[1]));
      st.zmin = Math.min(st.zmin, v.zoom); st.zmax = Math.max(st.zmax, v.zoom);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
async function stopFrames(page) {
  return page.evaluate(() => {
    const st = window.__frames; st.on = false;
    const t = st.t; const d = [];
    for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
    d.sort((a, b) => a - b);
    const dur = t[t.length - 1] - t[0];
    return { fps: dur > 0 ? ((t.length - 1) * 1000) / dur : 0, p95: d[Math.floor(d.length * 0.95)] ?? 0, max: d[d.length - 1] ?? 0,
      moved: st.dx, zoomRatio: st.zmin > 0 ? st.zmax / st.zmin : 0 };
  });
}

// Пустое место холста: точка и её окрестность ±10px — только react-flow__pane.
// Для щипка нужны две такие точки на расстоянии 100px по горизонтали.
async function panePoint(page, pair) {
  return page.evaluate(([W, H, pair]) => {
    const isPane = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && el.classList.contains('react-flow__pane'); };
    const clean = (x, y) => [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10], [7, 7], [-7, -7], [7, -7], [-7, 7]].every(([a, b]) => isPane(x + a, y + b));
    for (let y = H * 0.45; y < H * 0.7; y += 3) for (let x = W * 0.3; x < W * 0.7; x += 3) {
      if (pair ? clean(x - 50, y) && clean(x + 50, y) : clean(x, y)) return [x, y];
    }
    return null;
  }, [W, H, !!pair]);
}

async function gesture(page, cdp, kind, ms = 3000) {
  const p = await panePoint(page, kind === 'pinch');
  if (!p) return { fps: null, p95: null, max: null, moved: 0, zoomRatio: 0, noPane: true };
  await startFrames(page);
  const t0 = Date.now();
  if (kind === 'pan') {
    const [x0, y0] = p;
    await touch(cdp, 'touchStart', [[x0, y0]]);
    while (Date.now() - t0 < ms) {
      const ph = ((Date.now() - t0) / 1000) * Math.PI * 2 * 0.5;
      await touch(cdp, 'touchMove', [[x0 + Math.sin(ph) * 120, y0 - Math.sin(ph * 0.7) * 200]]);
      await sleep(16);
    }
    await touch(cdp, 'touchEnd', []);
  } else {
    const [px, py] = p;
    await touch(cdp, 'touchStart', [[px - 50, py], [px + 50, py]]);
    while (Date.now() - t0 < ms) {
      const k = (Date.now() - t0) / ms; // 0..1: разводим и сводим пальцы
      const half = 50 + 150 * Math.sin(k * Math.PI);
      await touch(cdp, 'touchMove', [[px - half, py], [px + half, py]]);
      await sleep(16);
    }
    await touch(cdp, 'touchEnd', []);
  }
  await sleep(300);
  return stopFrames(page);
}

async function dragLatency(page, cdp) {
  const box = await page.evaluate(() => {
    const id = `s${Math.floor(document.querySelectorAll('.react-flow__node').length / 2)}`;
    const n = window.__rf.getNode(id) ?? window.__rf.getNodes()[0];
    window.__rf.setCenter(n.position.x + 80, n.position.y + 50, { zoom: 1 });
    return n.id;
  });
  await sleep(500);
  const r = await page.evaluate((id) => {
    const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
    const b = el.getBoundingClientRect();
    window.__perf.drag = [];
    return [b.x + b.width / 2, b.y + b.height / 2];
  }, box);
  let [x, y] = r;
  await touch(cdp, 'touchStart', [[x, y]]);
  for (let i = 0; i < 60; i++) {
    x += (i % 30 < 15 ? 4 : -4); y += 2;
    await touch(cdp, 'touchMove', [[x, y]]);
    await sleep(16);
  }
  await touch(cdp, 'touchEnd', []);
  await sleep(300);
  return page.evaluate(() => {
    const d = [...window.__perf.drag].sort((a, b) => a - b);
    return { samples: d.length, p50: d[Math.floor(d.length / 2)] ?? null, p95: d[Math.floor(d.length * 0.95)] ?? null };
  });
}

async function measureOne(browser, n, cfg) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
  await ctx.route('http://spike.local/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const f = path.join(DIST, p === '/' ? 'index.html' : p);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: MIME[path.extname(f)] ?? 'application/octet-stream', body: fs.readFileSync(f) });
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('HeapProfiler.enable');
  await page.goto(`${BASE}?n=${n}&${cfg.q}`);
  await page.waitForFunction(() => window.__perf && window.__perf.ready != null, null, { timeout: 120000 });
  const load = await page.evaluate(() => window.__perf.ready);
  await sleep(500);
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576;
  const domFit = await page.evaluate(() => document.querySelectorAll('.react-flow__node').length);
  const zoomFit = await page.evaluate(() => window.__rf.getZoom());
  const panFit = await gesture(page, cdp, 'pan');
  await page.evaluate(() => window.__rf.fitView());
  await sleep(300);
  const pinch = await gesture(page, cdp, 'pinch');
  const drag = await dragLatency(page, cdp); // оставляет вид на zoom 1
  const dom1 = await page.evaluate(() => document.querySelectorAll('.react-flow__node').length);
  const pan1 = await gesture(page, cdp, 'pan');
  await ctx.close();
  return {
    n, cfg: cfg.key, load: r1(load), heapMB: r1(heap), zoomFit: Math.round(zoomFit * 1000) / 1000, domFit, dom1,
    panFitFps: r1(panFit.fps), panFitP95: r1(panFit.p95), panFitMoved: Math.round(panFit.moved), pinchFps: r1(pinch.fps), pinchP95: r1(pinch.p95), pinchZoomX: r1(pinch.zoomRatio),
    pan1Fps: r1(pan1.fps), pan1P95: r1(pan1.p95), pan1Moved: Math.round(pan1.moved), dragP50: drag.p50 == null ? null : r1(drag.p50), dragP95: drag.p95 == null ? null : r1(drag.p95), dragSamples: drag.samples,
  };
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const out = [];
  for (let run = 1; run <= RUNS; run++) {
    for (const n of NS) for (const cfg of CONFIGS) {
      const res = { run, ...(await measureOne(browser, n, cfg)) };
      out.push(res);
      console.log(JSON.stringify(res));
    }
  }
  await browser.close();
  const dir = path.join(__dirname, 'results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ when: new Date().toISOString(), base: BASE, results: out }, null, 2));
  console.log('DONE');
})().catch((e) => { console.error(e); process.exit(1); });
