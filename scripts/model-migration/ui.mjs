#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Интерфейс установщика: диалог переноса в браузере.
// Слова владелицы 16.11.2026: «интерактивно в chrome покажи диалог миграции»; «у всех в данных будет своё
// и через HTML это странно»; «потом когда будешь готова для uat откроешь мне интерфейс с этой машинки как на
// линух так и на винде». Установщик сам поднимает страницу на 127.0.0.1 и строит диалог по данным своей
// установки; решения человека сразу пишутся в файл решений (--decisions) и переживают повторный перенос.
// Источник только читается; в новую базу эта команда не пишет.
// Запуск: lore-migrate ui --env <файл доступа> --decisions <файл решений> [--port 2499]
import fs from 'node:fs';
import http from 'node:http';
import { checkDecisions, FORMAT as DECISIONS_FORMAT } from './decisions.mjs';
import { EMPTY, groupBySuggestion } from './status-unify.mjs';

const blank = v => v === null || v === undefined || String(v).trim() === '';

/** Код решения — следующий свободный ST-NN. */
export function nextId(doc) {
  const n = (doc.decisions || []).map(d => /^ST-(\d+)$/.exec(d.id || '')).filter(Boolean).map(m => +m[1]);
  return 'ST-' + String((n.length ? Math.max(...n) : 0) + 1).padStart(2, '0');
}

/** Решение из формы интерфейса. Новый код — только с подписями на трёх языках; код статуса — заглавными. */
export function decisionFromForm(f, id, at) {
  if (blank(f.by)) throw new Error('не сказано, кто принял решение');
  if (!f.type || !f.field) throw new Error('не названы тип и поле');
  const scope = blank(f.value) ? { type: f.type, field: f.field, why: EMPTY } : { type: f.type, field: f.field, value: f.value };
  const d = { id, scope, action: f.action, by: String(f.by).trim(), at, note: 'принято в интерфейсе установщика' };
  if (f.action === 'map_to' || f.action === 'add_code') {
    if (blank(f.to)) throw new Error('не выбран код');
    d.to = String(f.to).trim().toUpperCase();
  }
  if (f.action === 'add_code') {
    for (const l of ['ru', 'en', 'pl']) if (blank((f.labels || {})[l])) throw new Error(`у нового кода нет подписи на языке ${l}`);
    d.labels = { ru: f.labels.ru.trim(), en: f.labels.en.trim(), pl: f.labels.pl.trim() };
  }
  if (!['map_to', 'add_code', 'defer'].includes(f.action)) throw new Error(`действие «${f.action}» в диалоге статусов не предусмотрено`);
  return d;
}

const sameScope = (a, b) => a.type === b.type && a.field === b.field && a.value === b.value && a.why === b.why;

/** Добавить решение; решение по той же области заменяет прежнее (код прежнего сохраняется). */
export function addDecision(doc, form, at = new Date().toISOString()) {
  const list = [...(doc.decisions || [])];
  const probe = decisionFromForm(form, 'ST-00', at);
  const i = list.findIndex(d => sameScope(d.scope, probe.scope));
  const d = decisionFromForm(form, i >= 0 ? list[i].id : nextId(doc), at);
  if (i >= 0) list[i] = d; else list.push(d);
  const next = { ...doc, format: doc.format || DECISIONS_FORMAT, decisions: list };
  const bad = checkDecisions(next);
  if (bad.length) throw new Error(bad.join('; '));
  return next;
}

