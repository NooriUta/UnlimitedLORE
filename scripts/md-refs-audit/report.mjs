// HTML-отчёт аудита ссылок (SPRINT_UXR_POLISH_UAT_1113/PU-15). Строится только из снимка —
// никаких дат «сгенерировано» и случайного порядка: одинаковый снимок → одинаковые байты.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const pct = (a, b) => (b ? `${(Math.round((a / b) * 1000) / 10).toFixed(1).replace('.', ',')}%` : '—');

const TYPE_RU = {
  KnowTask: 'задача', KnowSprint: 'спринт', KnowADR: 'ADR', KnowDecision: 'решение', KnowSpec: 'спека',
  KnowDoc: 'док', KnowRelease: 'релиз', KnowQuestion: 'вопрос', KnowUseCase: 'сценарий', KnowRunbook: 'runbook',
  KnowMilestone: 'веха', KnowPhase: 'фаза', PlanVersion: 'версия плана', QGJobTask: 'задача QG',
  QGRecommendation: 'рекомендация QG', ClRoutineOutput: 'вывод рутины', ClRoutineRun: 'прогон рутины',
  KnowFile: 'файл', BragiInsight: 'инсайт BRAGI', BragiPublication: 'публикация BRAGI', BragiVariant: 'вариант BRAGI',
  KnowPain: 'боль', KnowGain: 'выгода', KnowJob: 'работа', KnowActor: 'агент', KnowProjectActor: 'роль',
  LoreComponent: 'компонент', KnowGitProject: 'git-проект', KnowFinding: 'находка',
};
const tru = (t) => (TYPE_RU[t] ? `${TYPE_RU[t]} <span class="mono dim">${esc(t)}</span>` : `<span class="mono">${esc(t)}</span>`);

function count(list, key) {
  const m = new Map();
  for (const x of list) { const k = key(x); if (k == null) continue; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || cmp(String(a[0]), String(b[0])));
}

