// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Отчёт о переносе документом (шаг 11 описания процесса, 16.11.2026).
// Один самодостаточный HTML: светлая тема, без скриптов и внешних обращений, кроме шрифтов. Что в нём:
// источник и новая база, кто и когда, итог статусов, решения с автором, запись по типам, сверка,
// связи (перенесено / ждут своего объекта / не переносится), остаток, отпечатки.
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tbl = (head, rows) => `<div class="tw"><table><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></div>`;
const num = n => `<span class="n">${esc(n)}</span>`;

export function buildReport({ when, who, source, target, dialog, decisions = [], transfer, edges, fingerprint }) {
  const v = transfer && transfer.stages && transfer.stages.verify;
  const ok = Boolean(v && v.ok && (!edges || edges.ok));
  const w = (transfer && transfer.stages && transfer.stages.write) || {};
  const counts = (v && v.counts) || {};
  const sum = (dialog && dialog.summary) || {};
  const scope = s => s.value !== undefined ? `«${esc(String(s.value).replace(/\s+/g, ' ').slice(0, 80))}»` : `<i>${esc(s.why)}</i>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Отчёт о переносе · ${esc(target)}</title>
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@800&family=Manrope:wght@400;700&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
<style>:root{color-scheme:light;--bg0:#faf6ee;--bg1:#fff;--bg2:#f1eadc;--bd:#dccfb8;--t1:#2a2218;--t2:#5f5343;--t3:#7a6d5a;--acc:#a8660a;--suc:#3f7a2c;--dng:#b23a26;--mono:'IBM Plex Mono',monospace}
body{margin:0;background:var(--bg0);color:var(--t1);font:400 13px/1.5 Manrope,system-ui,sans-serif}main{max-width:1000px;margin:0 auto;padding:18px 14px 40px}
h1{font:800 24px/1.2 Unbounded,sans-serif;color:var(--acc);margin:0 0 6px}h2{font:800 15px Unbounded,sans-serif;margin:22px 0 6px;border-bottom:1px solid var(--bd);padding-bottom:4px}
.sub{color:var(--t3);font-size:11px}.state{border:1px solid var(--bd);border-left:4px solid var(--suc);background:var(--bg1);border-radius:6px;padding:8px 10px;margin:10px 0;font-weight:700}.state.bad{border-left-color:var(--dng);color:var(--dng)}
.tw{overflow-x:auto;border:1px solid var(--bd);border-radius:6px;background:var(--bg1);margin:6px 0}table{border-collapse:collapse;width:100%;font-size:12px}th{background:var(--bg2);color:var(--t3);text-transform:uppercase;font-size:10px;letter-spacing:.06em;text-align:left;padding:5px 8px}td{border-top:1px solid var(--bd);padding:4px 8px;vertical-align:top}
.n{font-family:var(--mono);color:var(--acc)}code,.m{font-family:var(--mono);font-size:11px}</style></head><body><main>
<h1>Отчёт о переносе на новую модель</h1>
<p class="sub">Источник <span class="m">${esc(source)}</span> (только чтение) → новая база <span class="m">${esc(target)}</span> · ${esc(when)} · запустил ${esc(who)}</p>
<div class="state${ok ? '' : ' bad'}">${ok ? 'Сверка сошлась' : 'Сверка НЕ сошлась'}: записи — ${v && v.ok ? 'сошлись' : 'расхождение'}, связи — ${edges ? (edges.ok ? 'сошлись' : 'расхождение') : 'не переносились'}</div>
<p>Отпечаток содержимого новой базы: <b class="m">${esc(fingerprint && fingerprint.total)}</b>. Отпечаток диалога статусов: <span class="m">${esc(dialog && dialog.fingerprint)}</span>. Две новые базы, собранные с одинаковыми настройками из одного источника, дают один отпечаток.</p>

<h2>Статусы</h2>
<p>Свелось само: ${num(sum.unified)} · закрыто решением: ${num(sum.decided)} · пусто → начальный статус (правило владелицы 19.11): ${num(sum.defaulted || 0)} ·ждёт решения: ${num(sum.needs_decision)} · записей в источнике: ${num(sum.records)}.</p>

<h2>Решения (${decisions.length})</h2>
${tbl(['Код', 'Тип · поле', 'Значение', 'Решение', 'Кто', 'Когда'], decisions.map(d => [
  `<span class="m">${esc(d.id)}</span>`, `${esc(d.scope.type)} · ${esc(d.scope.field)}`, scope(d.scope),
  `${esc(d.action)}${d.to !== undefined ? ' → <b>' + esc(d.to) + '</b>' : ''}${d.labels ? ' <span class="sub">(' + esc(Object.values(d.labels).join(' / ')) + ')</span>' : ''}`,
  esc(d.by), esc(String(d.at).slice(0, 16).replace('T', ' ')),
]))}

<h2>Записи</h2>
${tbl(['Тип', 'В источнике', 'В новой базе'], Object.entries(counts).map(([t, c]) => [`<span class="m">${esc(t)}</span>`, num(c.source), num(c.target)]))}
<p>Связей «запись → версия»: ${num(w.links)}. В остатке (значения, не приведённые или удержанные до решения, — не потеряны): ${num(w.leftovers)}.</p>

<h2>Связи</h2>
${edges ? tbl(['Связь', 'Что с ней', 'Сколько'], [
  ...Object.entries(edges.moved || {}).map(([k, x]) => [`<span class="m">${esc(k)}</span>`, 'перенесена', num(typeof x === 'object' ? `${x.source} → ${x.target}` : x)]),
  ...Object.entries(edges.waiting || {}).map(([k, x]) => [`<span class="m">${esc(k)}</span>`, 'ждёт своего объекта', num(x.links ?? x)]),
  ...Object.entries(edges.dropped || {}).map(([k, x]) => [`<span class="m">${esc(k)}</span>`, 'не переносится по карте', num(x)]),
  ...(edges.anomalies || []).map(a => [`<span class="m">${esc(a.edge)}</span>`, 'аномалия: ' + esc(a.why), num(a.n)]),
]) : '<p class="sub">связи в этом прогоне не переносились</p>'}

<h2>Отпечатки по типам</h2>
${tbl(['Тип', 'Записей', 'Отпечаток'], Object.entries((fingerprint && fingerprint.types) || {}).map(([t, x]) => [`<span class="m">${esc(t)}</span>`, num(x.n), `<span class="m">${esc(x.fp)}</span>`]))}
<p class="sub">Отчёт собран установщиком lore-migrate. Учётки в отчёт не попадают.</p>
</main></body></html>`;
}