const PAGE = String.raw`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LORE · перенос на новую модель</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@800&family=Manrope:wght@400;700&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light;--bg0:#faf6ee;--bg1:#ffffff;--bg2:#f1eadc;--bd:#dccfb8;--t1:#2a2218;--t2:#5f5343;--t3:#7a6d5a;--acc:#a8660a;--suc:#3f7a2c;--wrn:#a8660a;--inf:#2f6a94;--dng:#b23a26;--mono:'IBM Plex Mono',ui-monospace,monospace;--fs-2xs:10px;--fs-xs:11px;--fs-sm:12px;--fs-md:13px;--fs-lg:15px;--fs-xl:20px;--fs-2xl:24px}
:root[data-theme=dark]{color-scheme:dark;--bg0:#141108;--bg1:#1c1810;--bg2:#252019;--bd:#42382a;--t1:#ede5d0;--t2:#a6997f;--t3:#9c937b;--acc:#d4a24a;--suc:#7dbf78;--wrn:#d4922a;--inf:#88b8a8;--dng:#cf6c5e}
*{box-sizing:border-box}body{margin:0;background:var(--bg0);color:var(--t1);font:400 var(--fs-sm)/1.45 Manrope,system-ui,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:10px 12px 60px}h1,h2,h3{font-family:Unbounded,Manrope,sans-serif;font-weight:800;margin:14px 0 6px}h1{font-size:var(--fs-2xl);color:var(--acc)}h2{font-size:var(--fs-lg);border-bottom:1px solid var(--bd);padding-bottom:4px}h3{font-size:var(--fs-md);margin:10px 0 4px}
.top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.sub{color:var(--t3);font-size:var(--fs-xs)}code,.mono{font-family:var(--mono);font-size:var(--fs-xs)}
.btn{background:var(--bg1);border:1px solid var(--acc);color:var(--acc);border-radius:999px;padding:3px 11px;font:700 var(--fs-xs) Manrope,sans-serif;cursor:pointer}.btn.pri{background:var(--acc);color:var(--bg0)}.btn[disabled]{opacity:.45;cursor:default}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin:8px 0}.kpi{background:var(--bg1);border:1px solid var(--bd);border-radius:6px;padding:6px 9px}.kpi b{display:block;font:800 var(--fs-xl) Unbounded,sans-serif;color:var(--acc)}.kpi span{color:var(--t3);font-size:var(--fs-xs)}
.state{border-radius:6px;padding:7px 10px;margin:8px 0;border:1px solid var(--bd);background:var(--bg1)}.state.stop{border-left:4px solid var(--dng)}.state.go{border-left:4px solid var(--suc)}
.tw{overflow-x:auto;border:1px solid var(--bd);border-radius:6px;margin:6px 0;background:var(--bg1)}table{border-collapse:collapse;width:100%;min-width:720px}th{background:var(--bg2);color:var(--t3);font:700 var(--fs-2xs) Manrope,sans-serif;letter-spacing:.08em;text-transform:uppercase;text-align:left;padding:5px 8px}td{border-top:1px solid var(--bd);padding:5px 8px;vertical-align:middle}
.num{font-family:var(--mono);color:var(--wrn);text-align:right;width:60px}.val{font-family:var(--mono);font-size:var(--fs-xs)}.why{color:var(--t3);font-size:var(--fs-2xs)}
tr.grp td{background:var(--bg2);font-weight:700}tr.done td{opacity:.6}
.dec{display:flex;gap:6px;align-items:center;flex-wrap:nowrap}.dec select{flex:1;min-width:160px}.newf{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}.newf[hidden]{display:none}.chip.ok{margin-bottom:4px}td:last-child{width:300px}td:nth-child(3){width:260px}
select,input{background:var(--bg0);color:var(--t1);border:1px solid var(--bd);border-radius:999px;padding:3px 8px;font:400 var(--fs-xs) Manrope,sans-serif}input.lbl{width:110px}
.chip{display:inline-block;border:1px solid var(--bd);border-radius:999px;padding:0 7px;font-size:var(--fs-2xs);color:var(--t2);white-space:nowrap}.chip.ok{color:var(--suc);border-color:var(--suc)}
.themesw{display:inline-flex;border:1px solid var(--acc);border-radius:999px;overflow:hidden}.themesw button{background:transparent;border:0;color:var(--acc);font:700 var(--fs-xs) Manrope,sans-serif;padding:3px 10px;cursor:pointer}.themesw button[aria-pressed=true]{background:var(--acc);color:var(--bg0)}
#msg{position:fixed;left:12px;right:12px;bottom:10px;background:var(--bg1);border:1px solid var(--acc);border-radius:6px;padding:6px 10px;display:none}#msg.err{border-color:var(--dng);color:var(--dng)}
</style></head><body><div class="wrap">
<div class="top"><h1>Перенос на новую модель</h1><span class="themesw"><button data-theme-set="light">Светлая</button><button data-theme-set="dark">Тёмная</button></span></div>
<div class="top"><span class="sub">источник <span class="mono" id="src">…</span> · только чтение · решения пишутся в файл решений этой установки</span>
<label class="sub">кто принимает решения <input id="by" placeholder="логин"></label>
<button class="btn" id="reload">Перепроверить</button><span class="sub" id="fp"></span></div>
<h2>Шаг 2. Унификация статусов</h2>
<p class="sub">В записи — код справочника (статусы заглавными); подписи на трёх языках — в справочнике. Предложение конвейера принимается кнопкой; группа — кнопкой в её заголовке. Пока есть строка без решения, перенос не начинается.</p>
<div id="state" class="state">загрузка…</div><div class="kpis" id="kpis"></div><div id="body"></div>
</div><div id="msg"></div>
<script>
(function(){
var K='lore-migrate-theme',B='lore-migrate-by',D=null,NAME={KnowSprintHist:'Спринт',KnowTaskHist:'Задача',KnowPhaseHist:'Фаза',KnowADRHist:'ADR',KnowDecisionHist:'Решение',KnowSpecHist:'Спека',KnowMilestoneHist:'Веха',KnowQuestion:'Вопрос',KnowUseCase:'Фича',QualityGate:'Гейт качества'};
function theme(t){document.documentElement.dataset.theme=t;document.querySelectorAll('[data-theme-set]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.themeSet===t))});try{localStorage.setItem(K,t)}catch(e){}}
try{theme(localStorage.getItem(K)||'light');document.getElementById('by').value=localStorage.getItem(B)||''}catch(e){theme('light')}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
function msg(t,err){var m=document.getElementById('msg');m.textContent=t;m.className=err?'err':'';m.style.display='block';clearTimeout(msg.t);msg.t=setTimeout(function(){m.style.display='none'},err?8000:3000)}
function load(){document.getElementById('state').textContent='читаю источник…';fetch('api/dialog').then(function(r){return r.json()}).then(function(d){if(d.error)throw new Error(d.error);D=d;draw()}).catch(function(e){document.getElementById('state').className='state stop';document.getElementById('state').textContent='не смогли прочитать: '+e.message})}
function draw(){var s=D.summary;document.getElementById('src').textContent=D.source;document.getElementById('fp').textContent='отпечаток итога '+D.fingerprint;
var st=document.getElementById('state');if(D.unread&&D.unread.length){st.className='state stop';st.textContent='СТОП: источник прочитан не весь ('+D.unread.length+' полей) — проверка не выполнена'}else if(D.ready){st.className='state go';st.textContent='ГОТОВО: статусы сведены, перенос можно начинать'}else{st.className='state stop';st.textContent='СТОП: ждут решения '+s.needs_decision+' значений ('+s.records_waiting+' записей) — перенос не начинается'}
document.getElementById('kpis').innerHTML=[[D.rows.length,'разных значений'],[s.unified,'свелось само'],[s.decided,'закрыто решением'],[s.needs_decision,'ждут решения'],[s.records_waiting,'записей за ними']].map(function(k){return '<div class="kpi"><b>'+k[0]+'</b><span>'+k[1]+'</span></div>'}).join('');
var html='';D.groups.forEach(function(t){html+='<h3>'+esc(NAME[t.type]||t.type)+' <span class="sub">'+esc(t.dict)+' · ждут '+t.waiting+'</span></h3><div class="tw"><table><thead><tr><th>Значение в старой базе</th><th>Записей</th><th>Предложение</th><th>Решение</th></tr></thead><tbody>';
t.groups.forEach(function(g){var ids=g.rows.filter(function(r){return r.state==='needs_decision'}).map(function(r){return r.i});html+='<tr class="grp"><td colspan="2">'+(g.code?'→ '+esc(g.code):'без предложения')+' · '+g.rows.length+' знач. · '+g.n+' зап.</td><td colspan="2">'+(g.code&&ids.length?'<button class="btn pri" data-group="'+ids.join(',')+'" data-to="'+esc(g.code)+'">Принять группу → '+esc(g.code)+'</button>':'')+'</td></tr>';
g.rows.forEach(function(r){var done=r.state!=='needs_decision';var opts=r.codes.map(function(c){return '<option'+(c===r.code?' selected':'')+'>'+esc(c)+'</option>'}).join('');
html+='<tr class="'+(done?'done':'')+'" data-i="'+r.i+'"><td><span class="val">'+(r.value==null?'<i>(пусто)</i>':esc(String(r.value).replace(/\s+/g,' ').slice(0,100)))+'</span></td><td class="num">'+r.n+'</td><td>'+(r.suggest&&!done?'<button class="btn" data-one="'+r.i+'" data-to="'+esc(r.suggest)+'">принять: '+esc(r.suggest)+'</button>':'')+'<div class="why">'+esc(r.suggestWhy||'')+'</div></td><td>'+(done?'<span class="chip ok">'+esc(r.decision?'решение '+r.decision+' → '+(r.code||'—'):'→ '+(r.code||'—'))+'</span> ':'')+'<div class="dec"><select data-sel="'+r.i+'"><option value="">— решение —</option><optgroup label="свести к коду">'+opts+'</optgroup><option value="@new">новый код…</option><option value="@defer">решу позже</option></select><button class="btn" data-apply="'+r.i+'">применить</button></div><div class="newf" data-newform="'+r.i+'" hidden><input class="lbl" placeholder="КОД" data-nc="'+r.i+'"> <input class="lbl" placeholder="подпись ru" data-l="ru'+r.i+'"> <input class="lbl" placeholder="подпись en" data-l="en'+r.i+'"> <input class="lbl" placeholder="подпись pl" data-l="pl'+r.i+'"> <button class="btn pri" data-addcode="'+r.i+'">добавить и свести</button></div></td></tr>'})});html+='</tbody></table></div>'});
document.getElementById('body').innerHTML=html}
function row(i){return D.flat[i]}
function by(){var v=document.getElementById('by').value.trim();try{localStorage.setItem(B,v)}catch(e){}return v}
function send(list){var who=by();if(!who){msg('Заполните «кто принимает решения» вверху страницы',true);document.getElementById('by').focus();return}
fetch('api/decisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(list.map(function(f){f.by=who;return f}))}).then(function(r){return r.json()}).then(function(d){if(d.error)throw new Error(d.error);D=d;draw();msg('Записано решений: '+list.length)}).catch(function(e){msg(e.message,true)})}
function form(i,action,to,labels){var r=row(i);return {type:r.type,field:r.field,value:r.value,action:action,to:to,labels:labels}}
document.addEventListener('change',function(e){var s=e.target.closest('select[data-sel]');if(s){var f=document.querySelector('[data-newform="'+s.dataset.sel+'"]');if(f)f.hidden=s.value!=='@new'}});
document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;
if(b.dataset.themeSet)return theme(b.dataset.themeSet);if(b.id==='reload')return load();
if(b.dataset.one)return send([form(+b.dataset.one,'map_to',b.dataset.to)]);
if(b.dataset.group)return send(b.dataset.group.split(',').map(function(i){return form(+i,'map_to',b.dataset.to)}));
if(b.dataset.apply){var i=b.dataset.apply,v=document.querySelector('[data-sel="'+i+'"]').value;if(!v)return msg('Выберите решение в списке',true);
if(v==='@defer')return send([form(+i,'defer')]);if(v==='@new'){document.querySelector('[data-newform="'+i+'"]').hidden=false;return}
return send([form(+i,'map_to',v)])}
if(b.dataset.addcode){var i=b.dataset.addcode,q=function(s){return document.querySelector(s).value};return send([form(+i,'add_code',q('[data-nc="'+i+'"]'),{ru:q('[data-l="ru'+i+'"]'),en:q('[data-l="en'+i+'"]'),pl:q('[data-l="pl'+i+'"]')})])}
});
load()})();
</script></body></html>`;