export function renderReport({ snap, mentions, records, inputHash, classes, controls }) {
  const total = mentions.length;
  const byCls = new Map(count(mentions, (m) => m.cls));
  const g = (grp) => mentions.filter((m) => classes[m.cls].group === grp);
  const canon = g('canon'); const viol = g('violation');
  const brokenExplicit = mentions.filter((m) => m.broken === 'explicit');
  const brokenShape = mentions.filter((m) => m.broken === 'shape');
  const wrongType = mentions.filter((m) => m.wrongType);
  const wrongPairs = count(wrongType, (m) => `${m.type} → ${m.wrongType}`);
  const recKey = (m) => `${m.recType}\u0000${m.recId}`;
  const recsWithViol = new Set(viol.map(recKey));
  const recTotal = new Set(records.map((r) => `${r.type}\u0000${r.id}`)).size;
  const fields = count(records, (r) => `${r.type}.${r.field}`);
  const clsOrder = Object.keys(classes);
  const n = (c) => byCls.get(c) ?? 0;

  // ── Классы ──
  const clsRows = clsOrder.map((c) => {
    const ms = mentions.filter((m) => m.cls === c);
    const recs = new Set(ms.map(recKey)).size;
    const br = ms.filter((m) => m.broken).length;
    return `<tr><td><span class="pill p-${classes[c].group}">${{ canon: 'канон', violation: 'нарушение', info: 'справка' }[classes[c].group]}</span></td>
<td>${esc(classes[c].title)}<div class="mono dim small">${c}</div></td><td class="num">${fmt(ms.length)}</td><td class="num">${pct(ms.length, total)}</td><td class="num">${fmt(recs)}</td><td class="num">${br ? fmt(br) : '—'}</td></tr>`;
  }).join('\n');

  // ── Класс × тип записи ──
  const recTypes = count(mentions, (m) => m.recType).map(([t]) => t);
  const violCls = clsOrder.filter((c) => classes[c].group !== 'canon');
  const matrix = recTypes.map((t) => {
    const ms = mentions.filter((m) => m.recType === t);
    const can = ms.filter((m) => classes[m.cls].group === 'canon').length;
    const cells = violCls.map((c) => { const k = ms.filter((m) => m.cls === c).length; return `<td class="num${k ? ' hot' : ''}">${k ? fmt(k) : '·'}</td>`; }).join('');
    const brk = ms.filter((m) => m.broken === 'explicit').length;
    return `<tr><td>${tru(t)}</td><td class="num">${fmt(ms.length)}</td><td class="num">${pct(can, ms.length)}</td>${cells}<td class="num${brk ? ' hot' : ''}">${brk ? fmt(brk) : '·'}</td></tr>`;
  }).join('\n');
  const matrixHead = violCls.map((c) => `<th title="${esc(classes[c].title)}" class="mono">${c}</th>`).join('');

  // ── Битые ──
  const topBroken = (list, k) => count(list, (m) => `${m.type}\u0000${m.id}`).slice(0, k).map(([key, v]) => {
    const [type, id] = key.split('\u0000');
    const uniq = [...new Set(list.filter((m) => `${m.type}\u0000${m.id}` === key).map((m) => m.recId))].sort(cmp);
    return `<tr><td class="mono">${esc(type)}</td><td class="mono">${esc(id)}</td><td class="num">${fmt(v)}</td><td class="dim small mono">${esc(uniq.slice(0, 3).join(', '))}${uniq.length > 3 ? ` +${uniq.length - 3}` : ''}</td></tr>`;
  }).join('\n');

  // ── Одинокие коды ──
  const lone = mentions.filter((m) => m.cls === 'lone_task' || m.cls === 'lone_task_wiki');
  const loneSame = lone.filter((m) => m.sameSprint).length;
  const loneAmb = lone.filter((m) => (m.ambiguity ?? 0) > 1).length;
  const loneRows = count(lone, (m) => m.id).slice(0, 25).map(([id, k]) => {
    const ms = lone.filter((m) => m.id === id);
    return `<tr><td class="mono">${esc(id)}</td><td class="num">${fmt(k)}</td><td class="num">${fmt(ms[0].ambiguity ?? 0)}</td><td class="num">${pct(ms.filter((m) => m.sameSprint).length, k)}</td></tr>`;
  }).join('\n');

  // ── Примеры: по одной на запись, равномерно по отсортированному списку ──
  const examples = clsOrder.filter((c) => n(c)).map((c) => {
    const seen = new Set(); const rows = [];
    for (const m of mentions) {
      if (m.cls !== c || seen.has(recKey(m))) continue;
      seen.add(recKey(m)); rows.push(m);
    }
    const step = Math.max(1, Math.floor(rows.length / 8));
    const pick = rows.filter((_, i) => i % step === 0).slice(0, 8);
    return `<details><summary><span class="pill p-${classes[c].group}">${fmt(n(c))}</span> ${esc(classes[c].title)}</summary>
<div class="wrap"><table class="ex"><tr><th>где</th><th>поле</th><th>что</th><th>фрагмент</th></tr>${pick.map((m) => `<tr><td class="mono">${esc(m.recId)}<div class="dim">${esc(TYPE_RU[m.recType] ?? m.recType)}</div></td><td class="mono">${esc(m.field)}</td><td class="mono">${esc(m.id)}${m.broken ? ` <span class="pill p-violation">${m.broken === 'explicit' ? 'битая' : 'нет записи'}</span>` : ''}${m.wrongType ? ` <span class="pill p-info">на деле ${esc(m.wrongType)}</span>` : ''}</td><td>${esc(m.snippet)}</td></tr>`).join('')}</table></div></details>`;
  }).join('\n');

  // ── Контроль ──
  const ctl = controls ?? [];
  const ctlOk = ctl.filter((c) => c.ok).length;
  const ctlRows = ctl.map((c) => `<tr><td>${c.ok ? '<span class="pill p-canon">узнал</span>' : '<span class="pill p-violation">НЕ узнал</span>'}</td><td>${esc(c.expectTitle)}</td><td class="mono small">${esc(c.recId)} · ${esc(c.field)}</td><td class="mono small">${esc(c.id)}</td><td class="small dim">${esc(c.got)}</td></tr>`).join('\n');

  const recs = [
    ['Одна форма записи — [[тип:ID]]', `Это единственная форма, которую понимают все читатели: веб (kit MartProse), miniLORE и серверные автосвязи (MD-AUTOLINK). Сейчас ею записано ${fmt(n('wiki_typed'))} упоминаний из ${fmt(total)} (${pct(n('wiki_typed'), total)}); [[ID]] без типа — ещё ${fmt(n('wiki_bare'))}. Предложение: MCP-инструменты записи и редактор при сохранении переписывают узнанные формы в [[тип:ID]]; голая форма и тип:ID остаются читаемыми, но заново не пишутся.`],
    ['Задача — только парой СПРИНТ/КОД', `${fmt(lone.length)} упоминаний одиноких кодов (${fmt(n('lone_task'))} в прозе, ${fmt(n('lone_task_wiki'))} в [[…]]); ${pct(loneAmb, lone.length)} неоднозначны — такой код есть у нескольких задач; ${pct(loneSame, lone.length)} — код задачи своего же спринта. Предложение: при записи тела дописывать спринт владельца к коду своего спринта (PU-09 → [[task:SPRINT_…/PU-09]]); чужой одинокий код — предупреждение «назовите спринт», без молчаливой догадки.`],
    ['ID не в обратных кавычках', `${fmt(n('backtick'))} упоминаний ID внутри \`кода\` — ни один читатель не делает их ссылкой. Предложение: правило агентам уже есть (CLAUDE.md), не хватает проверки: ID узнаваемой формы в inline-коде → предупреждение в ответе MCP с готовой заменой. Блоки кода \`\`\` (${fmt(n('codeblock'))}) не трогать — там примеры.`],
    ['Не URL экрана вместо ссылки на объект', `${fmt(n('url_lore'))} ссылок вида :4400/lore?…passport=…/new.lore…?open=… — адрес меняется при переезде (уже было: localhost → ci-server → new.lore), объект — нет. Предложение: при записи переписывать такие URL в [[тип:ID]].`],
    ['GitHub — зеркало, не источник', `${fmt(n('url_github'))} GitHub-ссылок (PR, коммиты), хотя GitHub по правилу проекта — только зеркало релизов. Ссылок Forgejo — ${fmt(n('url_forgejo'))}. Предложение: PR писать как #NNN / проект#NNN (как KnowPR.pr_uid), коммит — коротким хэшем; перепись старых — отдельным решением.`],
    ['Красная ссылка — сразу при записи', `${fmt(brokenExplicit.length)} явных ссылок ([[…]] / тип:ID / @) ведут в никуда, ещё ${fmt(brokenShape.length)} голых ID «по виду» не находят записи (часто локальная нумерация вроде UC-1 или шаблон SPRINT_X/CODE). Предложение: ответ записи любого MD-поля отдаёт список битых (как mentions.skipped в MD-AUTOLINK, который сейчас есть только у ADR, решений, доков и спринтов).`],
    ['Вид ID не должен врать о типе', `${fmt(wrongType.length)} упоминаний, где вид называет один тип, а запись другого (${wrongPairs.map(([k, v]) => `${k}: ${fmt(v)}`).join('; ')}). Главный случай — атомарные решения с ID ADR-…-Dn: Peek в вебе (typeByForm) и miniLORE по виду идут к ADR и показывают «записи нет». Предложение: для новых решений — только D-ГГГГ-…, а у старых ADR-…-Dn ссылаться формой [[decision:ID]]; правило вида ADR- в разборщиках — «ADR-X-N» без хвоста -Dn/-Rn.`],
    ['Один разборщик на всех', 'Формы разбираются тремя разными кодами с разным охватом (таблица ниже): веб делает ссылкой только [[…]] и узнаёт по виду 4 семейства, miniLORE — все формы и 17 типов. Предложение: одна общая таблица семейств и типов — источник для kit, web-next, сервера и этого аудита.'],
    ['Экранированные \\[\\[…\\]\\]', `${fmt(n('wiki_escaped'))} — след сериализатора без markdownLossless; ссылка в них потеряна. Держать в тесте сохранения TipTap.`],
  ];

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ссылки на объекты в MD — аудит LORE (PU-15)</title>
<style>
:root{--bg0:#0f0d0a;--bg1:#17140f;--bg2:#1f1b14;--bd:#3a3226;--t1:#efe6d6;--t2:#bfb19a;--t3:#857860;--acc:#e0a33a;--suc:#7fb069;--wrn:#e0a33a;--dng:#d9634c;--inf:#6fa8c9;
--fs-2xs:10px;--fs-xs:11px;--fs-sm:12px;--fs-md:13px;--fs-lg:15px;--fs-xl:19px;--fs-2xl:22px;--mono:'IBM Plex Mono',ui-monospace,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg0);color:var(--t1);font:var(--fs-sm)/1.5 Manrope,'Segoe UI',system-ui,sans-serif}
main{max-width:1180px;margin:0 auto;padding:14px;overflow-wrap:anywhere}
.wrap td,.wrap th{overflow-wrap:normal}
h1{font:800 var(--fs-2xl)/1.2 Unbounded,Manrope,sans-serif;color:var(--acc);margin:4px 0 8px}
h2{font:800 var(--fs-md)/1.3 Unbounded,Manrope,sans-serif;color:var(--acc);margin:26px 0 8px;text-transform:uppercase;letter-spacing:.04em}
.mono{font-family:var(--mono)}.dim{color:var(--t3)}.small{font-size:var(--fs-xs)}
.card{background:var(--bg1);border:1px solid var(--bd);border-radius:8px;padding:10px 12px;margin:8px 0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.kpi{background:var(--bg1);border:1px solid var(--bd);border-radius:8px;padding:10px}.kpi b{display:block;font:800 var(--fs-xl) Unbounded,Manrope,sans-serif}.kpi span{color:var(--t2);font-size:var(--fs-xs)}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:var(--fs-sm)}
th{text-transform:uppercase;font-size:var(--fs-2xs);letter-spacing:.05em;color:var(--t3);text-align:left;padding:5px 6px;border-bottom:1px solid var(--bd);white-space:nowrap}
td{padding:4px 6px;border-bottom:1px solid var(--bg2);vertical-align:top}td.num{text-align:right;font-family:var(--mono);white-space:nowrap}td.hot{color:var(--wrn)}
.pill{display:inline-block;border-radius:999px;padding:0 8px;font-size:var(--fs-2xs);border:1px solid var(--bd);white-space:nowrap}
.p-canon{color:var(--suc);border-color:var(--suc)}.p-violation{color:var(--dng);border-color:var(--dng)}.p-info{color:var(--inf);border-color:var(--inf)}
details{background:var(--bg1);border:1px solid var(--bd);border-radius:8px;margin:6px 0;padding:6px 10px}summary{cursor:pointer}
table.ex td{font-size:var(--fs-xs);word-break:break-word}ol{padding-left:20px}ol li{margin:7px 0}ol b{color:var(--acc)}
.ok{color:var(--suc)}.bad{color:var(--dng)}
</style></head><body><main>
<h1>Ссылки на объекты в MD-полях LORE</h1>
<div class="dim">Задача SPRINT_UXR_POLISH_UAT_1113/PU-15 · база <span class="mono">${esc(snap.source.db)}</span> на <span class="mono">${esc(snap.source.host)}:${esc(snap.source.port)}</span>, только чтение · снимок <span class="mono">${inputHash.slice(0, 16)}</span></div>

