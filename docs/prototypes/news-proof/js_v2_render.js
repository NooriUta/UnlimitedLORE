// ---------- рендер v2: матрица и §7.2a ----------
let MXN = 6, MSEL = null;
const shortP = p => String(p).includes('/') ? String(p).split('/').slice(1).join('/') : String(p);
const sgn = v => (v > 0 ? '+' : '') + v;
function renderMatrix(){
  $('#mxN').innerHTML = MX_NS.map(n => `<button class="pill mxn ${n === MXN ? 'on' : ''}" data-n="${n}">${n}</button>`).join('');
  const m = matrix(TZ, MXN);
  const mark = (sumEv, sumEl, ev, el, title) => (sumEl !== el || sumEv !== ev) ? `<span class="mk" title="${esc(title)}">Σ≠∪</span>` : '';
  let h = `<div class="kpis" style="margin:8px 0"><div class="kpi"><div class="v">${m.grand.ev} · ${m.grand.el}</div><div class="l">неделя (объединение)</div></div><div class="kpi"><div class="v">${m.days.length} × ${m.cols.length}</div><div class="l">дней × столбцов (проектов всего ${m.nProjects})</div></div><div class="kpi"><div class="v">${m.rows.reduce((s,r) => s + r.M, 0)}</div><div class="l">Σ M по дням</div></div><div class="kpi"><div class="v">${m.grand.sumRowEl}</div><div class="l">Σ элементов по дням</div></div></div>`;
  h += `<div class="scroll" style="max-height:520px;overflow-y:auto"><table class="mx"><tr><th>день</th>${m.cols.map(c => `<th class="n" title="${esc(c)}">${esc(shortP(c))}</th>`).join('')}<th class="n">Σ клеток</th><th class="n">итог дня (∪)</th><th class="n">M</th></tr>`;
  for (const r of m.rows) {
    h += `<tr><td class="mono">${esc(r.d)}</td>${r.cs.map((x, i) => { const key = r.d + '|' + m.cols[i]; return x.ev ? `<td class="cell ${MSEL === key ? 'sel' : ''}" data-k="${esc(key)}">${x.ev} · ${x.el}</td>` : '<td class="cell zero n">·</td>'; }).join('')}`;
    h += `<td class="n">${r.sumEv} · ${r.sumEl}</td><td class="n tc">${r.ev} · ${r.el}${mark(r.sumEv, r.sumEl, r.ev, r.el, `сумма клеток ${r.sumEv} · ${r.sumEl}, объединение ${r.ev} · ${r.el}; Σ(|G|−1) = ${r.extra}`)}</td><td class="n">${r.M || ''}</td></tr>`;
  }
  h += `<tr class="tot"><td>Σ дней</td>${m.colT.map(c => `<td class="n">${c.sumEv} · ${c.sumEl}</td>`).join('')}<td></td><td class="n">${m.grand.sumRowEv} · ${m.grand.sumRowEl}</td><td></td></tr>`;
  h += `<tr class="tot"><td>итог столбца (∪)</td>${m.colT.map(c => `<td class="n">${c.ev} · ${c.el}${mark(c.sumEv, c.sumEl, c.ev, c.el, `сумма по дням ${c.sumEv} · ${c.sumEl}, объединение ${c.ev} · ${c.el}`)}</td>`).join('')}<td></td><td class="n tc">${m.grand.ev} · ${m.grand.el}${mark(m.grand.sumRowEv, m.grand.sumRowEl, m.grand.ev, m.grand.el, 'сумма по дням ≠ объединение недели')}</td><td></td></tr>`;
  h += `<tr class="tot"><td>M (в ≥2 днях)</td>${m.colT.map(c => `<td class="n">${c.M || ''}</td>`).join('')}<td></td><td></td><td></td></tr></table></div>`;
  const rowsBad = m.rows.filter(r => r.sumEl !== r.el).length;
  h += `<div class="look">Сверка: в ${rowsBad} из ${m.rows.length} дней сумма клеток больше итога дня — это элементы нескольких проектов, всего $\\sum M=${m.rows.reduce((s,r) => s + r.M, 0)}$ по дням. Сумма итогов дней ${m.grand.sumRowEl} элементов больше итога недели ${m.grand.el}: элемент с событиями в разные дни в неделе считается один раз. События в сумме дней ровно ${m.grand.sumRowEv} = ${m.grand.ev}: каждое событие принадлежит одному дню. Столбец «прочие» — объединение остальных проектов, поэтому элемент двух «прочих» проектов в нём считается один раз.</div>`;
  $('#mxBlock').innerHTML = h;
  document.querySelectorAll('.mxn').forEach(b => b.onclick = () => { MXN = +b.dataset.n; MSEL = null; renderMatrix(); });
  document.querySelectorAll('#mxBlock td.cell[data-k]').forEach(td => td.onclick = () => { MSEL = MSEL === td.dataset.k ? null : td.dataset.k; renderMatrix(); });
  if (MSEL) { const [d, c] = MSEL.split('|'); const x = m.cells[m.ck(d, c)];
    if (x) { const pg = VARIANTS[0].g; const rows = x.events.slice().sort((a,b) => (a.at || a.day) < (b.at || b.day) ? -1 : (a.at || a.day) > (b.at || b.day) ? 1 : a.id < b.id ? -1 : 1);
      $('#mxEvents').innerHTML = `<h3>${esc(d)} · ${esc(c)}: ${x.ev} · ${x.els.size}${rows.length > 80 ? ' (первые 80)' : ''}</h3><div class="scroll"><table><tr><th>когда</th><th>тип</th><th>элемент</th><th>вид</th><th>проекты элемента</th></tr>` +
        rows.slice(0, 80).map(e => `<tr><td class="mono">${e.at ? (TZ === 'msk' ? mskTime(e.at) + ' · ' + e.at.slice(11,16) + ' UTC' : e.at.slice(11,16) + ' UTC') : 'время неизвестно'}</td><td>${TYPE_RU[e.t]}</td><td class="mono">${esc(e.el)}</td><td>${esc(KIND_RU[e.k] || e.k)}</td><td class="mono">${esc([...new Set(pg(e))].map(shortP).join(', '))}${new Set(pg(e)).size > 1 ? ` <span class="mk">×${new Set(pg(e)).size}</span>` : ''}</td></tr>`).join('') + '</table></div>'; return; } }
  $('#mxEvents').innerHTML = '<div class="sub">Нажмите на клетку, чтобы увидеть её события.</div>';
}
function renderShip(){
  const M = shipModel(TZ); const a = M.G.get('all'); const K = M.B.length;
  const bO = a.oO[0] - a.oO[K - 1], bN = a.nO[0] - a.nO[K - 1];
  const Y0 = a.Y[0], Y1 = a.Y[K - 1], S = a.S.reduce((s,x) => s + x, 0);
  const rs0 = a.oO[0] - a.nO[0], rs1 = a.oO[K - 1] - a.nO[K - 1];
  let h = `<div class="kpis">
<div class="kpi"><div class="v">${sgn(bO)}</div><div class="l">Burn по старому правилу (готова = открыта)</div></div>
<div class="kpi"><div class="v ${bN > 0 ? 'ok' : 'bad'}">${sgn(bN)}</div><div class="l">Burn по §7.2a (готова закрывается релизом)</div></div>
<div class="kpi ylw"><div class="v yel">${Y0} → ${Y1}</div><div class="l">Y ждёт выкатки: t0 → t1</div></div>
<div class="kpi ylw"><div class="v yel">${sgn(Y1 - Y0)}</div><div class="l">ΔY</div></div>
<div class="kpi"><div class="v ok">${S}</div><div class="l">S доехало за неделю (из них ещё в «готова» на t1: ${M.waits.filter(w => w.now === 'ready').length})</div></div>
<div class="kpi"><div class="v">${M.med == null ? 'нет данных' : M.med + ' дн'}</div><div class="l">медиана ожидания готова → релиз (по ${M.waits.length})</div></div>
<div class="kpi ylw"><div class="v yel">${a.Yu[K - 1]}</div><div class="l">из Y(t1): не смогли определить выкатку</div></div>
<div class="kpi"><div class="v">${M.enteredReady}</div><div class="l">задач вошли в «готова» за неделю</div></div></div>`;
  h += `<div class="look"><b>Старое против нового.</b> По старому правилу $O(t_0)=${a.oO[0]}$, $O(t_1)=${a.oO[K - 1]}$, Burn ${sgn(bO)}. По новому $O(t_0)=${a.nO[0]}$, $O(t_1)=${a.nO[K - 1]}$, Burn ${sgn(bN)}. Разница ${sgn(bN - bO)} складывается ровно из готовых задач, которые уже доехали до релиза: на $t_1$ их ${rs1}, на $t_0$ — ${rs0}; ${sgn(rs1)} − ${rs0} = ${sgn(rs1 - rs0)}. Готовые, но не выкаченные, в обоих правилах открыты: их $Y(t_1)=${Y1}$, и это жёлтое число рядом со сгоранием. ${S === 0 && Y1 > Y0 ? 'Готовое копится, а релиза нет — сигнал по §7.2a.' : ''} Ещё ${M.readyToClosedNoRel} задач за неделю ушли из «готова» прямо в ✅/🚫 без связанного релиза — они закрыты по статусу, правило §7.2a их не трогает.</div>`;
  // по дням
  const dayHead = '<tr><th>день</th><th class="n">O нач. (нов.)</th><th class="n">O конец (нов.)</th><th class="n">Burn нов.</th><th class="n">Burn стар.</th><th class="n">Y конец</th><th class="n">ΔY</th><th class="n">не смогли опр.</th><th class="n">S</th></tr>';
  let dr = '';
  for (let k = 0; k < K - 1; k++) { const bn = a.nO[k] - a.nO[k + 1], bo = a.oO[k] - a.oO[k + 1], dy = a.Y[k + 1] - a.Y[k];
    dr += `<tr><td class="mono">${esc(M.labels[k])}</td><td class="n">${a.nO[k]}</td><td class="n">${a.nO[k + 1]}</td><td class="n ${bn > 0 ? 'ok' : bn < 0 ? 'bad' : ''}">${sgn(bn)}</td><td class="n old">${sgn(bo)}</td><td class="n yel">${a.Y[k + 1]}</td><td class="n">${sgn(dy)}</td><td class="n yel">${a.Yu[k + 1]}</td><td class="n">${a.S[k] || ''}</td></tr>`; }
  dr += `<tr class="tot"><td>неделя</td><td class="n">${a.nO[0]}</td><td class="n">${a.nO[K - 1]}</td><td class="n">${sgn(bN)}</td><td class="n">${sgn(bO)}</td><td class="n">${Y1}</td><td class="n">${sgn(Y1 - Y0)}</td><td class="n">${a.Yu[K - 1]}</td><td class="n">${S}</td></tr>`;
  h += `<h3>По дням (${TZ === 'msk' ? 'Москва' : 'UTC'}; граница дня — полночь пояса, Y и O — на конец дня)</h3><div class="scroll"><table>${dayHead}${dr}</table></div>`;
  h += `<div class="look">Сгорание по дням телескопично: сумма дневных Burn равна недельному, сумма дневных $S$ равна недельному $S$. Релиз в LORE известен только датой, поэтому он засчитывается к концу своего дня (по Москве); к $t_1$ — все релизы, уже записанные на момент выгрузки.</div>`;
  // по проектам
  const projs = [...M.G.entries()].filter(([k]) => k.startsWith('p:')).map(([k, g]) => [k.slice(2), g])
    .filter(([, g]) => g.oO[0] - g.oO[K - 1] || g.nO[0] - g.nO[K - 1] || g.Y[0] || g.Y[K - 1] || g.S.some(x => x))
    .sort((x, y) => y[1].Y[K - 1] - x[1].Y[K - 1] || Math.abs(y[1].nO[0] - y[1].nO[K - 1]) - Math.abs(x[1].nO[0] - x[1].nO[K - 1]) || (x[0] < y[0] ? -1 : 1));
  const prow = (name, g, cls) => { const bo = g.oO[0] - g.oO[K - 1], bn = g.nO[0] - g.nO[K - 1]; const s = g.S.reduce((q,x) => q + x, 0);
    return `<tr class="${cls || ''}"><td>${esc(name)}</td><td class="n old">${g.oO[0]}/${g.oO[K - 1]}</td><td class="n">${g.nO[0]}/${g.nO[K - 1]}</td><td class="n old">${sgn(bo)}</td><td class="n ${cls ? '' : bn > 0 ? 'ok' : bn < 0 ? 'bad' : ''}">${sgn(bn)}</td><td class="n yel">${g.Y[0]}</td><td class="n yel">${g.Y[K - 1]}</td><td class="n">${sgn(g.Y[K - 1] - g.Y[0])}</td><td class="n">${s || ''}</td><td class="n yel">${g.Yu[K - 1] || ''}</td></tr>`; };
  const sumY1 = projs.reduce((s, [, g]) => s + g.Y[K - 1], 0), sumS = projs.reduce((s, [, g]) => s + g.S.reduce((q,x) => q + x, 0), 0);
  h += `<h3>По проектам (задача общего спринта — в каждом его проекте)</h3><div class="scroll" style="max-height:460px;overflow-y:auto"><table><tr><th>проект</th><th class="n">O стар. t0/t1</th><th class="n">O нов. t0/t1</th><th class="n">Burn стар.</th><th class="n">Burn нов.</th><th class="n">Y(t0)</th><th class="n">Y(t1)</th><th class="n">ΔY</th><th class="n">S</th><th class="n">не смогли опр.</th></tr>${projs.map(([k, g]) => prow(k, g)).join('')}`;
  h += `<tr class="tot"><td>Σ по проектам</td><td colspan="5"></td><td class="n">${sumY1}${sumY1 !== Y1 ? ' <span class="mk">Σ≠∪</span>' : ''}</td><td></td><td class="n">${sumS}${sumS !== S ? ' <span class="mk">Σ≠∪</span>' : ''}</td><td></td></tr>${prow('итог (объединение)', a, 'tot')}</table></div>`;
  // доехавшие
  h += `<h3>Доехало за неделю: S = ${S}, медиана ожидания ${M.med == null ? '—' : M.med + ' дн'}</h3><div class="sub">Из ${S} у ${M.waits.filter(w => w.closedBeforeRel).length} задач статус сменился на ✅/🚫 раньше даты релиза спринта: по §7.2a они «доехали» релизом, связанным со спринтом, хотя закрыты были вручную. Ожидание считается в днях: день релиза минус день входа в «готова» (по Москве), у релиза времени нет.</div><div class="scroll" style="max-height:300px;overflow-y:auto"><table><tr><th>задача</th><th>готова (день)</th><th>релиз</th><th>дата</th><th class="n">дней</th><th>сейчас</th></tr>${M.waits.map(w => `<tr><td class="mono">${esc(w.uid)}</td><td class="mono">${w.ready}</td><td class="mono">${esc(w.rel)}${w.how === 'tag' ? ' <span class="mk" title="тег найден только в одном проекте, проект спринта не совпал">по тегу</span>' : ''}</td><td class="mono">${w.relDate}</td><td class="n">${w.days}</td><td>${w.now === 'closed' ? 'закрыта' : w.now === 'ready' ? 'готова → закрыта релизом' : esc(w.now)}</td></tr>`).join('')}</table></div>`;
  // самые старые ждущие
  const why = o => o.ship === 'unknown' ? (o.link === 'nolink' ? (o.unres.length ? `теги спринта не найдены среди релизов: ${o.unres.join(', ')}` : 'у спринта нет связанного релиза, связь задача↔PR в LORE не заполнена') : `часть тегов спринта не найдена: ${o.unres.join(', ')}`)
    : (o.lastRel ? `последний релиз спринта ${o.lastRel.uid} от ${o.lastRel.date} — раньше дня готовности` : 'релизов спринта нет');
  h += `<h3>Ждут выкатки дольше всех (на t1), из ${M.oldest.length}</h3><div class="scroll" style="max-height:340px;overflow-y:auto"><table><tr><th>задача</th><th>готова с</th><th class="n">ждёт, дн</th><th>выкатка</th><th>почему не доехала</th></tr>${M.oldest.slice(0, 15).map(o => `<tr><td class="mono">${esc(o.uid)}</td><td class="mono">${mskDay(o.since)}</td><td class="n">${o.age.toFixed(1)}</td><td>${o.ship === 'unknown' ? '<span class="pill chip-unk">не смогли определить</span>' : '<span class="pill chip-unk">ждёт</span>'}</td><td class="sub">${esc(why(o))}</td></tr>`).join('')}</table></div>`;
  // покрытие связей
  const sids = [...new Set(M.oldest.map(o => o.sid))].sort(); const lk = {ok:0, partial:0, nolink:0}; for (const s of sids) lk[linkInfo(s).kind]++;
  const tagLinks = Object.values(D.ship.sprints).reduce((s, x) => s + x.resolved.filter(r => r.how === 'tag').length, 0);
  h += `<div class="look"><b>Откуда связи.</b> Релизы — срез releases (${D.ship.src.releases} шт., ключ «проект#тег»), связи спринт → релиз — поле release_ids среза sprints (${D.ship.src.sprint_rows} спринтов). Тег разрешается по проектам спринта; если тег не нашёлся в его проектах, но существует ровно в одном проекте, связь принимается с меткой «по тегу» (таких связей ${tagLinks}); иначе тег «не найден», и выкатка задач этого спринта — «не смогли определить». Спринты ждущих задач на $t_1$: связь в порядке — ${lk.ok}, часть тегов не найдена — ${lk.partial}, связей нет — ${lk.nolink}. Путь через PR проверен и пуст: ${D.ship.prProbe.map(p => `${p.slice}(${p.params.tag}) → ${p.total}`).join('; ')}. PR у релиза есть, а связи PR → задача срез не отдаёт, поэтому выкатку задачи можно установить только через её спринт.</div>`;
  $('#shipBlock').innerHTML = h;
  return M;
}
