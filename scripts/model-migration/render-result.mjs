#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Страница результата: модель после переноса и паспорта.
//
// Страница ничего не спрашивает и ничего не хранит сама: она целиком собирается из файлов конфигурации.
// Положили новый файл в map/ или поправили существующий — страница показывает это при следующей сборке.
//   map/*.json                      — карта переноса: что стало с каждым полем старой базы;
//   texts/*.json                    — тексты полей: название, кратко, определение, описание;
//   rules/universal-fields.json     — общие поля, решённые один раз для всех объектов;
//   shared/model/lore-model.json    — паспорта kit.
// Запуск: node scripts/model-migration/render-result.mjs [--out <файл.html>]
// Тема — светлая: владелица читает отчёты на светлом фоне (16.11.2026: «не забывай отдавать в светлом фоне»).
// Самопроверка: каждое поле каждой карты обязано попасть на страницу ровно один раз, иначе код возврата 1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const J = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(ROOT, 'build', 'model-result.html');

const listJson = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : []);
// В map/ лежат и карты связей (*.edges.json: ключ edges, без types) — на странице полей они не участвуют.
const MAPS = listJson(path.join(HERE, 'map')).filter(f => !f.endsWith('.edges.json')).map(f => ({ id: f.replace(/\.json$/, ''), ...J(path.join(HERE, 'map', f)) }));
const TEXTS = Object.assign({}, ...listJson(path.join(HERE, 'texts')).map(f => J(path.join(HERE, 'texts', f)).types));
const UNI = J(path.join(HERE, 'rules', 'universal-fields.json'));
const M = J(path.join(ROOT, 'shared', 'model', 'lore-model.json'));

const RULE = {
  keep: ['остаётся', 'suc'], rename: ['новое имя', 'inf'], transform: ['преобразуется', 'inf'],
  to_current_version: ['в текущую версию', 'inf'], drop: ['не переносится', 'dng'], open: ['не решено', 'wrn'],
};
const BASIS = { owner: ['решено владелицей', 'suc'], proposal: ['предложение', 'wrn'], open: ['вопрос', 'dng'] };
const chip = (t, tone) => `<span class="chip ${tone || ''}">${esc(t)}</span>`;
const ident = s => /^[a-z][a-z0-9_]*$/.test(s || '');

let rendered = 0;
// Вложенный тип (фаза) своей записи в graph не имеет — находится по имени вершины.
const childOf = base => M.child_only.find(x => x.type === base.replace(/^Know|^Lore/, "").toLowerCase());
const vertexLabel = T => {
  const base = T.replace(/Hist$/, '');
  const mt = Object.entries(M.graph).find(([, g]) => g.vertex === base);
  const t = (mt && M.types.find(x => x.type === mt[0])) || childOf(base);
  return (t ? t.label : base.replace(/^Know|^Lore/, '')) + (T.endsWith('Hist') ? ' — версии' : '');
};

function fieldRow(T, f, e) {
  rendered++;
  const tx = (TEXTS[T] || {})[f] || {};
  const uni = UNI.fields[f];
  const [rl, rt] = RULE[e.rule] || [e.rule, ''];
  const [bl, bt] = BASIS[e.basis] || [e.basis || '—', ''];
  const newName = e.rule === 'drop' ? '' : (e.rule === 'rename' || e.rule === 'transform') && ident(e.to) ? e.to : e.rule === 'open' ? '' : f;
  const what = [e.to && !ident(e.to) ? '→ ' + e.to : '', e.how, e.why, e.question, e.note].filter(Boolean).join(' · ');
  return `<tr class="r-${esc(e.rule)}"><td><code>${esc(f)}</code>${newName && newName !== f ? ` <span class="arr">→</span> <code class="new">${esc(newName)}</code>` : ''}${tx.service ? ' ' + chip('служебное') : ''}${uni ? ' ' + chip('общее поле', 'suc') : ''}</td>`
    + `<td>${tx.name ? `<b>${esc(tx.name)}</b>` : '<span class="sub">—</span>'}${tx.def ? `<div class="sub">${esc(tx.def)}</div>` : ''}</td>`
    + `<td class="mono">${esc(tx.kind || '—')}${tx.dict ? `<div class="sub">${esc(tx.dict)}</div>` : ''}</td>`
    + `<td>${chip(rl, rt)}${what ? `<div class="sub">${esc(what)}</div>` : ''}</td><td>${chip(bl, bt)}</td></tr>`;
}