<h2>Коротко</h2>
<div class="card">
Прочитано <b>${fmt(records.length)}</b> MD-полей в <b>${fmt(recTotal)}</b> записях (${fields.length} пар «тип.поле», только текущие версии); в них <b>${fmt(total)}</b> упоминаний объектов.
По канону записано <b class="ok">${pct(canon.length, total)}</b>, нарушений <b class="bad">${pct(viol.length, total)}</b> (${fmt(viol.length)}), они есть в ${fmt(recsWithViol.size)} записях из ${fmt(recTotal)}.
Больше всего одиноких кодов задач без спринта (${fmt(lone.length)}), GitHub-ссылок (${fmt(n('url_github'))}) и ID в обратных кавычках (${fmt(n('backtick'))}). Явных битых ссылок — ${fmt(brokenExplicit.length)}.
Форма, которую понимают все читатели, — <b>[[тип:ID]]</b> — пока редкость: ${fmt(n('wiki_typed'))} (${pct(n('wiki_typed'), total)}).
</div>
<div class="kpis">
<div class="kpi"><b>${fmt(total)}</b><span>упоминаний</span></div>
<div class="kpi"><b class="ok">${pct(canon.length, total)}</b><span>по канону</span></div>
<div class="kpi"><b class="bad">${fmt(viol.length)}</b><span>нарушений</span></div>
<div class="kpi"><b>${fmt(lone.length)}</b><span>одиноких кодов задач</span></div>
<div class="kpi"><b>${fmt(brokenExplicit.length)}</b><span>явных битых ссылок</span></div>
<div class="kpi"><b>${ctlOk}/${ctl.length}</b><span>положительный контроль</span></div>
</div>

