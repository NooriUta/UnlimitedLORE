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
import { EMPTY, groupBySuggestion, statusDictOf } from './status-unify.mjs';
import { fingerprint } from './fingerprint.mjs';
import path from 'node:path';
import { buildReport } from './report.mjs';
import crypto from 'node:crypto';
import { kcConfig, pkce, authUrl, exchange, tokenClaims, ownerInDb, verdict } from './auth.mjs';

const blank = v => v === null || v === undefined || String(v).trim() === '';

/** Код решения — следующий свободный ST-NN. */
export function nextId(doc) {
  const n = (doc.decisions || []).map(d => /^ST-(\d+)$/.exec(d.id || '')).filter(Boolean).map(m => +m[1]);
  return 'ST-' + String((n.length ? Math.max(...n) : 0) + 1).padStart(2, '0');
}

/** Решение из формы интерфейса. Новый код — только с подписями на трёх языках. Регистр кода — по виду
 *  справочника поля (caseOf(scope) → 'upper'|'lower'; правило владелицы 16.11.2026: «статусная модель uppercase,
 *  остальные в lower»). Без caseOf — заглавными, как раньше. */
export function decisionFromForm(f, id, at, caseOf = () => 'upper') {
  if (blank(f.by)) throw new Error('не сказано, кто принял решение');
  if (!f.type || !f.field) throw new Error('не названы тип и поле');
  const scope = blank(f.value) ? { type: f.type, field: f.field, why: EMPTY } : { type: f.type, field: f.field, value: f.value };
  const d = { id, scope, action: f.action, by: String(f.by).trim(), at, note: 'принято в интерфейсе установщика' };
  if (f.action === 'map_to' || f.action === 'add_code') {
    if (blank(f.to)) throw new Error('не выбран код');
    const t = String(f.to).trim();
    d.to = caseOf(d.scope) === 'lower' ? t.toLowerCase() : t.toUpperCase();
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
export function addDecision(doc, form, at = new Date().toISOString(), caseOf) {
  const list = [...(doc.decisions || [])];
  const probe = decisionFromForm(form, 'ST-00', at, caseOf);
  const i = list.findIndex(d => sameScope(d.scope, probe.scope));
  const d = decisionFromForm(form, i >= 0 ? list[i].id : nextId(doc), at, caseOf);
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
.steps{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.steps a{text-decoration:none;color:var(--t2);border:1px solid var(--bd);border-radius:999px;padding:4px 12px;font-size:var(--fs-xs);background:var(--bg1)}.steps a b{color:var(--acc);margin-right:4px}.steps a.on{background:var(--acc);border-color:var(--acc);color:var(--bg0)}.steps a.on b{color:var(--bg0)}
.guide{border:1px solid var(--bd);border-left:3px solid var(--acc);border-radius:6px;background:var(--bg1);padding:6px 12px;margin:10px 0}.guide summary{cursor:pointer;padding:4px 0}.guide p,.guide li{color:var(--t1);margin:4px 0}.guide ol,.guide ul{padding-left:20px}
.cfg{min-width:0}.cfg td,.cfg th{border:0;padding:3px 6px}.cfg input{width:100%;border-radius:6px}
select,input{background:var(--bg0);color:var(--t1);border:1px solid var(--bd);border-radius:999px;padding:3px 8px;font:400 var(--fs-xs) Manrope,sans-serif}input.lbl{width:110px}
.chip{display:inline-block;border:1px solid var(--bd);border-radius:999px;padding:0 7px;font-size:var(--fs-2xs);color:var(--t2);white-space:nowrap}.chip.ok{color:var(--suc);border-color:var(--suc)}
.themesw{display:inline-flex;border:1px solid var(--acc);border-radius:999px;overflow:hidden}.themesw button{background:transparent;border:0;color:var(--acc);font:700 var(--fs-xs) Manrope,sans-serif;padding:3px 10px;cursor:pointer}.themesw button[aria-pressed=true]{background:var(--acc);color:var(--bg0)}
#msg{position:fixed;left:12px;right:12px;bottom:10px;background:var(--bg1);border:1px solid var(--acc);border-radius:6px;padding:6px 10px;display:none}#msg.err{border-color:var(--dng);color:var(--dng)}
</style></head><body><div class="wrap">
<div class="top"><h1>Перенос на новую модель</h1><span class="themesw"><button data-theme-set="light">Светлая</button><button data-theme-set="dark">Тёмная</button></span></div>
<div class="top"><span class="sub">источник <span class="mono" id="src">…</span> · только чтение · решения пишутся в файл решений этой установки</span>
<label class="sub">кто принимает решения <input id="by" placeholder="логин"></label>
<span class="sub" id="who"></span> <button class="btn" id="reload">Перепроверить</button><span class="sub" id="fp"></span></div>
<nav class="steps" id="steps">
<a href="#step-0" data-step="0"><b>0</b> Вход</a>
<a href="#step-1" data-step="1"><b>1</b> Подключение</a>
<a href="#step-2" data-step="2"><b>2</b> Статусы</a>
<a href="#step-3" data-step="3"><b>3</b> Пробный расчёт</a>
<a href="#step-4" data-step="4"><b>4</b> Перенос</a>
<a href="#step-5" data-step="5"><b>5</b> Сверка и отчёт</a>
</nav>
<section data-page="0" hidden><h2>Шаг 0. Вход и проверка владельца</h2>
<p class="sub">Укажите сервер Keycloak и область входа, затем войдите. Дальше пускает, только если сошлись обе проверки: в токене есть роль владельца, и в базе этой установки у вашей учётки роль владельца проекта.</p>
<div id="s0">загрузка…</div>
<details class="guide" open><summary><b>Инструкция: как проходит перенос и что делать на каждом шаге</b></summary>
<h3>Что делает установщик</h3>
<p>Переносит данные LORE в новую базу по новой модели. Действующая база не меняется: установщик читает её копию (снимок из бэкапа) и собирает рядом новую. Старая база остаётся откатом; сколько её хранить, решает владелец установки.</p>
<h3>Что подготовить до запуска</h3>
<ol>
<li><b>Файл доступа</b> — текстовый файл <code>КЛЮЧ=значение</code>, его путь передаётся ключом <code>--env</code>. Нужны: <code>MIG_DB_URL</code> (сервер ArcadeDB), <code>MIG_SRC_DB</code> (база-источник — снимок), <code>MIG_SRC_USER</code>/<code>MIG_SRC_PASSWORD</code>, <code>MIG_DST_DB</code> (новая база, имя начинается с <code>migration_dst</code>), <code>MIG_DST_USER</code>/<code>MIG_DST_PASSWORD</code>. Если новая база на другом сервере — <code>MIG_DST_URL</code>. Для входа: <code>MIG_KC_URL</code>, <code>MIG_KC_REALM</code>, <code>MIG_KC_CLIENT</code>, <code>MIG_OWNER_PROJECT</code>. Пароли установщик нигде не показывает и не пишет.</li>
<li><b>Файл решений</b> — путь ключом <code>--decisions</code>. Если файла нет, он создастся; в него пишутся ваши решения, и при повторном переносе они применяются сами.</li>
<li><b>Место на сервере</b> — на снимок и на новую базу, примерно два размера действующей базы.</li>
</ol>
<h3>Шаги</h3>
<ol start="0">
<li><b>Вход.</b> Укажите сервер Keycloak и область, нажмите «Войти». Пускает дальше, только если сошлись обе проверки: в токене есть роль владельца, и в базе этой установки ваша учётка — владелец проекта. Если не сошлось — страница скажет, что именно.</li>
<li><b>Подключение.</b> Посмотрите, что установщик видит: сервер, база-источник (только чтение), новая база и сколько записей каждого типа в источнике. Если чего-то нет — поправьте файл доступа и перезапустите установщик.</li>
<li><b>Статусы.</b> Главная работа человека. Каждое значение статуса из старой базы, которое установщик не узнал сам, — строка. У многих строк есть предложение с причиной: «принять» берёт его, «Принять группу» — сразу всю группу. В списке можно выбрать другой код, добавить новый (подписи на русском, английском и польском обязательны) или «решу позже». Пока есть строка без решения, перенос не начинается.</li>
<li><b>Пробный расчёт.</b> «Посчитать» — каждая запись проходит через карту переноса, но в новую базу ничего не пишется. Смотрите, что не привелось, что удержано до решения и какие поля карта не знает.</li>
<li><b>Перенос.</b> Откроется, когда на шаге 2 не осталось строк без решения. Поставьте галочку «понимаю: новая база будет очищена» и нажмите «Перенести». Ход виден на странице; занимает несколько минут.</li>
<li><b>Сверка и отчёт.</b> Итог сверки записей, связей и справочников и отпечаток новой базы. Отчёт сохраняется файлом рядом с файлом решений и открывается ссылкой. Если сверка не сошлась — перенос считается не выполненным: смотрите отчёт, возвращайтесь к шагам 2–3.</li>
</ol>
<h3>Как сверить две установки</h3>
<p>Два переноса из одного снимка с одним файлом решений дают один и тот же отпечаток новой базы — на Windows и на Linux. Разные решения дают разный отпечаток.</p>
<h3>Если что-то пошло не так</h3>
<ul>
<li>«Источник прочитан не весь» — сервер не ответил или отказал: проверьте адрес и учётку в файле доступа.</li>
<li>«Нужен вход» — сессия входа истекла: вернитесь на шаг 0.</li>
<li>Перенос можно запускать повторно: новая база очищается и собирается заново, источник не меняется.</li>
</ul>
</details></section>
<section data-page="1" hidden><h2>Шаг 1. Подключение и базы</h2>
<p class="sub">Что установщик видит: сервер и базу-источник (только чтение) и сервер новой базы. Адреса и учётки — в файле доступа этой установки; значения учёток не показываются.</p>
<div class="tw" style="padding:8px"><form id="cf" autocomplete="off">
<table class="cfg"><tr><th></th><th>Источник (только чтение)</th><th>Новая база</th></tr>
<tr><td>Сервер ArcadeDB</td><td><input name="MIG_DB_URL" size="34"></td><td><input name="MIG_DST_URL" size="34" placeholder="пусто — тот же сервер"></td></tr>
<tr><td>База</td><td><input name="MIG_SRC_DB" size="34"></td><td><input name="MIG_DST_DB" size="34" placeholder="migration_dst…"></td></tr>
<tr><td>Пользователь</td><td><input name="MIG_SRC_USER"></td><td><input name="MIG_DST_USER"></td></tr>
<tr><td>Пароль</td><td><input name="MIG_SRC_PASSWORD" type="password" autocomplete="new-password"></td><td><input name="MIG_DST_PASSWORD" type="password" autocomplete="new-password"></td></tr></table>
<p class="sub">Пароль не показывается. Пустое поле пароля — оставить прежний. Сохраняется в файл доступа <span class="mono" id="envfile"></span>.</p>
<div class="top"><button type="button" class="btn" id="ctest">Проверить подключение</button><button type="button" class="btn pri" id="csave">Сохранить</button><button type="button" class="btn" id="ccreate">Создать новую базу</button></div>
<div id="cres" class="sub"></div></form></div>
<div id="s1">загрузка…</div></section>
<section data-page="2" hidden><h2>Шаг 2. Унификация статусов</h2>
<p class="sub">В записи — код справочника (статусы заглавными); подписи на трёх языках — в справочнике. Предложение конвейера принимается кнопкой; группа — кнопкой в её заголовке. Пока есть строка без решения, перенос не начинается.</p>
<div id="state" class="state">загрузка…</div><div class="kpis" id="kpis"></div><div id="body"></div></section>
<section data-page="3" hidden><h2>Шаг 3. Пробный расчёт без записи</h2>
<p class="sub">Каждая запись источника проходит через карту переноса; в новую базу ничего не пишется. Здесь — что не привелось, что удержано до решения и поля, которых карта не знает. Пока описаны спринт, фаза и задача.</p>
<div id="s3"><button class="btn pri" id="run3">Посчитать</button> <span class="sub">чтение всего источника, около минуты</span></div></section>
<section data-page="4" hidden><h2>Шаг 4. Перенос</h2>
<p class="sub">Записи с версиями, затем связи — в новую базу; сразу за ними сверка. Источник только читается. Новая база перед переносом очищается: удаляются только типы этого переноса.</p>
<div id="s4gate" class="state">проверяю, можно ли начинать…</div>
<div class="top"><label class="sub"><input type="checkbox" id="ack"> понимаю: новая база <span class="mono" id="dstname">…</span> будет очищена и собрана заново</label> <button class="btn pri" id="run4" disabled>Перенести</button></div>
<pre id="log" class="tw" style="padding:8px;max-height:360px;overflow:auto;font:var(--fs-xs) var(--mono);white-space:pre-wrap" hidden></pre></section>
<section data-page="5" hidden><h2>Шаг 5. Сверка и отчёт</h2>
<p class="sub">Сверка источника с новой базой (записи и связи) и отпечаток содержимого новой базы. Две новые базы, собранные с одинаковыми настройками из одного источника, дают один отпечаток — так сверяются прогоны на разных машинах.</p>
<div id="s5" class="state">переноса в этом запуске ещё не было</div>
<div class="top"><button class="btn" id="run5">Посчитать отпечаток новой базы</button></div></section>
</div><div id="msg"></div>
<script>
(function(){
var K='lore-migrate-theme',B='lore-migrate-decider',D=null,NAME={KnowSprintHist:'Спринт',KnowTaskHist:'Задача',KnowPhaseHist:'Фаза',KnowADRHist:'ADR',KnowDecisionHist:'Решение',KnowSpecHist:'Спека',KnowMilestoneHist:'Веха',KnowQuestion:'Вопрос',KnowUseCase:'Фича',QualityGate:'Гейт качества'};
function theme(t){document.documentElement.dataset.theme=t;document.querySelectorAll('[data-theme-set]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.themeSet===t))});try{localStorage.setItem(K,t)}catch(e){}}
try{theme(localStorage.getItem(K)||'light');document.getElementById('by').value=localStorage.getItem(B)||''}catch(e){theme('light')}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
function msg(t,err){var m=document.getElementById('msg');m.textContent=t;m.className=err?'err':'';m.style.display='block';clearTimeout(msg.t);msg.t=setTimeout(function(){m.style.display='none'},err?8000:3000)}
function load(){document.getElementById('state').textContent='читаю источник…';fetch('api/dialog').then(function(r){return r.json()}).then(function(d){if(d.error)throw new Error(d.error);D=d;draw();gate()}).catch(function(e){document.getElementById('state').className='state stop';document.getElementById('state').textContent='не смогли прочитать: '+e.message})}
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
var ME=null;
function auth(){fetch('api/me').then(function(r){return r.json()}).then(function(d){ME=d;var el=document.getElementById('s0'),byl=document.getElementById('by').closest('label');
if(!d.configured){el.innerHTML='<div class="state stop">Вход не настроен: в файле доступа нет адреса Keycloak, области, клиента или проекта-владельца (MIG_KC_URL, MIG_KC_REALM, MIG_KC_CLIENT, MIG_OWNER_PROJECT). Режим разработки: решения подписываются полем «кто принимает решения».</div>';return}
byl.hidden=true;
if(d.me){el.innerHTML='<div class="state go">Вы вошли как <b>'+esc(d.me.login)+'</b> через '+esc(d.me.kc)+' · область '+esc(d.me.realm)+'. Владелец проекта '+esc(d.me.project)+' — проверено по Keycloak и по базе.</div>';document.getElementById('who').textContent='вошли: '+d.me.login;return}
el.innerHTML='<form action="auth/start" method="get" class="tw" style="padding:8px"><label class="sub">сервер Keycloak <input name="url" size="40" value="'+esc(d.kc.url)+'"></label> <label class="sub">область <input name="realm" value="'+esc(d.kc.realm)+'"></label> <button class="btn pri">Войти</button><div class="sub">клиент '+esc(d.kc.client)+' · проект-владелец '+esc(d.kc.project)+' · роль '+esc(d.kc.role)+'</div></form>';
if(stepFromHash()!=='0')location.hash='#step-0'})}
function step(n){n=String(n||1);document.querySelectorAll('section[data-page]').forEach(function(s){s.hidden=s.dataset.page!==n});document.querySelectorAll('#steps a').forEach(function(a){a.classList.toggle('on',a.dataset.step===n)});if(n==='1'&&!step.c1){step.c1=1;conn()}}
function stepFromHash(){var m=/^#step-(\d)$/.exec(location.hash);return m?m[1]:'0'}
window.addEventListener('hashchange',function(){step(stepFromHash())});
function cform(){var f=document.getElementById('cf'),o={};Array.prototype.forEach.call(f.elements,function(x){if(x.name)o[x.name]=x.value});return o}
function cfill(v){var f=document.getElementById('cf');Object.keys(v).forEach(function(k){var x=f.elements[k];if(!x)return;if(x.type==='password'){x.value='';x.placeholder=v[k]==='задан'?'задан — пусто, чтобы не менять':'не задан'}else x.value=v[k]})}
function cshow(d){var p=[];if(d.errors&&d.errors.length)p.push('<b style="color:var(--dng)">'+d.errors.map(esc).join('; ')+'</b>');if(d.src)p.push('источник: '+(d.src.ok?'<span class="chip ok">отвечает, типов '+d.src.types+'</span>':'<span class="chip">'+esc(d.src.why)+'</span>'));if(d.dst)p.push('новая база: '+(d.dst.ok?(d.dst.exists?'<span class="chip ok">есть</span>':'<span class="chip">сервер отвечает, базы ещё нет — «Создать новую базу»</span>'):'<span class="chip">'+esc(d.dst.why)+'</span>'));if(d.saved)p.unshift('<span class="chip ok">сохранено</span>');if(d.created)p.unshift('<span class="chip ok">создана '+esc(d.created)+'</span>');document.getElementById('cres').innerHTML=p.join(' · ')}
function cpost(u,b){document.getElementById('cres').textContent='…';return fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(function(r){return r.json()}).then(function(d){if(d.error){msg(d.error,true);document.getElementById('cres').textContent=d.error;return}if(d.values)cfill(d.values);cshow(d);if(d.saved||d.created){step.c1=0;conn();load()}})}
fetch('api/settings').then(function(r){return r.json()}).then(function(d){if(d.values){cfill(d.values);document.getElementById('envfile').textContent=d.file||''}}).catch(function(){});
document.addEventListener('click',function(e){var id=e.target.id;if(id==='ctest')cpost('api/settings/test',cform());if(id==='csave')cpost('api/settings/save',cform());if(id==='ccreate')cpost('api/settings/create-dst')});
function conn(){fetch('api/connect').then(function(r){return r.json()}).then(function(d){if(d.error)throw new Error(d.error);
var h='<div class="tw"><table><tbody><tr><td>Сервер источника</td><td class="mono">'+esc(d.srcUrl)+'</td></tr><tr><td>База-источник</td><td class="mono">'+esc(d.srcDb)+' <span class="chip">только чтение</span></td></tr><tr><td>Сервер новой базы</td><td class="mono">'+esc(d.dstUrl)+'</td></tr><tr><td>Новая база</td><td class="mono">'+esc(d.dstDb)+' '+(d.dstError?'<span class="chip">не прочитана: '+esc(d.dstError)+'</span>':'<span class="chip ok">есть, типов '+d.dstTypes+'</span>')+'</td></tr></tbody></table></div>';
h+='<h3>Источник: записей по типам</h3><div class="tw"><table><thead><tr><th>Тип</th><th>Записей</th></tr></thead><tbody>'+d.src.map(function(t){return '<tr><td class="mono">'+esc(t.name)+'</td><td class="num">'+t.records+'</td></tr>'}).join('')+'</tbody></table></div>';
document.getElementById('s1').innerHTML=h}).catch(function(e){document.getElementById('s1').innerHTML='<div class="state stop">не смогли прочитать: '+esc(e.message)+'</div>'})}
function dry(){var el=document.getElementById('s3');el.innerHTML='<div class="state">считаю…</div>';fetch('api/dryrun').then(function(r){return r.json()}).then(function(d){if(d.error)throw new Error(d.error);
var h='<div class="sub">отпечаток итога '+esc(d.fingerprint)+' · <button class="btn" id="run3">Посчитать заново</button></div>';
Object.keys(d.types).forEach(function(T){var t=d.types[T],rej=Object.keys(t.rejects),held=Object.keys(t.held),unk=Object.keys(t.unknown);
h+='<h3>'+esc(T)+' <span class="sub">записей '+t.records+' · не привелось '+rej.reduce(function(a,k){return a+t.rejects[k].n},0)+' · удержано '+held.reduce(function(a,k){return a+t.held[k]},0)+' · полей вне карты '+unk.length+'</span></h3>';
if(rej.length||held.length||unk.length){h+='<div class="tw"><table><thead><tr><th>Что</th><th>Поле и причина</th><th>Записей</th><th>Примеры</th></tr></thead><tbody>';
rej.forEach(function(k){var e=t.rejects[k];h+='<tr><td>не привелось</td><td>'+esc(k)+'</td><td class="num">'+e.n+'</td><td class="why">'+Object.keys(e.samples).slice(0,4).map(function(s){return '«'+esc(s)+'»'}).join(', ')+'</td></tr>'});
held.forEach(function(k){h+='<tr><td>удержано</td><td>'+esc(k)+' — по полю нет решения</td><td class="num">'+t.held[k]+'</td><td></td></tr>'});
unk.forEach(function(k){h+='<tr><td>вне карты</td><td>'+esc(k)+'</td><td class="num">'+t.unknown[k]+'</td><td></td></tr>'});h+='</tbody></table></div>'}});
el.innerHTML=h}).catch(function(e){el.innerHTML='<div class="state stop">не посчитано: '+esc(e.message)+'</div><button class="btn pri" id="run3">Посчитать</button>'})}
document.addEventListener('click',function(e){if(e.target.id==='run3')dry()});
function gate(){if(!D)return;var g=document.getElementById('s4gate'),b=document.getElementById('run4');var stop=D.unread&&D.unread.length?'источник прочитан не весь':(!D.ready?'на шаге 2 ждут решения '+D.summary.needs_decision+' значений ('+D.summary.records_waiting+' записей)':'');
g.className='state '+(stop?'stop':'go');g.textContent=stop?'СТОП: '+stop+' — перенос не начинается':'Можно переносить: статусы сведены';b.disabled=!!stop||!document.getElementById('ack').checked}
document.addEventListener('change',function(e){if(e.target.id==='ack')gate()});
function job(){fetch('api/job').then(function(r){return r.json()}).then(function(j){var l=document.getElementById('log');if(j.lines&&j.lines.length){l.hidden=false;l.textContent=j.lines.join('\n');l.scrollTop=l.scrollHeight}
if(j.running){var s5=document.getElementById('s5');s5.className='state';s5.textContent='идёт '+(j.what==='transfer'?'перенос':'подсчёт отпечатка')+' — строк хода: '+j.lines.length+'; итог появится здесь';setTimeout(job,2000);return}if(j.result)res5(j.result);if(j.error)msg(j.error,true)})}
function res5(r){var el=document.getElementById('s5');var only=r.what!=='transfer';el.className='state '+(only?'':(r.ok?'go':'stop'));el.innerHTML=(only?'Посчитан только отпечаток: переноса и сверки в этот раз не было':(r.ok?'Сошлось':'НЕ сошлось')+': записи — '+(r.records?'сверка прошла':'расхождение')+', связи — '+(r.edges?'сверка прошла':'расхождение'))+(r.fingerprint?' · отпечаток содержимого <b class="mono">'+esc(r.fingerprint)+'</b>':'')+(r.reportFile?' · <a href="report.html" target="_blank">открыть отчёт</a> <span class="sub">'+esc(r.reportFile)+'</span>':'')+(r.types?'<div class="sub">'+Object.keys(r.types).map(function(k){return esc(k)+' '+r.types[k].n}).join(' · ')+'</div>':'')}
document.addEventListener('click',function(e){if(e.target.id==='run4'){fetch('api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({what:'transfer'})}).then(function(r){return r.json()}).then(function(d){if(d.error)return msg(d.error,true);msg('Перенос начат');job()})}
if(e.target.id==='run5'){fetch('api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({what:'fingerprint'})}).then(function(r){return r.json()}).then(function(d){if(d.error)return msg(d.error,true);location.hash='#step-5';job()})}});
auth();step(stepFromHash());load();job();fetch('api/connect').then(function(r){return r.json()}).then(function(c){if(c.dstDb)document.getElementById('dstname').textContent=c.dstDb}).catch(function(){})})();
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
  const [{ connect }, { RULES }, { collectStatusDialog }, { dryRun }, { dstUrl, updateEnvText, parseEnv, checkEnv, publicView }, { transfer }, { transferEdges }, { dstFingerprint }] = await Promise.all([import('./db.mjs'), import('./resources.mjs'), import('./status-run.mjs'), import('./dry-run.mjs'), import('./env.mjs'), import('./transfer.mjs'), import('./transfer-edges.mjs'), import('./dst-fingerprint.mjs')]);
  const envFile = process.env.MIG_ENV_FILE;
  // Одно задание за раз: перенос (записи → связи → отпечаток) или только отпечаток. Ход — строками, итог — объектом.
  let J = { running: false, lines: [], result: null, error: null };
  const runJob = async (what, decisionsDoc, who) => {
    J = { running: true, lines: [], result: null, error: null, what, started: new Date().toISOString() };
    const log = (...a) => J.lines.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    try {
      let records = null, edges = null, r = null, e = null;
      const dlg = what === 'transfer' ? await dialog(true) : null;
      if (what === 'transfer') {
        log('— записи и версии —');
        r = await transfer(db, decisionsDoc, { reset: true, log });
        records = r.stages.verify.ok;
        log('— связи —');
        e = await transferEdges(db, { log });
        edges = e.ok;
      }
      log('— отпечаток новой базы —');
      const fp = await dstFingerprint(db);
      log('отпечаток содержимого: ' + fp.total);
      J.result = { what, ok: what === 'transfer' ? records && edges : null, records, edges, fingerprint: fp.total, types: fp.types };
      if (what === 'transfer') {
        // Отчёт документом: в память для страницы и файлом рядом с файлом решений.
        const when = new Date().toISOString();
        J.reportHtml = buildReport({ when, who: who || 'не вошли (режим разработки)', source: db.env.MIG_SRC_DB, target: db.env.MIG_DST_DB,
          dialog: { summary: dlg.summary, fingerprint: dlg.fingerprint }, decisions: (decisionsDoc && decisionsDoc.decisions) || [], transfer: r, edges: e, fingerprint: fp });
        const out = path.join(path.dirname(file), `report-${db.env.MIG_DST_DB}-${when.slice(0, 19).replace(/[:T]/g, '-')}.html`);
        fs.writeFileSync(out, J.reportHtml, 'utf8');
        J.result.reportFile = out;
        log('отчёт: ' + out);
      }
    } catch (e) { J.error = e.message; log('ОШИБКА: ' + e.message); }
    J.running = false;
  };
  const file = process.env.MIG_DECISIONS_FILE;
  if (!file) throw new Error('не указан файл решений: --decisions <файл> (создастся, если его нет)');
  const readDoc = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { format: DECISIONS_FORMAT, decisions: [] });
  let db = connect();
  let cache = null;
  // Форма подключения: значения из формы поверх файла доступа; пустой пароль — прежний.
  const FORM_KEYS = ['MIG_DB_URL', 'MIG_SRC_DB', 'MIG_SRC_USER', 'MIG_SRC_PASSWORD', 'MIG_DST_URL', 'MIG_DST_DB', 'MIG_DST_USER', 'MIG_DST_PASSWORD'];
  const pickForm = b => Object.fromEntries(FORM_KEYS.filter(k => b[k] !== undefined).map(k => [k, String(b[k])]));
  const candidate = form => { const e = { ...db.env }; for (const [k, v] of Object.entries(form)) if (!(/PASSWORD/.test(k) && v === '')) e[k] = v.trim(); return e; };
  const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
  const probe = async e => {
    const out = { src: null, dst: null };
    try {
      const r = await fetch(e.MIG_DB_URL.replace(/\/+$/, '') + '/api/v1/query/' + encodeURIComponent(e.MIG_SRC_DB), { method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization: basic(e.MIG_SRC_USER, e.MIG_SRC_PASSWORD), 'Content-Type': 'application/json' }, body: JSON.stringify({ language: 'sql', command: 'SELECT count(*) AS n FROM schema:types' }) });
      out.src = r.ok ? { ok: true, types: (await r.json()).result[0].n } : { ok: false, why: 'сервер ответил ' + r.status };
    } catch (x) { out.src = { ok: false, why: 'нет ответа: ' + (x.cause && x.cause.code || x.name) }; }
    try {
      const r = await fetch(dstUrl(e).replace(/\/+$/, '') + '/api/v1/databases', { signal: AbortSignal.timeout(15000), headers: { Authorization: basic(e.MIG_DST_USER, e.MIG_DST_PASSWORD) } });
      out.dst = r.ok ? { ok: true, exists: (await r.json()).result.includes(e.MIG_DST_DB) } : { ok: false, why: 'сервер ответил ' + r.status };
    } catch (x) { out.dst = { ok: false, why: 'нет ответа: ' + (x.cause && x.cause.code || x.name) }; }
    return out;
  };
  const readBody = async req => { let b = ''; for await (const ch of req) { b += ch; if (b.length > 1e5) throw new Error('слишком большой запрос'); } return JSON.parse(b || '{}'); };
  const dialog = async (fresh) => {
    if (!cache || fresh) cache = forPage(await collectStatusDialog(db, RULES, readDoc()), RULES);
    return cache;
  };
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  // Шаг 0: вход через Keycloak и проверка владельца (auth.mjs). Не настроен в файле доступа — режим
  // разработки: страница так и пишет, решения подписываются полем «кто принимает решения».
  const kc = kcConfig(db.env);
  const pending = new Map(), sessions = new Map();
  const redirect = `http://127.0.0.1:${port}/auth/callback`;
  const sid = req => (/(?:^|;\s*)lmsid=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '') || [])[1];
  const me = req => sessions.get(sid(req)) || null;
  const server = http.createServer(async (req, res) => {
    try {
      const full = new URL(req.url, 'http://127.0.0.1');
      req.url = full.pathname; // путь без строки запроса: ?… не должен давать «нет такой страницы»
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
      if (req.method === 'GET' && req.url === '/api/me') {
        return json(res, 200, { configured: kc.configured, kc: { url: kc.url, realm: kc.realm, client: kc.client, project: kc.project, role: kc.role }, me: me(req) });
      }
      if (req.method === 'GET' && req.url === '/auth/start') {
        if (!kc.configured) return json(res, 400, { error: 'вход не настроен: в файле доступа нет MIG_KC_URL, MIG_KC_REALM, MIG_KC_CLIENT, MIG_OWNER_PROJECT' });
        // «в начале дать указать kc сервер»: адрес и область можно поправить на шаге 0; проект и роль — из файла.
        const use = { ...kc, url: full.searchParams.get('url') || kc.url, realm: full.searchParams.get('realm') || kc.realm };
        const p = pkce(), state = crypto.randomBytes(16).toString('base64url');
        pending.set(state, { verifier: p.verifier, kc: use, at: Date.now() });
        res.writeHead(302, { Location: authUrl(use, redirect, state, p.challenge) });
        return res.end();
      }
      if (req.method === 'GET' && req.url === '/auth/callback') {
        const st = pending.get(full.searchParams.get('state') || '');
        pending.delete(full.searchParams.get('state') || '');
        const page = (title, lines) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><body style="font:14px Manrope,system-ui;background:#faf6ee;color:#2a2218;padding:24px"><h2 style="color:#a8660a">${title}</h2>${lines.map(l => `<p>${String(l).replace(/</g, '&lt;')}</p>`).join('')}<p><a href="/#step-0">к шагу 0</a></p>`); };
        if (!st || Date.now() - st.at > 600000) return page('Вход не выполнен', ['состояние входа не найдено или устарело — начните вход заново']);
        if (full.searchParams.get('error')) return page('Вход не выполнен', [`Keycloak ответил: ${full.searchParams.get('error')}`]);
        const claims = tokenClaims(await exchange(st.kc, full.searchParams.get('code') || '', redirect, st.verifier));
        let owner = null;
        try { owner = await ownerInDb(db, claims.sub, kc.project); } catch { owner = null; }
        const v = verdict(claims, kc.role, owner, kc.project);
        if (!v.ok) return page('Дальше нельзя', [`Вошли как ${claims.login}.`, ...v.reasons]);
        const id = crypto.randomBytes(24).toString('base64url');
        sessions.set(id, { login: claims.login, sub: claims.sub, kc: st.kc.url, realm: st.kc.realm, project: kc.project });
        res.writeHead(302, { 'Set-Cookie': `lmsid=${id}; HttpOnly; SameSite=Strict; Path=/`, Location: '/#step-1' });
        return res.end();
      }
      if (kc.configured && req.url.startsWith('/api/') && !me(req)) return json(res, 401, { error: 'нужен вход: шаг 0' });
      if (req.method === 'GET' && req.url === '/api/dialog') return json(res, 200, await dialog(true));
      if (req.method === 'GET' && req.url === '/api/connect') {
        const src = (await db.src('SELECT name, type, records FROM schema:types')).filter(t => t.type === 'vertex' && t.records > 0).map(t => ({ name: t.name, records: t.records })).sort((a, b) => a.name.localeCompare(b.name));
        let dstTypes = null, dstError = null;
        try { dstTypes = (await db.dstQuery('SELECT count(*) AS n FROM schema:types'))[0].n; } catch (e) { dstError = e.message.slice(0, 120); }
        return json(res, 200, { srcUrl: db.env.MIG_DB_URL, srcDb: db.env.MIG_SRC_DB, dstUrl: dstUrl(db.env), dstDb: db.env.MIG_DST_DB, dstTypes, dstError, src });
      }
      if (req.method === 'GET' && req.url === '/api/settings') return json(res, 200, { file: envFile, values: publicView(db.env) });
      if (req.method === 'POST' && req.url === '/api/settings/test') {
        const e = candidate(pickForm(await readBody(req)));
        const errs = checkEnv(e);
        return json(res, 200, { errors: errs, ...(await probe(e)) });
      }
      if (req.method === 'POST' && req.url === '/api/settings/save') {
        if (!envFile) return json(res, 400, { error: 'файл доступа не указан (--env)' });
        if (J.running) return json(res, 409, { error: 'идёт перенос — подключение не меняется' });
        const text = updateEnvText(fs.readFileSync(envFile, 'utf8'), pickForm(await readBody(req)));
        const errs = checkEnv(parseEnv(text));
        if (errs.length) return json(res, 400, { error: 'не сохранено: ' + errs.join('; ') });
        fs.writeFileSync(envFile, text, { mode: 0o600 });
        db = connect(parseEnv(text)); cache = null;
        return json(res, 200, { saved: envFile, values: publicView(db.env), ...(await probe(db.env)) });
      }
      if (req.method === 'POST' && req.url === '/api/settings/create-dst') {
        const e = db.env;
        if (!/^migration_dst/.test(e.MIG_DST_DB)) return json(res, 400, { error: 'новая база должна называться migration_dst…' });
        const r = await fetch(dstUrl(e).replace(/\/+$/, '') + '/api/v1/server', { method: 'POST', signal: AbortSignal.timeout(30000),
          headers: { Authorization: basic(e.MIG_DST_USER, e.MIG_DST_PASSWORD), 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'create database ' + e.MIG_DST_DB }) });
        return json(res, r.ok ? 200 : 400, r.ok ? { created: e.MIG_DST_DB, ...(await probe(e)) } : { error: 'сервер новой базы ответил ' + r.status });
      }
      if (req.method === 'GET' && req.url === '/api/job') { const { reportHtml, ...rest } = J; return json(res, 200, { ...rest, hasReport: Boolean(reportHtml) }); }
      if (req.method === 'GET' && req.url === '/report.html') {
        if (kc.configured && !me(req)) return json(res, 401, { error: 'нужен вход: шаг 0' });
        if (!J.reportHtml) return json(res, 404, { error: 'отчёта ещё нет: перенос в этом запуске не выполнялся' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(J.reportHtml);
      }
      if (req.method === 'POST' && req.url === '/api/run') {
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 1e4) throw new Error('слишком большой запрос'); }
        const what = JSON.parse(body || '{}').what;
        if (J.running) return json(res, 409, { error: 'уже идёт: ' + J.what });
        if (what === 'transfer') {
          const d = await dialog(true);
          if (!d.ready) return json(res, 409, { error: 'перенос не начинается: на шаге 2 ждут решения ' + d.summary.needs_decision + ' значений' });
          runJob('transfer', readDoc(), (me(req) || {}).login);
        } else if (what === 'fingerprint') runJob('fingerprint');
        else return json(res, 400, { error: 'неизвестное задание' });
        return json(res, 202, { started: what });
      }
      if (req.method === 'GET' && req.url === '/api/dryrun') {
        const report = await dryRun(db, readDoc());
        return json(res, 200, { ...report, fingerprint: fingerprint(report) });
      }
      if (req.method === 'POST' && req.url === '/api/decisions') {
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 1e6) throw new Error('слишком большой запрос'); }
        const forms = JSON.parse(body);
        let doc = readDoc();
        // со входом «кто принял» — логин из токена, а не из поля страницы
        const who = me(req);
        // регистр кода — по виду справочника поля в правилах переноса
        const caseOf = scope => { const dn = statusDictOf(RULES, scope); const dd = dn && (RULES.dictionaries || {})[dn]; return dd ? (RULES.code_case || {})[dd.kind] : 'upper'; };
        for (const f of Array.isArray(forms) ? forms : [forms]) doc = addDecision(doc, who ? { ...f, by: who.login } : f, undefined, caseOf);
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