function typeBlock(T, fields) {
  const ent = Object.entries(fields);
  const live = ent.filter(([, e]) => e.rule !== 'drop'), dropped = ent.filter(([, e]) => e.rule === 'drop');
  const head = '<thead><tr><th>Поле</th><th>Название и определение</th><th>Вид</th><th>Что делает перенос</th><th>Основание</th></tr></thead>';
  return `<section class="ty"><h3>${esc(vertexLabel(T))} <span class="mono sub">${esc(T)}</span> <span class="sub">полей ${ent.length} · переносится ${live.length} · снимается ${dropped.length}</span></h3>`
    + `<div class="tw"><table>${head}<tbody>${live.map(([f, e]) => fieldRow(T, f, e)).join('')}</tbody></table></div>`
    + (dropped.length ? `<details><summary>Не переносится · ${dropped.length}</summary><div class="tw"><table>${head}<tbody>${dropped.map(([f, e]) => fieldRow(T, f, e)).join('')}</tbody></table></div></details>` : '')
    + '</section>';
}

function passport(mt) {
  const t = M.types.find(x => x.type === mt);
  if (!t) {
    const ch = M.child_only.find(x => x.type === mt);
    return ch ? `<div class="wire"><div class="wt">${esc(ch.label)} <span class="sub">своего паспорта нет — строка в таблице родителя</span></div><div class="whead">${(ch.fields || []).map(f => `<span class="wf">${esc(f.label)}</span>`).join('')}</div></div>` : '';
  }
  const fm = Object.fromEntries(t.fields.map(f => [f.key, f]));
  const fc = f => `<span class="wf${f.editable ? ' ed' : ''}" title="${esc(f.key + ' · ' + f.kind)}">${esc(f.label)}${f.editable ? ' ✎' : ''}</span>`;
  const head = t.fields.filter(f => f.group === 'head').map(fc).join('');
  const side = (t.props || []).map(s => `<div class="wsec"><div class="wsh">${esc(s.section || 'Свойства')}</div>${s.fields.map(k => (fm[k] ? fc(fm[k]) : '')).join('')}</div>`).join('');
  const body = (t.body || []).map(b => `<div class="wbody">${esc(b.label)}${b.editable ? ' ✎' : ''} <span class="sub">текст</span></div>`).join('');
  const parts = (t.parts || []).map(p => `<div class="wpart"><div class="wsh">${esc(p.label)} <span class="sub">таблица · ${esc(p.type)}</span></div><div class="wcols">${(p.columns || []).map(c => `<span>${esc(c)}</span>`).join('')}${p.optionalColumns ? `<span class="opt">+${p.optionalColumns.length} по выбору</span>` : ''}</div></div>`).join('');
  const tabs = (t.linkTabs || []).map(l => `<span class="wtab">${esc(l.label)}</span>`).join('');
  return `<div class="wire"><div class="wt">${esc(t.label)} <span class="mono sub">${esc(mt)}</span>${M.read_only.includes(mt) ? ' ' + chip('только чтение', 'wrn') : ''}</div>`
    + `<div class="whead">${head}</div><div class="wgrid"><div class="wmain">${body || '<div class="wbody sub">текста нет</div>'}${parts}${tabs ? `<div class="wtabs">Вкладки связей: ${tabs}</div>` : ''}</div><div class="wside">${side || '<div class="wsec sub">свойств нет</div>'}</div></div>`
    + '<div class="sub">✎ — поле правится в паспорте.</div></div>';
}