<h2>Что стандартизировать для новых фич</h2>
<div class="card"><ol>${recs.map(([h, t]) => `<li><b>${esc(h)}.</b> ${esc(t)}</li>`).join('')}</ol>
<div class="dim small">Перепись существующих тел пачкой — отдельным решением владелицы (через MCP, по SCD2). Этот скрипт ничего не пишет.</div></div>

<h2>Классы упоминаний</h2>
<div class="wrap"><table><tr><th>группа</th><th>класс</th><th>упоминаний</th><th>доля</th><th>записей</th><th>без записи</th></tr>${clsRows}</table></div>
<div class="dim small">«Без записи»: цели нет в базе. Для явных форм это битая ссылка, для голых ID по виду — «похоже на ID, записи нет». Одинокие коды на битость не проверяются: без спринта цель не определена.</div>

<h2>Нарушения по типам записей</h2>
<div class="wrap"><table><tr><th>тип записи</th><th>упом.</th><th>канон</th>${matrixHead}<th>битые</th></tr>${matrix}</table></div>

<h2>Битые ссылки</h2>
<div class="card"><b>Явные</b> ([[…]], тип:ID, @) — цели нет: ${fmt(brokenExplicit.length)}.</div>
<div class="wrap"><table><tr><th>тип</th><th>ID</th><th>раз</th><th>где</th></tr>${topBroken(brokenExplicit, 30)}</table></div>
<div class="card"><b>Голые ID по виду без записи</b>: ${fmt(brokenShape.length)}. Часто это не ссылка: локальная нумерация (UC-1 внутри спеки), шаблон (SPRINT_X/CODE) или опечатка.</div>
<div class="wrap"><table><tr><th>тип по виду</th><th>ID</th><th>раз</th><th>где</th></tr>${topBroken(brokenShape, 30)}</table></div>