/** Диалог для страницы: строки с номерами, сгруппированные по типу и по предложению. */
function forPage(dialog, rules) {
  // у закрытых строк список кодов тоже нужен: решение можно переиграть
  const flat = dialog.rows.map((r, i) => ({ ...r, i, codes: r.codes || (r.dict ? rules.dictionaries[r.dict].codes.map(c => c.code) : []) }));
  const byType = new Map();
  for (const r of flat) if (r.state === 'needs_decision' || r.state === 'decided') (byType.get(r.type) || byType.set(r.type, []).get(r.type)).push(r);
  const groups = [...byType.entries()].map(([type, rows]) => ({
    type, dict: rows[0].dict, waiting: rows.filter(r => r.state === 'needs_decision').length,
    groups: groupBySuggestion(rows),
  }));
  return { ...dialog, flat, groups };
}

export async function serve({ port = 2499 } = {}) {
  const [{ connect }, { RULES }, { collectStatusDialog }] = await Promise.all([import('./db.mjs'), import('./resources.mjs'), import('./status-run.mjs')]);
  const file = process.env.MIG_DECISIONS_FILE;
  if (!file) throw new Error('не указан файл решений: --decisions <файл> (создастся, если его нет)');
  const readDoc = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { format: DECISIONS_FORMAT, decisions: [] });
  const db = connect();
  let cache = null;
  const dialog = async (fresh) => {
    if (!cache || fresh) cache = forPage(await collectStatusDialog(db, RULES, readDoc()), RULES);
    return cache;
  };
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
      if (req.method === 'GET' && req.url === '/api/dialog') return json(res, 200, await dialog(true));
      if (req.method === 'POST' && req.url === '/api/decisions') {
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 1e6) throw new Error('слишком большой запрос'); }
        const forms = JSON.parse(body);
        let doc = readDoc();
        for (const f of Array.isArray(forms) ? forms : [forms]) doc = addDecision(doc, f);
        fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
        return json(res, 200, await dialog(true));
      }
      json(res, 404, { error: 'нет такой страницы' });
    } catch (e) { json(res, 400, { error: e.message }); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  console.log(`интерфейс переноса: http://127.0.0.1:${port}/  (только с этой машины; остановить — Ctrl+C)`);
  console.log(`файл решений: ${file}`);
  return server;
}

const portArg = process.argv.indexOf('--port');
if (process.argv[1] === 'ui') serve({ port: portArg > 0 ? +process.argv[portArg + 1] : 2499 }).catch(e => { console.error('ошибка: ' + e.message); process.exitCode = 1; });