// Предложение новой схемы объекта — из schema/<объект>.json (его выводит propose-schema.mjs по сухому прогону).
function schemaBlock(id) {
  const f = path.join(HERE, 'schema', id + '.json');
  if (!fs.existsSync(f)) return '';
  const s = J(f);
  const pct = e => (e.of ? Math.round((100 * e.filled) / e.of) : 0);
  const block = ([T, t]) => {
    const rows = Object.entries(t.fields).map(([n, e]) => `<tr><td><code class="new">${esc(n)}</code>${e.service ? ' ' + chip('служебное') : ''}</td><td>${e.name ? esc(e.name) : '<span class="sub">—</span>'}</td><td class="mono">${esc(e.db_type)}<div class="sub">${esc(e.kind)}</div></td><td class="mono sub">${esc(e.from.join(', ') || '—')}</td><td>${e.filled} из ${e.of} <span class="sub">· ${pct(e)}%</span></td></tr>`).join('');
    const rej = Object.entries(t.rejects), held = Object.entries(t.held);
    return `<section class="ty"><h3>${esc(vertexLabel(T))} <span class="mono sub">${esc(T)}</span> <span class="sub">записей ${t.records} · полей ${Object.keys(t.fields).length}</span></h3>`
      + `<div class="tw"><table><thead><tr><th>Поле новой схемы</th><th>Название</th><th>Тип в базе</th><th>Из старого поля</th><th>Заполнено по снимку</th></tr></thead><tbody>${rows}</tbody></table></div>`
      + (t.from_record_to_current_version.length ? `<p class="sub">С записи в текущую версию уходят: ${t.from_record_to_current_version.map(x => `<code>${esc(x)}</code>`).join(' ')}</p>` : '')
      + (held.length ? `<p class="sub">${chip('удержано до решения', 'wrn')} ${held.map(([k, n]) => `<code>${esc(k)}</code> ${n}`).join(' · ')}</p>` : '')
      + (rej.length ? `<p class="sub">${chip('не привелось', 'dng')} ${rej.map(([k, n]) => `${esc(k)}: ${n}`).join(' · ')}</p>` : '')
      + '</section>';
  };
  return `<h2>Новая схема — предложение</h2><p class="sub">${chip('не утверждено', 'wrn')} ${esc(s._about)} Источник данных: ${esc(s._source)}.</p>`
    + `<p class="sub"><b>Допущения, которые нужно подтвердить:</b></p><ul class="sub">${s._assumed.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`
    + Object.entries(s.types).map(block).join('');
}

function objectPage(map, i) {
  const all = Object.values(map.types).flatMap(t => Object.values(t));
  const by = k => all.reduce((a, e) => ((a[e[k]] = (a[e[k]] || 0) + 1), a), {});
  const rules = by('rule'), basis = by('basis');
  const bases = [...new Set(Object.keys(map.types).map(T => T.replace(/Hist$/, '')))];
  const mts = [...Object.entries(M.graph).filter(([, g]) => bases.includes(g.vertex)).map(([mt]) => mt), ...bases.map(childOf).filter(Boolean).map(c => c.type)];
  const kpi = [[all.length, 'полей в карте'], [basis.owner || 0, 'решено владелицей'], [basis.proposal || 0, 'предложение, не согласовано'], [rules.open || 0, 'не решено'], [rules.drop || 0, 'не переносится']];
  const title = bases.map(vertexLabel).join(', ');
  return { id: map.id, title, html: `<section class="page" data-page="${esc(map.id)}"${i ? ' hidden' : ''}><h1>${esc(title)}</h1><p class="sub">${esc(map._about || '')}</p>`
    + `<div class="kpis">${kpi.map(k => `<div class="kpi"><b>${k[0]}</b><span>${esc(k[1])}</span></div>`).join('')}</div>`
    + `<h2>Модель после переноса</h2>${Object.entries(map.types).map(([T, f]) => typeBlock(T, f)).join('')}`
    + schemaBlock(map.id)
    + `<h2>Паспорта</h2><p class="sub">Источник — shared/model/lore-model.json.</p>${mts.map(passport).join('') || '<p class="sub">Паспортов у типов этого объекта в модели нет.</p>'}</section>` };
}