<h2>Вид назвал не тот тип</h2>
<div class="card">ID существует, но у записи другого типа, чем подсказывает вид: ${fmt(wrongType.length)} упоминаний. Читатель, угадывающий тип по виду, откроет не ту дверь и покажет «записи нет».</div>
<div class="wrap"><table><tr><th>вид → на деле</th><th>раз</th></tr>${wrongPairs.map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="num">${fmt(v)}</td></tr>`).join('')}</table></div>

<h2>Одинокие коды задач</h2>
<div class="card">Код совпадает с <span class="mono">task_id</span> существующей задачи, но записан без спринта: ${fmt(lone.length)} упоминаний. Неоднозначных (код у двух задач и больше) — ${pct(loneAmb, lone.length)}; код своего же спринта — ${pct(loneSame, lone.length)}.</div>
<div class="wrap"><table><tr><th>код</th><th>упоминаний</th><th>задач с таким кодом</th><th>свой спринт</th></tr>${loneRows}</table></div>

<h2>Кто какую форму делает ссылкой</h2>
<div class="wrap"><table>
<tr><th>форма</th><th>веб (kit MartProse)</th><th>web-next Peek</th><th>miniLORE</th><th>сервер MD-AUTOLINK</th></tr>
<tr><td class="mono">[[тип:ID]]</td><td class="ok">да</td><td class="ok">тип из ссылки</td><td>ссылка, но «[[ ]]», похоже, остаются текстом*</td><td class="ok">да</td></tr>
<tr><td class="mono">[[ID]]</td><td class="ok">да</td><td>тип по виду только у ADR, SPEC, D-, СПРИНТ/КОД</td><td class="ok">да (+ док snake_case)</td><td class="ok">да</td></tr>
<tr><td class="mono">тип:ID</td><td class="bad">текст</td><td>—</td><td class="ok">да, 17 типов</td><td class="bad">нет</td></tr>
<tr><td>по виду</td><td class="bad">текст</td><td>—</td><td class="ok">да (СПРИНТ/КОД, спринт, 11 семейств)</td><td class="bad">нет</td></tr>
<tr><td class="mono">@ / #тип</td><td colspan="4">только вызов окна в редакторе; хранится как [[тип:ID]] (SPEC-LORE-MD-INLINE-REF §1–2)</td></tr>
</table></div>
<div class="dim small">Источники: <span class="mono">kit/src/content/markdownWiki.ts</span>, <span class="mono">web-next/src/record/loreRefForms.ts</span>, <span class="mono">app_flutter/lib/src/data/lore_refs.dart</span>, SPEC-LORE-MD-INLINE-REF §7. *Гипотеза по чтению кода, прогоном не проверена: регулярка <span class="mono">_wiki</span> в lore_refs.dart не пускает «:».</div>

<h2>Примеры по классам</h2>
${examples}

<h2>Положительный контроль на известных записях</h2>
<div class="wrap"><table><tr><th>итог</th><th>ожидали</th><th>запись · поле</th><th>ID</th><th>что нашёл классификатор</th></tr>${ctlRows}</table></div>
<div class="dim small">Плюс модульный тест <span class="mono">scripts/md-refs-audit/classify.test.mjs</span>: заведомо правильные и заведомо неправильные формы, ложные срабатывания (UTF-8, время, почта, путь, голый адрес стенда).</div>

<h2>Метод и ограничения</h2>
<div class="card small"><ul>
<li>Поля: свойства с окончанием <span class="mono">_md</span>, <span class="mono">_md_ru</span>, <span class="mono">_md_en</span> и <span class="mono">description / summary / statement / text</span> у всех вершин. У *Hist — только открытая версия (<span class="mono">valid_to is null</span>) и только поля, которых нет на самой вершине, чтобы текущее значение не посчиталось дважды. Рёбра (feedback_md у ROLE_HELD_BY) не читались.</li>
<li>Канон по SPEC-LORE-MD-INLINE-REF и правилу «Как писать идентификаторы LORE»: [[…]], тип:ID, по виду, tana. ID внутри блока кода — справка, не нарушение.</li>
<li>Одинокий код = токен, совпадающий с <span class="mono">task_id</span> существующей задачи. Коды, не заведённые в LORE, не ловятся — это нижняя граница.</li>
<li>Слаги доков и имена компонентов в прозе по виду не узнаются (вид не называет тип) — они видны только в [[…]] и тип:ID.</li>
<li>Детерминизм: отчёт строится только из снимка <span class="mono">snapshot.json</span>, всё отсортировано. Хэш снимка <span class="mono">${inputHash}</span>. Повтор без базы: <span class="mono">node scripts/md-refs-audit/audit.mjs --from snapshot.json</span>.</li>
<li>Поля по объёму: ${fields.slice(0, 12).map(([k, v]) => `<span class="mono">${esc(k)}</span> ${fmt(v)}`).join(' · ')}${fields.length > 12 ? ` · ещё ${fields.length - 12}` : ''}.</li>
</ul></div>
</main></body></html>
`;
}
