// ---------- §2 на сетке: дни × проекты ----------
const MX_NS = [4, 6, 10];
function matrix(tz, N){
  const P = prepare(tz); const pg = VARIANTS[0].g;
  const act = new Map(); for (const e of P.E) for (const g of new Set(pg(e))) act.set(g, (act.get(g) || 0) + 1);
  const ranked = [...act.entries()].sort((a,b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(x => x[0]);
  const top = ranked.slice(0, N); const OTHER = 'прочие (' + Math.max(0, ranked.length - N) + ')';
  const cols = ranked.length > N ? top.concat([OTHER]) : top;
  const colOf = g => top.includes(g) ? g : OTHER;
  const days = [...new Set(P.E.map(e => dayOf(e, tz)))].sort();
  const cells = {}; const ck = (d, c) => d + '\u0001' + c;
  const rowEv = {}, rowEls = {}, rowG = {}, colEls = {}, colDays = {}, colEv = {};
  for (const e of P.E) {
    const d = dayOf(e, tz), k = elKey(e); const cs = [...new Set(pg(e).map(colOf))];
    rowEv[d] = (rowEv[d] || 0) + 1; (rowEls[d] = rowEls[d] || new Set()).add(k);
    const rg = (rowG[d] = rowG[d] || new Map()); if (!rg.has(k)) rg.set(k, new Set());
    for (const c of cs) {
      rg.get(k).add(c);
      const x = cells[ck(d, c)] = cells[ck(d, c)] || {ev:0, els:new Set(), events:[]}; x.ev++; x.els.add(k); x.events.push(e);
      colEv[c] = (colEv[c] || 0) + 1; (colEls[c] = colEls[c] || new Set()).add(k);
      const cd = (colDays[c] = colDays[c] || new Map()); if (!cd.has(k)) cd.set(k, new Set()); cd.get(k).add(d);
    }
  }
  const rows = days.map(d => {
    const cs = cols.map(c => { const x = cells[ck(d, c)]; return x ? {ev:x.ev, el:x.els.size} : {ev:0, el:0}; });
    let M = 0, extra = 0; for (const s of rowG[d].values()) { if (s.size >= 2) M++; extra += s.size - 1; }
    const sumEv = cs.reduce((s,x) => s + x.ev, 0), sumEl = cs.reduce((s,x) => s + x.el, 0);
    return {d, cs, ev:rowEv[d], el:rowEls[d].size, sumEv, sumEl, M, extra, maxEl:Math.max(...cs.map(x => x.el)), maxEv:Math.max(...cs.map(x => x.ev))};
  });
  const colT = cols.map((c, ci) => {
    let M = 0, extra = 0; for (const s of (colDays[c] || new Map()).values()) { if (s.size >= 2) M++; extra += s.size - 1; }
    const sumEl = rows.reduce((s,r) => s + r.cs[ci].el, 0), sumEv = rows.reduce((s,r) => s + r.cs[ci].ev, 0);
    return {c, ev:colEv[c] || 0, el:(colEls[c] || new Set()).size, sumEv, sumEl, M, extra};
  });
  const allEls = new Set(P.E.map(elKey));
  return {tz, N, cols, days, rows, colT, cells, ck, nProjects:ranked.length,
    grand:{ev:P.E.length, el:allEls.size, sumRowEv:rows.reduce((s,r) => s + r.ev, 0), sumRowEl:rows.reduce((s,r) => s + r.el, 0), sumColEl:colT.reduce((s,c) => s + c.el, 0)}};
}
function matrixPure(m){ return {cols:m.cols, rows:m.rows.map(r => [r.d, r.cs.map(x => x.ev + '/' + x.el).join(','), r.ev, r.el, r.sumEv, r.sumEl, r.M, r.extra]), colT:m.colT.map(c => [c.c, c.ev, c.el, c.sumEl, c.M, c.extra]), grand:m.grand}; }

// ---------- §7.2a: «готово к выкатке» ----------
function cat3(raw){
  if (raw == null) return null; const s = String(raw).trim(); const u = s.toUpperCase();
  if (u.startsWith('✅') || /^(DONE|CLOSED|MERGED|ЗАВЕРШ|ЗАКРЫТ)/.test(u) || u.startsWith('🚫') || /^(CANCEL|ОТМЕН)/.test(u)) return 'closed';
  if (s.startsWith('🚀') || /READY FOR DEPLOY/i.test(s)) return 'ready';
  return 'open';
}
const T1DAY = mskDay(new Date(Date.parse(T1) - 1).toISOString());
// релиз известен только датой: дата d засчитывается к моменту t, если d раньше дня t (по Москве), то есть к концу своего дня;
// к t1 засчитываются все релизы, уже записанные в LORE на момент выгрузки (дата ≤ дня t1)
const countedBy = (relDate, t) => t === T1 ? relDate <= T1DAY : relDate < mskDay(t);
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);
function episodes(TL){
  const eps = []; let cur = null;
  for (let i = 0; i < TL.length; i++) { const c = cat3(TL[i][1]);
    if (c === 'ready') { if (!cur) { cur = {start:TL[i][0], end:null}; eps.push(cur); } }
    else if (cur) { cur.end = TL[i][0]; cur = null; } }
  return eps;
}
const projOfSprint = sid => (D.sprints[sid] && D.sprints[sid].p && D.sprints[sid].p.length) ? D.sprints[sid].p : [NOPROJ];
function shipRecs(){
  const recs = [];
  for (const s of D.taskStates) { const TL = D.timelines[s.uid]; if (!TL) continue;
    recs.push({uid:s.uid, sid:s.sprint_id, TL, eps:episodes(TL), p:projOfSprint(s.sprint_id), snap:s.cur_status, kind:'touched'}); }
  for (const u of D.ship.untouchedReady) { const TL = u.timeline || [[u.last_vf, '🚀 READY FOR DEPLOY']];
    recs.push({uid:u.uid, sid:u.sprint_id, TL, eps:episodes(TL), p:projOfSprint(u.sprint_id), snap:TL[TL.length - 1][1], kind:'untouchedReady', approx:!u.timeline}); }
  return recs;
}
function linkInfo(sid){
  const sp = D.ship.sprints[sid];
  if (!sp || !sp.resolved.length) return {kind:'nolink', sp};
  return {kind: sp.unresolved.length ? 'partial' : 'ok', sp};
}
const firstQual = (sid, startIso) => { const sp = D.ship.sprints[sid]; if (!sp) return null; const dr = mskDay(startIso); return sp.resolved.find(r => r.date >= dr) || null; };
function evalAt(rec, t){
  let row = null; for (const r of rec.TL) { if (r[0] < t) row = r; else break; }
  if (!row) return {c:'absent', oldOpen:0, newOpen:0, y:0, yUnk:0};
  const c = cat3(row[1]);
  if (c !== 'ready') return {c, oldOpen:c === 'open' ? 1 : 0, newOpen:c === 'open' ? 1 : 0, y:0, yUnk:0};
  const ep = rec.eps.filter(e => e.start < t).slice(-1)[0];
  const r = firstQual(rec.sid, ep.start);
  if (r && countedBy(r.date, t)) return {c, rs:ep.start, oldOpen:1, newOpen:0, y:0, yUnk:0, ship:'shipped', r};
  const L = linkInfo(rec.sid); const unk = (L.kind !== 'ok' && !r) ? 1 : 0;
  return {c, rs:ep.start, oldOpen:1, newOpen:1, y:1, yUnk:unk, ship:unk ? 'unknown' : 'wait', next:r};
}
function shippedBy(rec, t){
  for (const ep of rec.eps) { if (!(ep.end == null || ep.end > T0) || !(ep.start < t)) continue;
    const r = firstQual(rec.sid, ep.start); if (r && countedBy(r.date, t)) return {ep, r}; }
  return null;
}
function dayBounds(tz){
  const off = tz === 'utc' ? 0 : 3*3600e3; const b = [T0]; const a0 = Date.parse(T0), a1 = Date.parse(T1);
  for (let d = Math.floor((a0 + off) / 86400e3) + 1; ; d++) { const t = d * 86400e3 - off; if (t >= a1) break; if (t > a0) b.push(new Date(t).toISOString()); }
  b.push(T1); return b;
}
function shipModel(tz){
  const recs = shipRecs(); const B = dayBounds(tz); const K = B.length;
  const mk = () => ({oO:new Array(K).fill(0), nO:new Array(K).fill(0), Y:new Array(K).fill(0), Yu:new Array(K).fill(0), S:new Array(K - 1).fill(0), C:0, A:0, oC:0, oA:0, unk:0, nTasks:0, exS:[], exY:[]});
  const G = new Map(); const grp = k => { let g = G.get(k); if (!g) G.set(k, g = mk()); return g; };
  const keysOf = (sid, p) => ['all', 's:' + sid, ...p.map(x => 'p:' + x)];
  // нетронутые: открытые постоянны на всех границах; готовые нетронутые вычтены — они идут поштучно
  const urBy = {}; for (const u of D.ship.untouchedReady) urBy[u.sprint_id] = (urBy[u.sprint_id] || 0) + 1;
  for (const u of D.untouchedBySprint) { const open = u.open - (urBy[u.sprint_id] || 0);
    for (const key of keysOf(u.sprint_id, projOfSprint(u.sprint_id))) { const g = grp(key); for (let k = 0; k < K; k++) { g.oO[k] += open; g.nO[k] += open; } g.unk += u.unknown; } }
  const per = []; const waits = []; const oldest = []; let enteredReady = 0, readyToClosedNoRel = 0;
  for (const rec of recs) {
    const st = B.map(t => evalAt(rec, t));
    if (st[K - 1].c === null) { for (const key of keysOf(rec.sid, rec.p)) grp(key).unk++; continue; }
    const sb = B.map(t => !!shippedBy(rec, t));
    const s0 = st[0], s1 = st[K - 1];
    const C = s0.newOpen === 1 && s1.newOpen === 0, A = s0.newOpen === 0 && s1.newOpen === 1;
    const oC = s0.oldOpen === 1 && s1.oldOpen === 0, oA = s0.oldOpen === 0 && s1.oldOpen === 1;
    const S = !sb[0] && sb[K - 1];
    for (const key of keysOf(rec.sid, rec.p)) { const g = grp(key); g.nTasks++;
      for (let k = 0; k < K; k++) { g.oO[k] += st[k].oldOpen; g.nO[k] += st[k].newOpen; g.Y[k] += st[k].y; g.Yu[k] += st[k].yUnk; }
      for (let k = 0; k < K - 1; k++) if (!sb[k] && sb[k + 1]) g.S[k]++;
      if (C) g.C++; if (A) g.A++; if (oC) g.oC++; if (oA) g.oA++;
      if (S && g.exS.length < 10) g.exS.push(rec.uid);
      if (s1.y && g.exY.length < 10) g.exY.push(rec.uid); }
    if (rec.eps.some(e => e.start >= T0 && e.start < T1)) enteredReady++;
    for (const ep of rec.eps) if (ep.end && ep.end >= T0 && ep.end < T1) { const nx = rec.TL.find(r => r[0] === ep.end); const r = firstQual(rec.sid, ep.start);
      if (nx && cat3(nx[1]) === 'closed' && !(r && r.date <= mskDay(ep.end))) readyToClosedNoRel++; }
    if (S) { const h = shippedBy(rec, T1); waits.push({uid:rec.uid, sid:rec.sid, ready:mskDay(h.ep.start), rel:h.r.uid, relDate:h.r.date, how:h.r.how, days:dayDiff(mskDay(h.ep.start), h.r.date), now:s1.c, closedBeforeRel:!!(h.ep.end && mskDay(h.ep.end) < h.r.date)}); }
    if (s1.y) oldest.push({uid:rec.uid, sid:rec.sid, since:s1.rs, age:(Date.parse(T1) - Date.parse(s1.rs)) / 86400e3, ship:s1.ship, link:linkInfo(rec.sid).kind,
      lastRel:(D.ship.sprints[rec.sid] && D.ship.sprints[rec.sid].resolved.slice(-1)[0]) || null, unres:(D.ship.sprints[rec.sid] && D.ship.sprints[rec.sid].unresolved.map(u => u.tag)) || []});
    per.push({uid:rec.uid, sid:rec.sid, s0:s0.c, s1:s1.c, sh0:s0.ship || null, sh1:s1.ship || null, snap:rec.snap});
  }
  waits.sort((a,b) => a.days - b.days || (a.uid < b.uid ? -1 : 1));
  const med = waits.length ? (waits.length % 2 ? waits[(waits.length - 1) / 2].days : (waits[waits.length / 2 - 1].days + waits[waits.length / 2].days) / 2) : null;
  oldest.sort((a,b) => b.age - a.age || (a.uid < b.uid ? -1 : 1));
  const labels = B.slice(0, -1).map((t, k) => { const d = tz === 'utc' ? t.slice(0,10) : mskDay(t); const hrs = (Date.parse(B[k + 1]) - Date.parse(t)) / 3600e3; return d + (hrs < 23.99 ? ` (${(Math.round(hrs * 10) / 10)} ч)` : ''); });
  return {tz, B, labels, G, waits, med, oldest, enteredReady, readyToClosedNoRel, per, nRecs:recs.length};
}
function shipPure(M){
  const g = k => { const x = M.G.get(k); return x ? [x.oO.join(','), x.nO.join(','), x.Y.join(','), x.Yu.join(','), x.S.join(','), x.C, x.A, x.oC, x.oA, x.unk] : null; };
  return {labels:M.labels, all:g('all'), proj:[...M.G.keys()].filter(k => k.startsWith('p:')).sort().map(k => [k, g(k)]), med:M.med,
    waits:M.waits.map(w => w.uid + ':' + w.days), oldest:M.oldest.slice(0, 15).map(o => o.uid), entered:M.enteredReady, r2c:M.readyToClosedNoRel};
}