const pages = MAPS.map(objectPage);
const expected = MAPS.reduce((n, m) => n + Object.values(m.types).reduce((k, t) => k + Object.keys(t).length, 0), 0);
const uniRows = Object.entries(UNI.fields).map(([f, u]) => `<tr><td><code>${esc(f)}</code></td><td>${u.name ? `<b>${esc(u.name)}</b><div class="sub">${esc(u.def)}</div>` : '<span class="sub">тексты — у объекта</span>'}</td><td>${esc(u.rule)}</td><td>${chip((BASIS[u.basis] || [u.basis])[0], (BASIS[u.basis] || [])[1])}<div class="sub">${esc(u.words || '')}</div></td></tr>`).join('');
const uniPage = `<section class="page" data-page="universal" hidden><h1>Общие поля</h1><p class="sub">${esc(UNI._about)}</p><div class="tw"><table><thead><tr><th>Поле</th><th>Название и определение</th><th>Правило</th><th>Основание</th></tr></thead><tbody>${uniRows}</tbody></table></div></section>`;

const CSS = `:root{color-scheme:light;--bg0:#faf6ee;--bg1:#ffffff;--bg2:#f1eadc;--bg3:#e8dfcc;--bd:#dccfb8;--t1:#2a2218;--t2:#5f5343;--t3:#7a6d5a;--acc:#a8660a;--suc:#3f7a2c;--wrn:#a8660a;--inf:#2f6a94;--dng:#b23a26;--mono:'IBM Plex Mono',ui-monospace,monospace;--fs-2xs:9px;--fs-xs:10px;--fs-sm:11px;--fs-base:12px;--fs-md:13px;--fs-lg:14px;--fs-xl:20px;--fs-2xl:24px}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg0);color:var(--t1);font:400 var(--fs-base)/1.45 Manrope,system-ui,sans-serif}
.top{position:sticky;top:0;z-index:5;background:var(--bg1);border-bottom:1px solid var(--bd);padding:6px 10px}.nav{display:flex;gap:6px;overflow-x:auto}.nav a{white-space:nowrap;text-decoration:none;color:var(--t2);border:1px solid var(--bd);border-radius:999px;padding:3px 10px;font-size:var(--fs-xs)}.nav a.on{color:var(--bg0);background:var(--acc);border-color:var(--acc);font-weight:700}
.wrap{max-width:1400px;margin:0 auto;padding:10px 12px 60px}h1,h2,h3{font-family:Unbounded,Manrope,sans-serif;font-weight:800;margin:16px 0 6px}h1{font-size:var(--fs-2xl);color:var(--acc);margin-top:6px}h2{font-size:var(--fs-xl);border-bottom:1px solid var(--bd);padding-bottom:4px}h3{font-size:var(--fs-lg)}
p{color:var(--t2);margin:6px 0}.sub{color:var(--t3);font-size:var(--fs-xs);font-weight:400;font-family:Manrope,sans-serif}.mono,code{font-family:var(--mono);font-size:var(--fs-xs)}code{color:var(--t1);background:var(--bg3);border-radius:4px;padding:0 4px}code.new{color:var(--acc)}.arr{color:var(--t3)}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;margin:8px 0}.kpi{background:var(--bg1);border:1px solid var(--bd);border-radius:6px;padding:6px 9px}.kpi b{display:block;font:800 var(--fs-xl) Unbounded,sans-serif;color:var(--acc)}.kpi span{color:var(--t3);font-size:var(--fs-xs)}
.chip{display:inline-block;border:1px solid var(--bd);border-radius:999px;padding:0 7px;font-size:var(--fs-2xs);color:var(--t2);white-space:nowrap;line-height:1.7}.chip.suc{color:var(--suc);border-color:var(--suc)}.chip.inf{color:var(--inf);border-color:var(--inf)}.chip.wrn{color:var(--wrn);border-color:var(--wrn)}.chip.dng{color:var(--dng);border-color:var(--dng)}
.tw{overflow-x:auto;border:1px solid var(--bd);border-radius:6px;margin:6px 0}table{border-collapse:collapse;width:100%;min-width:760px}th{background:var(--bg2);color:var(--t3);font:700 var(--fs-2xs) Manrope,sans-serif;letter-spacing:.08em;text-transform:uppercase;text-align:left;padding:5px 8px}td{border-top:1px solid var(--bd);padding:5px 8px;vertical-align:top}tr.r-open td{background:color-mix(in srgb,var(--wrn) 8%,transparent)}tr.r-drop td{opacity:.75}
details{margin:6px 0}summary{cursor:pointer;color:var(--t3);font:700 var(--fs-xs) Manrope,sans-serif}
.wire{border:1px solid var(--bd);border-radius:8px;background:var(--bg1);padding:8px 10px;margin:8px 0}.wt{font:800 var(--fs-md) Unbounded,sans-serif;margin-bottom:6px}.whead{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--bd);padding-bottom:6px;margin-bottom:6px}.wf{border:1px solid var(--bd);border-radius:999px;padding:1px 8px;font-size:var(--fs-xs);color:var(--t2);margin:1px}.wf.ed{color:var(--acc);border-color:var(--acc)}
.wgrid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:8px}@media(max-width:700px){.wgrid{grid-template-columns:1fr}}.wbody,.wpart,.wsec{border:1px dashed var(--bd);border-radius:6px;padding:6px 8px;margin-bottom:6px}.wsh{color:var(--t3);font:700 var(--fs-2xs) Manrope,sans-serif;letter-spacing:.08em;text-transform:uppercase;margin-bottom:3px}.wcols{display:flex;gap:4px;flex-wrap:wrap}.wcols span{background:var(--bg3);border-radius:4px;padding:0 6px;font:400 var(--fs-xs) var(--mono);color:var(--t2)}.wcols .opt{color:var(--t3);background:none}.wtabs{color:var(--t3);font-size:var(--fs-xs)}.wtab{border-bottom:2px solid var(--acc);color:var(--t1);margin:0 6px}`;

const JS = `(function(){function show(){var id=(location.hash||'').replace('#/','')||document.querySelector('.page').dataset.page;document.querySelectorAll('.page').forEach(function(p){p.hidden=p.dataset.page!==id});document.querySelectorAll('.nav a').forEach(function(a){a.classList.toggle('on',a.getAttribute('href')==='#/'+id)});window.scrollTo(0,0)}window.addEventListener('hashchange',show);show()})();`;

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Модель LORE после переноса — результат</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@800&family=Manrope:wght@400;700&family=IBM+Plex+Mono&display=swap" rel="stylesheet"><style>${CSS}</style></head><body>
<div class="top"><div class="nav">${pages.map(p => `<a href="#/${esc(p.id)}">${esc(p.title)}</a>`).join('')}<a href="#/universal">Общие поля</a></div></div>
<div class="wrap">${pages.map(p => p.html).join('')}${uniPage}</div><script>${JS}</script></body></html>`;

if (rendered !== expected) { console.error(`самопроверка: полей в картах ${expected}, строк на странице ${rendered}`); process.exit(1); }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(JSON.stringify({ out: OUT, objects: pages.length, fields: rendered, universal: Object.keys(UNI.fields).length, kb: Math.round(html.length / 1024) }));
