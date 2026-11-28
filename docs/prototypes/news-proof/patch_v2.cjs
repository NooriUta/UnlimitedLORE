// Собирает page.tpl.html v2 из page.v1.tpl.html + js_v2_*.js (идемпотентно: всегда от v1)
const fs = require('fs'); const W = __dirname;
let s = fs.readFileSync(W + '/page.v1.tpl.html', 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 80)); s = s.replace(a, () => b); };
if (!s.includes('function matrix(tz, N)')) {
  rep('SPEC-LORE-UXR-NEWS-ALGORITHMS v0.5.0', 'SPEC-LORE-UXR-NEWS-ALGORITHMS v0.6.0 (§7.2a «готово к выкатке»)');
  rep('@media (max-width:480px)', `.mx{border-collapse:separate;border-spacing:0;width:auto;min-width:100%}
.mx th,.mx td{white-space:nowrap}
.mx th:first-child,.mx td:first-child{position:sticky;left:0;z-index:2;background:var(--bg2);border-right:1px solid var(--bd)}
.mx th{z-index:1}.mx th:first-child{z-index:3}
.mx td.cell{cursor:pointer;text-align:right;font-family:var(--mono)}
.mx td.cell:hover{background:#fbf3e3}.mx td.cell.sel{background:#f6e7c8}
.mx td.zero{color:var(--t3);cursor:default}
.mx tr.tot td{background:var(--bg3)}
.mx td.tc{background:var(--bg3);font-weight:700}
.mk{display:inline-block;margin-left:3px;padding:0 5px;border-radius:999px;background:#fff3e0;border:1px solid #f0d3a4;color:var(--wrn);font-size:var(--fs-2xs);font-family:var(--mono)}
.yel{color:var(--wrn)}.kpi .v.yel{color:var(--wrn)}
.kpi.ylw{border-color:#f0d3a4;background:#fff8ec}
td.old{color:var(--t3)}
@media (max-width:480px)`);
  rep(`<div class="card">
<h2>3. Сгорание задач спринтов (§7.2)</h2>`, `<div class="card" id="mxCard">
<h2>2а. Дни × проекты</h2>
<div class="look"><b>На что вы смотрите.</b> Строка — день, столбец — проект (самые активные за неделю, остальные слиты в «прочие»). В клетке пара «событий · элементов» за этот день в этом проекте. Итог строки и итог столбца — это <b>объединение</b>, а не сумма клеток: задача общего спринта двух репозиториев стоит в обеих клетках, но в итоге дня считается один раз. Если сумма клеток не равна итогу, рядом стоит оранжевая метка <span class="mk">Σ≠∪</span>, а $M$ — сколько элементов попали в две клетки и больше. У столбца то же по дням: элемент с событиями в разные дни в итоге столбца считается один раз. Нажмите на клетку — ниже появятся её события. На телефоне таблица прокручивается вбок, столбец с днями стоит на месте.</div>
<div class="row"><span class="sub">День:</span><button class="pill tzb on" data-tz="msk">Москва</button><button class="pill tzb" data-tz="utc">UTC</button><span class="sub" style="margin-left:8px">Столбцов:</span><span id="mxN"></span></div>
<div id="mxBlock"></div>
<div id="mxEvents"></div>
</div>

<div class="card">
<h2>3. Сгорание задач спринтов (§7.2)</h2>`);
  rep(`<div id="burnBlock"></div>
</div>`, `<div id="burnBlock"></div>
</div>

<div class="card" id="shipCard">
<h2>3а. «Готово к выкатке» и сгорание по новому правилу (§7.2a)</h2>
<div class="look"><b>На что вы смотрите.</b> Задача в статусе 🚀 READY FOR DEPLOY больше не считается автоматически ни открытой, ни закрытой. Она <b>жёлтая</b>: почти сделана, но для сгорания закрывается только когда доехала до релиза. «Доехала» значит: у её спринта есть связанный релиз (release_sprints), выпущенный в день готовности или позже и не позже момента $t$. Пока такого релиза нет, задача остаётся в открытых и видна отдельным жёлтым числом $Y$ «ждёт выкатки». $S$ — сколько готового доехало до релиза за неделю. Ниже старое и новое сгорание стоят рядом. Разница между ними — то, что раньше выглядело сделанным, хотя до пользователя ещё не дошло. Если связь задачи с релизом установить не удалось, задача не считается выкаченной и попадает в жёлтую графу «не смогли определить выкатку».</div>
<div class="eq">$$\\mathrm{open}(x,t)=[\\mathrm{st}=\\text{открыта}]+[\\mathrm{st}=\\text{готова}\\land\\lnot\\mathrm{shipped}(x,t)],\\quad Y(t)=|\\{x:\\mathrm{st}=\\text{готова},\\lnot\\mathrm{shipped}(x,t)\\}|,\\quad S=|\\{x:\\lnot\\mathrm{shipped}(x,t_0),\\ \\mathrm{shipped}(x,t_1)\\}|$$</div>
<div id="shipBlock"></div>
</div>`);
  rep('Инварианты 1–8 прогоняются вживую', 'Инварианты 1–9 прогоняются вживую');
  rep('на каждом варианте группировки из раздела 2 и на сгорании.', 'на каждом варианте группировки из раздела 2, на матрице «дни × проекты» и на сгорании по старому и новому правилу.');
  rep('// ---------- §10: инварианты ----------', fs.readFileSync(W + '/js_v2_model.js', 'utf8') + '\n// ---------- §10: инварианты ----------');
  rep('// ---------- рендер ----------\nlet TZ', fs.readFileSync(W + '/js_v2_render.js', 'utf8') + '\n// ---------- рендер ----------\nlet TZ');
  // инварианты v2
  rep(`  const unk = D.events.filter(e => e.k === 'version?').length;`, `  // --- v2: матрица дни × проекты ---
  const MXm = matrix(tz, 6);
  const mxBad3 = MXm.rows.filter(r => r.sumEl - r.el !== r.extra).map(r => 'день ' + r.d).concat(MXm.colT.filter(c => c.sumEl - c.el !== c.extra).map(c => 'столбец ' + c.c));
  push(3, 'матрица дни × проекты: Σ клеток − итог = Σ(|G(x)|−1) в каждой строке и каждом столбце', mxBad3.length === 0, \`строк \${MXm.rows.length}, столбцов \${MXm.cols.length}; строк с Σ≠∪: \${MXm.rows.filter(r => r.sumEl !== r.el).length}, ΣM по дням = \${MXm.rows.reduce((q,r) => q + r.M, 0)}\`, mxBad3);
  const mxBad2 = MXm.rows.filter(r => !(r.maxEl <= r.el && r.el <= r.sumEl && r.maxEv <= r.ev && r.ev <= r.sumEv)).map(r => r.d);
  push(2, 'матрица: max клетки ≤ итог дня ≤ Σ клеток (события и элементы)', mxBad2.length === 0, \`проверено \${MXm.rows.length} дней\`, mxBad2);
  const colEvBad = MXm.colT.filter(c => c.ev !== c.sumEv).map(c => c.c);
  push(6, 'матрица: события дней в сумме = N_ev; событие столбца лежит ровно в одном дне', MXm.grand.sumRowEv === MXm.grand.ev && colEvBad.length === 0, \`Σ событий дней \${MXm.grand.sumRowEv} = N_ev \${MXm.grand.ev}; элементы: Σ по дням \${MXm.grand.sumRowEl} ≥ итог \${MXm.grand.el}\`, colEvBad);
  // --- v2: §7.2a ---
  const SM = shipModel(tz); const KK = SM.B.length; const SA = SM.G.get('all'); const BB = burn();
  const bad9 = []; for (const [k, g] of SM.G) for (let i = 0; i < KK; i++) if (!(g.Y[i] >= 0 && g.Y[i] <= g.nO[i] && g.Yu[i] <= g.Y[i])) bad9.push(k + ' @' + SM.B[i].slice(5,16));
  push(9, '0 ≤ Y ≤ O (новое правило) — итог, каждый проект и спринт, на каждой границе дня', bad9.length === 0, \`групп \${SM.G.size} × границ \${KK}; итог: Y(t0) = \${SA.Y[0]} ≤ O(t0) = \${SA.nO[0]}, Y(t1) = \${SA.Y[KK - 1]} ≤ O(t1) = \${SA.nO[KK - 1]}\`, bad9);
  const bad4n = []; for (const [k, g] of SM.G) if (g.nO[0] - g.nO[KK - 1] !== g.C - g.A) bad4n.push(k);
  push(4, 'Burn = C − A = O(t0) − O(t1) по правилу §7.2a (итог, проекты, спринты)', bad4n.length === 0, \`итог: \${SA.nO[0]} − \${SA.nO[KK - 1]} = \${SA.nO[0] - SA.nO[KK - 1]}; C − A = \${SA.C} − \${SA.A} = \${SA.C - SA.A}\`, bad4n);
  const Ssum = SA.S.reduce((q,x) => q + x, 0);
  push(4, 'сумма дневных S = недельному S (доехавшие считаются один раз)', Ssum === SM.waits.length, \`Σ S по дням = \${Ssum}; доехавших задач = \${SM.waits.length}\`);
  push('10.2', 'старое правило из цепочек статусов = расчёт §7.2 (положительный контроль)', SA.oO[0] === BB.all.O0 && SA.oO[KK - 1] === BB.all.O1 && SA.oC === BB.all.C && SA.oA === BB.all.A,
    \`цепочки: O \${SA.oO[0]}→\${SA.oO[KK - 1]}, C \${SA.oC}, A \${SA.oA}; §7.2: O \${BB.all.O0}→\${BB.all.O1}, C \${BB.all.C}, A \${BB.all.A}\`);
  const AT = D.timelinesAfterT1 || {}; const lastCat = x => { const t = AT[x.uid]; return t ? cat3(t[t.length - 1][1]) : (x.s1 === 'absent' ? null : x.s1); };
  const ydrift = SM.per.filter(p => (cat3(p.snap) === 'ready') !== (lastCat(p) === 'ready')).map(p => p.uid);
  const lateR = SM.per.filter(p => AT[p.uid] && (lastCat(p) === 'ready') !== (p.s1 === 'ready')).map(p => p.uid + ' → ' + AT[p.uid].slice(-1)[0][1] + ' в ' + AT[p.uid].slice(-1)[0][0].slice(11,16) + 'Z');
  push('10.2', '«готова»: цепочка статусов ↔ снимок all_tasks (снимок снят в окне выгрузки после t1, цепочка доведена до него)', ydrift.length === 0, \`сверено \${SM.per.length} задач; расхождений \${ydrift.length}; переходов в «готова» после t1, до снимка: \${lateR.length}\${lateR.length ? ' (' + lateR.join('; ') + ') — в расчёт на t1 не входят' : ''}\`, ydrift);
  const unkY = SM.oldest.filter(o => o.ship === 'unknown').map(o => o.uid);
  push('7.2a', 'выкатка определена для всех ждущих задач', unkY.length === 0 ? true : null, unkY.length ? \`не смогли определить выкатку у \${unkY.length} из \${SM.oldest.length} ждущих: у спринта нет разрешимой связи с релизом, путь через PR пуст. В Burn они открыты (не выкачены)\` : 'все ждущие — со связью', unkY);
  const unk = D.events.filter(e => e.k === 'version?').length;`);
  rep(`  const B = burn(); out.burn =`, `  out.mx = {msk:matrixPure(matrix('msk', 6)), utc:matrixPure(matrix('utc', 6))};
  out.ship = {msk:shipPure(shipModel('msk')), utc:shipPure(shipModel('utc'))};
  const B = burn(); out.burn =`);
  rep(`renderVolume(); renderRaw(); renderGroups(); renderBurn();`, `renderVolume(); renderRaw(); renderGroups(); renderMatrix(); renderBurn(); renderShip();`);
  rep(`function renderSummary(checks){
  const P = prepare(TZ); const R = groupCount(P.E, VARIANTS[0].g, TZ); const B = burn().all; const K = knowledge();`, `function renderSummary(checks){
  const P = prepare(TZ); const R = groupCount(P.E, VARIANTS[0].g, TZ); const B = burn().all; const K = knowledge();
  const SM = shipModel(TZ), SA = SM.G.get('all'), KK = SM.B.length; const bN = SA.nO[0] - SA.nO[KK - 1], Y0 = SA.Y[0], Y1 = SA.Y[KK - 1], S = SM.waits.length;`);
  rep(`<div class="kpi"><div class="v">\${checks.filter(c => c.ok === true).length}/\${checks.length}</div><div class="l">проверок зелёные</div></div></div>\`;`,
    `<div class="kpi"><div class="v \${bN > 0 ? 'ok' : 'bad'}">\${bN > 0 ? '+' : ''}\${bN}</div><div class="l">сгорание по §7.2a</div></div><div class="kpi ylw"><div class="v yel">\${Y1}</div><div class="l">ждут выкатки (было \${Y0})</div></div><div class="kpi"><div class="v">\${checks.filter(c => c.ok === true).length}/\${checks.length}</div><div class="l">проверок зелёные</div></div></div>\`;
  h += \`<div class="find w"><b>§7.2a на живых данных.</b> По новому правилу сгорание \${bN > 0 ? '+' : ''}\${bN} вместо \${B.O0 - B.O1 > 0 ? '+' : ''}\${B.O0 - B.O1}: готовое считается сгоревшим только после релиза. Ждут выкатки \${Y0} → \${Y1} (ΔY \${Y1 - Y0 > 0 ? '+' : ''}\${Y1 - Y0}), из них выкатку не смогли определить у \${SA.Yu[KK - 1]}. Доехало за неделю S = \${S}, медиана ожидания «готова → релиз» \${SM.med == null ? '—' : SM.med + ' дн'}. Подробно — раздел 3а.</div>\`;`);
  // данные: подпись источников
  rep(`<tr><td>agent_actions</td>`, `<tr><td>releases (все) · sprints.release_ids</td><td class="n">\${D.ship.src.releases} · \${D.ship.src.sprint_rows}</td><td>§7.2a: дата релиза по ключу «проект#тег»; связи спринт → релиз; история задачи AI-19 (готова, не тронута в неделе) — history_task</td></tr>
<tr><td>agent_actions</td>`);
}
fs.writeFileSync(W + '/page.tpl.html', s); console.log('patched', s.length);
