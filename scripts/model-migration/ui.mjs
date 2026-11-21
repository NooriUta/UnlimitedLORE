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
import { EMPTY, groupBySuggestion, statusDictOf, decisionsAgainstRules } from './status-unify.mjs';
import { fingerprint } from './fingerprint.mjs';
import { hasCircle, attachProposals } from './status-records.mjs';
import path from 'node:path';
import { buildReport } from './report.mjs';
import crypto from 'node:crypto';
import { kcConfig, pkce, authUrl, exchange, tokenClaims, ownerInDb, verdict } from './auth.mjs';
import { COMPONENTS, planSetup, mcpEntry, applyMcpEntry, installEnvText, installArgs, volvaKeys, linkConfigToml, volvaEmbedEnv, forgejoEnv, llmEnv } from './setup.mjs';
import { INSTALL_BUNDLE, DECISION_MILESTONES } from './resources.mjs';
import { helpHtml } from './install-help.mjs';
import { jwksVerdict, whoamiVerdict } from './setup-check.mjs';
import { enrollBody, enrollVerdict } from './machine-enroll.mjs';
import { realmPlan, applyRealm, issuerParts, kcForm, checkOwnClients, topUpRealm } from './kc-realm.mjs';
import { infisicalConfig, upsertSecrets } from './infisical.mjs';
import os from 'node:os';
import { proposeRegroup, readRegroupInput, regroupOverrides, withRegroupOverrides } from './regroup.mjs';
import { proposeProductKinds, readProductKindInput, productKindMap, productKindState, withProductKinds } from './product-kind.mjs';
import { proposeOrphanSprints, readOrphanSprintInput, orphanSprintAnswers, orphanSprintState, withOrphanSprints } from './orphan-sprints.mjs';
import { proposeDepKinds, readDepKindInput, depKindAnswers, depKindState, withDepKinds } from './dep-kinds.mjs';
import { proposeWaitingLinks, readWaitingLinkInput, waitingLinkAnswers, waitingLinkState, withWaitingLinks, WAIT_KIND } from './waiting-links.mjs';
import { decisionMilestoneRules, decisionMilestoneMap, planDecisionMilestones, readDecisionMilestoneInput, withDecisionMilestones } from './decision-milestones.mjs';
import { readDecisionRefsInput, planDecisionRefs, withRefAnswer } from './decision-refs.mjs';

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
/** Страница окна: справка «Что нужно и как настроить» — разделы README пакета (install-help.mjs), один источник. */
export function pageHtml() { return PAGE.replace('<!--HELP-->', () => helpHtml(INSTALL_BUNDLE.files['README.md'] || '')); }

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
<title>LORE · установщик</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@800&family=Manrope:wght@400;700&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light;--bg0:#f5f3ee;--bg1:#faf8f3;--bg2:#ffffff;--bd:#d4ccb8;--t1:#1e1a12;--t2:#5c5240;--t3:#76694f;--acc:#677528;--suc:#3d7a38;--wrn:#a06010;--inf:#3a7060;--dng:#c03030;--mono:'IBM Plex Mono',ui-monospace,monospace;--fs-2xs:10px;--fs-xs:11px;--fs-sm:12px;--fs-md:13px;--fs-lg:15px;--fs-xl:20px;--fs-2xl:24px}
:root[data-theme=dark]{color-scheme:dark;--bg0:#141108;--bg1:#1c1810;--bg2:#252019;--bd:#42382a;--t1:#ede5d0;--t2:#a6997f;--t3:#9c937b;--acc:#a8b860;--suc:#7dbf78;--wrn:#d4922a;--inf:#88b8a8;--dng:#cf6c5e}
*{box-sizing:border-box}body{margin:0;background:var(--bg0);color:var(--t1);font:400 var(--fs-sm)/1.45 Manrope,system-ui,sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:10px 12px 60px}h1,h2,h3{font-family:Unbounded,Manrope,sans-serif;font-weight:800;margin:14px 0 6px}h1{font-size:var(--fs-2xl);color:var(--acc)}h2{font-size:var(--fs-lg);border-bottom:1px solid var(--bd);padding-bottom:4px}h3{font-size:var(--fs-md);margin:10px 0 4px}
.top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.sub{color:var(--t3);font-size:var(--fs-xs)}code,.mono{font-family:var(--mono);font-size:var(--fs-xs)}
.btn{background:var(--bg1);border:1px solid var(--acc);color:var(--acc);border-radius:999px;padding:3px 11px;font:700 var(--fs-xs) Manrope,sans-serif;cursor:pointer}.btn.pri{background:var(--acc);color:var(--bg0)}.btn[disabled]{opacity:.45;cursor:default}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin:8px 0}.kpi{background:var(--bg1);border:1px solid var(--bd);border-radius:6px;padding:6px 9px}.kpi b{display:block;font:800 var(--fs-xl) Unbounded,sans-serif;color:var(--acc)}.kpi span{color:var(--t3);font-size:var(--fs-xs)}
.state{border-radius:6px;padding:7px 10px;margin:8px 0;border:1px solid var(--bd);background:var(--bg1)}.state.stop{border-left:4px solid var(--dng)}.state.go{border-left:4px solid var(--suc)}
.tw{overflow-x:auto;border:1px solid var(--bd);border-radius:6px;margin:6px 0;background:var(--bg1)}table{border-collapse:collapse;width:100%;min-width:720px}th{background:var(--bg2);color:var(--t3);font:700 var(--fs-2xs) Manrope,sans-serif;letter-spacing:.08em;text-transform:uppercase;text-align:left;padding:5px 8px}td{border-top:1px solid var(--bd);padding:5px 8px;vertical-align:middle}
.num{font-family:var(--mono);color:var(--wrn);text-align:right;width:60px}.val{font-family:var(--mono);font-size:var(--fs-xs)}.why{color:var(--t3);font-size:var(--fs-2xs)}
tr.grp td{background:var(--bg2);font-weight:700}tr.done td{opacity:.6}
.fhide{display:none}.rec>td{background:var(--bg0);padding:4px 6px}.rw{position:sticky;left:0;max-width:calc(100vw - 46px);overflow-x:auto;border:1px solid var(--bd);border-radius:6px;background:var(--bg1)}
table.rt{min-width:600px}table.rt td,table.rt th{width:auto;padding:3px 6px;font-size:var(--fs-xs);white-space:nowrap}.rbt{padding:0 8px;margin-left:4px;font-size:var(--fs-2xs)}.rf{padding:3px 6px}.errt{color:var(--dng)}
.chip.prop{border-style:dashed;border-color:var(--inf);color:var(--inf)}.chip.bad,.btn.bad{border-color:var(--dng);color:var(--dng)}.prop{margin-top:3px;display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.filt{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}.filt input{min-width:0;flex:1 1 160px;max-width:280px}.filt select{max-width:100%}
.dec{display:flex;gap:6px;align-items:center;flex-wrap:nowrap}.dec select{flex:1;min-width:160px}.newf{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}.newf[hidden]{display:none}.chip.ok{margin-bottom:4px}td:last-child{width:300px}td:nth-child(3){width:260px}
.steps{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.steps a{text-decoration:none;color:var(--t2);border:1px solid var(--bd);border-radius:999px;padding:4px 12px;font-size:var(--fs-xs);background:var(--bg1)}.steps a b{color:var(--acc);margin-right:4px}.steps a.on{background:var(--acc);border-color:var(--acc);color:var(--bg0)}.steps a.on b{color:var(--bg0)}
.guide{border:1px solid var(--bd);border-left:3px solid var(--acc);border-radius:6px;background:var(--bg1);padding:6px 12px;margin:10px 0}.guide summary{cursor:pointer;padding:4px 0}.guide p,.guide li{color:var(--t1);margin:4px 0}.guide ol,.guide ul{padding-left:20px}
.cfg{min-width:0}.cfg td,.cfg th{border:0;padding:3px 6px}.cfg input{width:100%;border-radius:6px}
select,input{background:var(--bg0);color:var(--t1);border:1px solid var(--bd);border-radius:999px;padding:3px 8px;font:400 var(--fs-xs) Manrope,sans-serif}input.lbl{width:110px}
.chip{display:inline-block;border:1px solid var(--bd);border-radius:999px;padding:0 7px;font-size:var(--fs-2xs);color:var(--t2);white-space:nowrap}.chip.ok{color:var(--suc);border-color:var(--suc)}
.chip.sug{border-color:var(--acc);color:var(--acc)}.chip.on{background:var(--acc);border-color:var(--acc);color:var(--bg0)}.pkc{cursor:pointer;padding:2px 9px;font-size:var(--fs-xs)}.pkc input{margin:0 3px 0 0;vertical-align:middle}
.themesw{display:inline-flex;border:1px solid var(--acc);border-radius:999px;overflow:hidden}.themesw button{background:transparent;border:0;color:var(--acc);font:700 var(--fs-xs) Manrope,sans-serif;padding:3px 10px;cursor:pointer}.themesw button[aria-pressed=true]{background:var(--acc);color:var(--bg0)}
.help h3{font-size:var(--fs-sm)}.help h4{font-size:var(--fs-xs);margin:8px 0 4px;font-family:Unbounded,Manrope,sans-serif}.help pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg0);border:1px solid var(--bd);border-radius:6px;padding:6px 8px;margin:4px 0}.help code{overflow-wrap:anywhere}.help p,.help li{overflow-wrap:anywhere}
.htw{border:1px solid var(--bd);border-radius:6px;margin:6px 0;overflow-x:auto}.htab{min-width:0;font-size:var(--fs-xs)}.htab td{vertical-align:top}.hsteps{margin:4px 0 6px}
@media (max-width:700px){.htab,.htab tbody,.htab tr,.htab td{display:block;width:auto!important}.htab thead{display:none}.htab tr{border-top:1px solid var(--bd);padding:4px 0}.htab td{border:0;padding:2px 8px}.htab td::before{content:attr(data-th);display:block;color:var(--t3);font:700 var(--fs-2xs) Manrope,sans-serif;letter-spacing:.08em;text-transform:uppercase}}
.drl{display:flex;flex-direction:column;gap:6px;margin:6px 0}.drc{display:grid;grid-template-columns:minmax(0,1fr);gap:4px 12px;border:1px solid var(--bd);border-radius:6px;background:var(--bg1);padding:7px 10px}.drc.dec{border-left:3px solid var(--suc)}.drc.wait{border-left:3px solid var(--wrn)}
.drc .ch{display:flex;flex-direction:column;gap:3px}.drc .ch label{display:flex;gap:6px;align-items:baseline;cursor:pointer;padding:2px 4px;border-radius:4px}.drc .ch label:hover{background:var(--bg2)}.drc .ch input{margin:0}.drc .cand{font-family:var(--mono);font-size:var(--fs-xs);overflow-wrap:anywhere}
@media (min-width:900px){.drc{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) minmax(0,1.3fr)}}
#msg{position:fixed;left:12px;right:12px;bottom:10px;background:var(--bg1);border:1px solid var(--acc);border-radius:6px;padding:6px 10px;display:none}#msg.err{border-color:var(--dng);color:var(--dng)}
</style></head><body><div class="wrap">
<div class="top"><h1>Установщик LORE</h1><span class="themesw"><button data-theme-set="light">Светлая</button><button data-theme-set="dark">Тёмная</button></span></div>
<div class="top"><span class="sub">источник <span class="mono" id="src">…</span> · только чтение · решения пишутся в файл решений этой установки</span>
<label class="sub">кто принимает решения <input id="by" placeholder="логин"></label>
<span class="sub" id="who"></span> <button class="btn" id="reload">Перепроверить</button><span class="sub" id="fp"></span></div>
<nav class="steps" id="steps">
<a href="#step-s" data-step="s"><b>★</b> Старт</a>
<a href="#step-0" data-step="0"><b>0</b> Вход</a>
<a href="#step-1" data-step="1"><b>1</b> Подключение</a>
<a href="#step-2" data-step="2"><b>2</b> Статусы</a>
<a href="#step-p" data-step="p"><b>П</b> Проекты</a>
<a href="#step-k" data-step="k"><b>В</b> Вид продукта</a>
<a href="#step-m" data-step="m"><b>Р</b> Решения → вехи</a>
<a href="#step-r" data-step="r"><b>С</b> Ссылки решений</a>
<a href="#step-o" data-step="o"><b>З</b> Задачи без спринта</a>
<a href="#step-d" data-step="d"><b>Зв</b> Вид зависимостей</a>
<a href="#step-w" data-step="w"><b>Ж</b> Ожидание → связи</a>
<a href="#step-3" data-step="3"><b>3</b> Пробный расчёт</a>
<a href="#step-4" data-step="4"><b>4</b> Перенос</a>
<a href="#step-5" data-step="5"><b>5</b> Сверка и отчёт</a>
</nav>
<section data-page="s" hidden><h2>Старт: что ставим</h2>
<p class="sub">Выберите компоненты, скажите, есть ли у вас Keycloak и хранилище секретов, и что делаем: новая установка или перенос. Ниже появится план шагов. Подключение агентов к LORE — в конце страницы.</p>
<div class="tw" style="padding:8px"><form id="sf">
<div><b>Что ставим</b></div><div id="scomp"></div>
<div style="margin-top:6px"><b>Keycloak</b> <label><input type="radio" name="kc" value="own" checked> есть свой</label> <label><input type="radio" name="kc" value="none"> нет — скачать и настроить</label></div>
<div><b>Хранилище секретов</b> <label><input type="radio" name="secrets" value="own" checked> есть своё</label> <label><input type="radio" name="secrets" value="none"> нет — скачать и настроить</label></div>
<div><b>Forgejo</b> <label><input type="radio" name="forgejo" value="none" checked> без Forgejo</label> <label><input type="radio" name="forgejo" value="install"> поставить Forgejo нашей версии</label> <label><input type="radio" name="forgejo" value="own"> есть свой — указать адрес</label></div>
<div><b>LLM (по выбору)</b> <label><input type="radio" name="llm" value="none" checked> без модели</label> <label><input type="radio" name="llm" value="local"> своя локальная модель — указать сервер</label></div>
<div><b>Образы</b> <label><input type="radio" name="images" value="ready" checked> готовые образы</label> <label><input type="radio" name="images" value="source"> собрать из исходников пакета</label> <a class="sub" href="#help-start">как</a></div>
<div><b>Режим</b> <label><input type="radio" name="mode" value="new" checked> новая установка</label> <label><input type="radio" name="mode" value="migrate"> перенос на новую модель</label></div>
</form></div>
<div id="splan"></div>
<!--HELP-->
<h3>Установка</h3>
<div class="tw" style="padding:8px"><form id="if" autocomplete="off"><table class="cfg">
<tr><td>Каталог установки (Linux)</td><td><input name="dir" size="30" value="/opt/lore"></td></tr>
<tr><td>Версия (тег) или пусто</td><td><input name="version" size="16"></td></tr>
<tr><td>Порт веба</td><td><input name="port" size="8" value="4400"></td></tr>
<tr><td>Адрес области Keycloak</td><td><input name="issuer" size="40" placeholder="https://keycloak/realms/lore"></td></tr>
<tr><td>Адрес веба LORE</td><td><input name="web" size="40" placeholder="https://lore.example.org"></td></tr>
<tr><td>Keycloak: что у вас уже есть</td><td><select name="kcMode"><option value="ask" selected>— выберите —</option><option value="new">ничего: завести область и клиенты за меня</option><option value="own-realm">своя область: завести в ней клиенты за меня</option><option value="topup">LORE уже стоит: довести клиентов (только добавить)</option><option value="own">свои клиенты и секреты: только проверить токены</option></select></td></tr>
<tr><td>Свои имена клиентов</td><td><input name="kcNames" size="40" placeholder="по умолчанию lore-app, lore-mcp-&lt;роль&gt;[_&lt;harness&gt;]; своё: lore-mcp-full=acme-full"></td></tr>
<tr><td>Младшие роли для harness</td><td><input name="kcExtra" size="40" placeholder="через запятую, не выше главной: tester,developer"></td></tr>
<tr><td>Свои секреты: переменные</td><td><input name="kcSecretVars" size="40" placeholder="по умолчанию LORE_MCP_CLIENT_SECRET_&lt;РОЛЬ&gt;[_&lt;HARNESS&gt;]; своё: full=ACME_FULL_SECRET"></td></tr>
<tr><td>Администратор Keycloak (новая установка)</td><td><input name="kcAdmin" size="16" autocomplete="off" placeholder="admin"> <input name="kcPassword" type="password" size="16" autocomplete="new-password" placeholder="пароль — не сохраняется"></td></tr>
<tr><td>Адрес Völva</td><td><input name="volva" size="40" placeholder="если Völva выбрана"></td></tr>
<tr><td>Адрес своего Forgejo</td><td><input name="forgejoUrl" size="40" placeholder="если выбран свой Forgejo"></td></tr>
<tr><td>Сервер модели (LLM)</td><td><input name="llmUrl" size="40" placeholder="http://host.docker.internal:11434 — если выбрана модель"> <input name="llmModel" size="16" placeholder="имя модели, qwen3:4b"></td></tr>
<tr><td>Адрес сервера miniLORE</td><td><input name="minilore" size="40" placeholder="если miniLORE выбран"></td></tr></table>
<div class="top"><button type="button" class="btn" id="ienv">Собрать .env</button><button type="button" class="btn" id="iplan">План установки</button><button type="button" class="btn" id="ivolva">Ключи Völva</button><button type="button" class="btn" id="ilink">Файл для link</button><button type="button" class="btn" id="ikcplan">План области Keycloak</button><button type="button" class="btn" id="ikcapply">Завести область</button></div>
<pre class="mono" id="iout" style="white-space:pre-wrap;max-height:360px;overflow:auto"></pre><div id="ires" class="sub"></div></form></div>
<h3>Подключение агента на этой машине</h3>
<div class="tw" style="padding:8px"><form id="af" autocomplete="off"><table class="cfg">
<tr><td>Harness</td><td><select name="harness"><option value="claude">Claude Code</option><option value="kimi">Kimi Code</option><option value="qwen">Qwen Code</option><option value="dsh">DeepSeek Harness</option><option value="codex">Codex</option><option value="opencode">OpenCode</option><option value="cursor">Cursor</option></select></td></tr>
<tr><td>Секрет учётки</td><td class="sub">ключ <span class="mono">LORE_MCP_CLIENT_SECRET_&lt;РОЛЬ&gt;[_&lt;HARNESS&gt;]</span> (Claude Code — <span class="mono">…_FULL</span>, Kimi — <span class="mono">…_FULL_KIMI</span>); строка MCP называет его в <span class="mono">LORE_MCP_SECRET_VAR</span>, значение — в окружении машины или в Infisical, в строку не кладётся. Подагенту младшей роли — своя учётка и свой ключ.</td></tr>
<tr><td>Код машины</td><td><input name="machineId" size="30"></td></tr>
<tr><td>Адрес бэкенда LORE</td><td><input name="backendUrl" size="40"></td></tr>
<tr><td>Издатель (Keycloak, область)</td><td><input name="issuer" size="40"></td></tr>
<tr><td>Путь к серверу MCP</td><td><input name="serverPath" size="40"></td></tr></table>
<div class="top"><button type="button" class="btn" id="apreview">Показать строку MCP</button><button type="button" class="btn" id="acheck">Проверить связь</button><button type="button" class="btn" id="amach">Завести машину в LORE</button><button type="button" class="btn pri" id="aapply" hidden>Записать в настройки Claude Code</button></div>
<pre class="mono" id="aout" style="white-space:pre-wrap"></pre><div id="ares" class="sub"></div></form></div>
</section>
<section data-page="0" hidden><h2>Шаг 0. Вход и проверка владельца</h2>
<p class="sub">Укажите сервер Keycloak и область входа, затем войдите. Дальше пускает, только если сошлись обе проверки: в токене есть роль владельца, и в базе этой установки у вашей учётки роль владельца проекта.</p>
<div id="s0">загрузка…</div>
<details class="guide" open><summary><b>Инструкция: как проходит перенос и что делать на каждом шаге</b></summary>
<h3>Что делает установщик</h3>
<p>Переносит данные LORE в новую базу по новой модели. Действующая база не меняется: установщик читает её копию (снимок из бэкапа) и собирает рядом новую. Старая база остаётся откатом; сколько её хранить, решает владелец установки.</p>
<h3>Что подготовить до запуска</h3>
<ol>
<li><b>Файл доступа</b> — текстовый файл <code>КЛЮЧ=значение</code>, его путь передаётся ключом <code>--env</code>. Нужны: <code>MIG_DB_URL</code> (сервер ArcadeDB), <code>MIG_SRC_DB</code> (база-источник — снимок), <code>MIG_SRC_USER</code>/<code>MIG_SRC_PASSWORD</code>, <code>MIG_DST_DB</code> (новая база, имя начинается с <code>migration_dst</code>), <code>MIG_DST_USER</code>/<code>MIG_DST_PASSWORD</code>. Если новая база на другом сервере — <code>MIG_DST_URL</code>. Старая доска плана: <code>MIG_PLAN_BOARD=drop</code> — не переносить (по умолчанию), <code>keep</code> — перенести как есть (останется в базе неиспользуемой). Для входа: <code>MIG_KC_URL</code>, <code>MIG_KC_REALM</code>, <code>MIG_KC_CLIENT</code>, <code>MIG_OWNER_PROJECT</code>. Пароли установщик нигде не показывает и не пишет.</li>
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
<p><b>Вид продукта</b> (шаг В). Строка на продукт: отметьте tech, service или обе галочки; предложение установщика выделено, довод — рядом. «Принять все предложения» записывает предложенный вид всем, у кого вида ещё нет и предложение есть; строки с «?» решаются вручную. Пока у продукта нет вида, перенос не начинается.</p>
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
<div id="state" class="state">загрузка…</div><div class="kpis" id="kpis"></div>
<div class="filt"><select id="fproj" aria-label="фильтр по проекту"><option value="">все проекты</option></select><input id="fq" placeholder="поиск по коду записи" aria-label="поиск по коду записи"><span class="sub" id="fprop"></span></div>
<p class="sub">У значения — кнопка «▸ N зап.»: записи, в которых оно встречается (тип, код, проект, дата создания, версия с этим статусом). Больше 50 — первые 50 и число остальных. «предложено» — подсказка из файла предложений: в файл решений пишется только кнопкой «принять».</p><div id="body"></div></section>
<section data-page="p" hidden><h2>Шаг П. Перегруппировка проектов</h2>
<p class="sub">Предложение из данных этой установки: проект = продукт верхнего уровня (подпродукт — в родителе), дубль того же репозитория — туда же. Строку можно поправить: впишите группу или оставьте пустым — проект останется сам по себе. Старые проекты станут синонимами новой группы: записи и ссылки переезжают, ничего не теряется. Сверка — записей до = записей после по каждой группе.</p>
<div id="rg" class="state">загрузка…</div></section>
<section data-page="k" hidden><h2>Шаг В. Вид продукта</h2>
<p class="sub">У каждого продукта — вид: <b>tech</b> (технологический), <b>service</b> (сервисно-организационный, git от него не требуется) или оба сразу, ADR-LORE-044; пустым вид быть не может. Решает человек; установщик только предлагает по данным этой установки. Правило предложения, первое сработавшее: вид уже задан в источнике — он; у проекта-владельца есть адрес репозитория — tech; продукт служит другим продуктам (связь «служит»: продаёт, считает) или в названии слова услуги (продажи, учёт, поддержка, бэк-офис) — service; есть оба признака — предлагаются оба; подпродукт без своих признаков — как родитель; иначе «?». Пока у продукта нет вида, перенос не начинается.</p>
<div id="pk" class="state">загрузка…</div></section>
<section data-page="m" hidden><h2>Шаг Р. Решения → вехи</h2>
<p class="sub">Связь решения с вехой — ребро TARGETS_MILESTONE, как у спринта. Решение с ADR вехой не связывается: оно уже связано через ADR. Решению без ADR веха вычисляется при переносе по данным этой установки, первое сработавшее: спринт решения (код SPRINT_… в тексте или спринт вопроса, на который оно отвечает) → веха спринта; иначе окно по времени — дата решения попала в окно вехи (даты её спринтов и решений, срок вехи); сначала вехи продукта или проекта решения, потом любые; при пересечении окон — ближайший конец после даты. Нет ни спринта, ни окна — строка «куда?»: выберите веху или «без вехи». Выбор пишется в файл решений и сильнее вычисления.</p>
<div id="dm" class="state">загрузка…</div></section>
<section data-page="r" hidden><h2>Шаг С. Ссылки решений</h2>
<p class="sub">Ссылки решения строкой (ADR, спринт, PR, релиз) при переносе становятся связями. Сюда попадает ссылка, которая неоднозначна (тот же код у нескольких целей, и проект решения не выбирает одну — например тег v1.0.0 у трёх проектов) или не нашла цель. По каждой строке выберите: кандидата — ставится связь; «не ставить связь» — значение остаётся в остатке с пометкой «решено человеком»; «решу позже» — остаток «ждёт решения». Ответ пишется в файл решений (код DR-NN) и применяется при каждом переносе.</p>
<div class="filt"><select id="drproj" aria-label="фильтр по проекту решения"><option value="">все проекты</option></select><span class="sub" id="drn"></span></div>
<div id="dr" class="state">загрузка…</div></section>
<section data-page="o" hidden><h2>Шаг З. Задачи без спринта</h2>
<p class="sub">Задача без связи со спринтом висит в воздухе: в новой модели спринт задачи — ребро «задача → спринт». Установщик предлагает спринт по данным этой установки, первое сработавшее: приставка кода задачи — спринт из реестра (точно); в другом спринте есть задача с тем же кодом (возможен дубль — вторая задача с тем же кодом не заводится, ответ «дубль» уводит задачу в остаток переноса); похожий спринт по словам кода (похоже, подтвердите); иначе «куда?». Решает человек: подтвердите предложение или выберите спринт. Ребро ставится только по ответу; без ответа задача переносится без спринта, в отчёте — «ждёт решения».</p>
<div id="os" class="state">загрузка…</div></section>
<section data-page="d" hidden><h2>Шаг Зв. Вид зависимостей</h2>
<p class="sub">Связь «зависит от» (DEPENDS_ON) между задачей, фазой, спринтом и вехой несёт вид из справочника: blocks — не начать без; waits — ждём ответа или результата; soft — ждёт, но начинать можно; gate — проверка; informs — входные данные; relates — просто связано (прежний hard переносится как blocks). Здесь — связи без вида. Установщик читает тексты обоих концов (название, описание, итог, причину блокировки), ищет фразу, где назван другой конец, и по её словам предлагает вид; фраза — подсказка. Решает человек: «принять все предложения» или по одной. Без ответа связь переносится без вида, в отчёте — «ждёт решения». У старых связей без причины причиной станет «перенесено без причины (до 1.18)».</p>
<div id="dk" class="state">загрузка…</div></section>
<section data-page="w" hidden><h2>Шаг Ж. Ожидание → связи</h2>
<p class="sub">У задачи в статусе «ждём» есть текст «чьего ответа ждём» (waiting_for). Где текст однозначно называет задачу, фазу, спринт или веху этой установки (код, [[код]], тип:код), установщик предлагает связь «зависит от» вида waits с причиной — исходным текстом. ADR, решения, спеки и вопросы — не планирование, их связь «зависит от» не соединяет: такие тексты остаются текстом, как и тексты без кода. У задачи не в статусе «ждём» адресат остался от прошлого статуса — связь не предлагается. Текст поля не стирается никогда. Без ответа — остаётся текстом, «ждёт решения».</p>
<div id="wl" class="state">загрузка…</div></section>
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
var K='lore-migrate-theme',B='lore-migrate-decider',D=null,NAME={KnowSprintHist:'Спринт',KnowTaskHist:'Задача',KnowPhaseHist:'Фаза',KnowADRHist:'ADR',KnowDecisionHist:'Решение',KnowSpecHist:'Спека',KnowMilestoneHist:'Веха',KnowQuestion:'Вопрос',KnowUseCase:'Фича',QualityGate:'Гейт качества',KnowDecision:'Решение (запись)',KnowADR:'ADR (запись)',KnowSpec:'Спека (запись)',KnowActor:'Агент'};
function theme(t){document.documentElement.dataset.theme=t;document.querySelectorAll('[data-theme-set]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.themeSet===t))});try{localStorage.setItem(K,t)}catch(e){}}
try{theme(localStorage.getItem(K)||'light');document.getElementById('by').value=localStorage.getItem(B)||''}catch(e){theme('light')}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
function msg(t,err){var m=document.getElementById('msg');m.textContent=t;m.className=err?'err':'';m.style.display='block';clearTimeout(msg.t);msg.t=setTimeout(function(){m.style.display='none'},err?8000:3000)}
function load(){document.getElementById('state').textContent='читаю источник…';fetch('api/dialog').then(function(r){return r.json()}).then(function(d){if(d.error)throw new Error(d.error);D=d;draw();gate()}).catch(function(e){document.getElementById('state').className='state stop';document.getElementById('state').textContent='не смогли прочитать: '+e.message})}
function draw(){var s=D.summary;document.getElementById('src').textContent=D.source;document.getElementById('fp').textContent='отпечаток итога '+D.fingerprint;
var st=document.getElementById('state');if(D.unread&&D.unread.length){st.className='state stop';st.textContent='СТОП: источник прочитан не весь ('+D.unread.length+' полей) — проверка не выполнена'}else if(D.ready){st.className='state go';st.textContent='ГОТОВО: статусы сведены, перенос можно начинать'}else{st.className='state stop';st.textContent='СТОП: ждут решения '+s.needs_decision+' значений ('+s.records_waiting+' записей) — перенос не начинается'}
document.getElementById('kpis').innerHTML=[[D.rows.length,'разных значений'],[s.unified,'свелось само'],[s.decided,'закрыто решением'],[s.defaulted||0,'пусто → начальный (правило 19.11)'],[s.needs_decision,'ждут решения'],[s.records_waiting,'записей за ними']].map(function(k){return '<div class="kpi"><b>'+k[0]+'</b><span>'+k[1]+'</span></div>'}).join('');
var html='';D.groups.forEach(function(t){html+='<h3>'+esc(NAME[t.type]||t.type)+' <span class="sub">'+esc(t.dict)+' · ждут '+t.waiting+'</span></h3><div class="tw"><table><thead><tr><th>Значение в старой базе</th><th>Записей</th><th>Предложение</th><th>Решение</th></tr></thead><tbody>';
t.groups.forEach(function(g){var ids=g.rows.filter(function(r){return r.state==='needs_decision'}).map(function(r){return r.i});html+='<tr class="grp"><td colspan="2">'+(g.code?'→ '+esc(g.code):'без предложения')+' · '+g.rows.length+' знач. · '+g.n+' зап.</td><td colspan="2">'+(g.code&&ids.length?'<button class="btn pri" data-group="'+ids.join(',')+'" data-to="'+esc(g.code)+'">Принять группу → '+esc(g.code)+'</button>':'')+'</td></tr>';
g.rows.forEach(function(r){var done=r.state!=='needs_decision';var opts=r.codes.map(function(c){return '<option'+(c===r.code?' selected':'')+'>'+esc(c)+'</option>'}).join('');
html+='<tr class="'+(done?'done':'')+(hide(r)?' fhide':'')+'" data-i="'+r.i+'"><td><span class="val">'+(r.value==null?'<i>(пусто)</i>':esc(String(r.value).replace(/\s+/g,' ').slice(0,100)))+'</span>'+recBtn('m',r)+'</td><td class="num">'+r.n+'</td><td>'+(r.suggest&&!done?'<button class="btn" data-one="'+r.i+'" data-to="'+esc(r.suggest)+'">принять: '+esc(r.suggest)+'</button>':'')+'<div class="why">'+esc(r.suggestWhy||'')+'</div>'+propHtml(r,done)+'</td><td>'+(done?'<span class="chip ok">'+esc(r.decision?'решение '+r.decision+' → '+(r.code||'—'):'→ '+(r.code||'—'))+'</span> ':'')+'<div class="dec"><select data-sel="'+r.i+'"><option value="">— решение —</option><optgroup label="свести к коду">'+opts+'</optgroup><option value="@new">новый код…</option><option value="@defer">решу позже</option></select><button class="btn" data-apply="'+r.i+'">применить</button></div><div class="newf" data-newform="'+r.i+'" hidden><input class="lbl" placeholder="КОД" data-nc="'+r.i+'"> <input class="lbl" placeholder="подпись ru" data-l="ru'+r.i+'"> <input class="lbl" placeholder="подпись en" data-l="en'+r.i+'"> <input class="lbl" placeholder="подпись pl" data-l="pl'+r.i+'"> <button class="btn pri" data-addcode="'+r.i+'">добавить и свести</button></div></td></tr>'+recRow('m',r,4)})});html+='</tbody></table></div>'});
html+=circlesHtml();document.getElementById('body').innerHTML=html;filtBar()}
function row(i){return D.flat[i]}
// MIG-01 (20.11.2026): у значения — записи, в которых оно встречается; фильтр по проекту и поиск по коду — в адресе (?proj=&q=)
var OPEN={},F={proj:'',q:''};
try{var sp0=new URLSearchParams(location.search);F.proj=sp0.get('proj')||'';F.q=sp0.get('q')||''}catch(e){}
function fsave(){try{var sp=new URLSearchParams(location.search);['proj','q'].forEach(function(k){if(F[k])sp.set(k,F[k]);else sp.delete(k)});var s=sp.toString();history.replaceState(null,'',location.pathname+(s?'?'+s:'')+location.hash)}catch(e){}}
function fon(){return !!(F.proj||F.q)}
function fit(x){return (!F.proj||(x.project||'').split(', ').indexOf(F.proj)>=0)&&(!F.q||String(x.code||'').toLowerCase().indexOf(F.q.toLowerCase())>=0)}
function hits(r){return r.records&&r.records.items?r.records.items.filter(fit):[]}
function hide(r){return fon()&&!hits(r).length}
function isOpen(k,r){return OPEN[k]!==undefined?OPEN[k]:(!!F.q&&hits(r).length>0)}
function recBtn(w,r){if(!r.records)return '';var k=w+r.i,o=isOpen(k,r),t=r.records.error?'записи: не прочитаны':(fon()?hits(r).length+' из '+r.records.items.length:r.records.total)+' зап.';return ' <button class="btn rbt'+(r.records.error?' bad':'')+'" data-rec="'+k+'" aria-expanded="'+o+'">'+(o?'▾':'▸')+' '+t+'</button>'}
function recRow(w,r,cols){if(!r.records)return '';var k=w+r.i;return '<tr class="rec'+(hide(r)?' fhide':'')+'" data-recrow="'+k+'"'+(isOpen(k,r)?'':' hidden')+'><td colspan="'+cols+'"><div class="rw">'+recTable(r)+'</div></td></tr>'}
function d16(v){return v?esc(String(v).slice(0,16).replace('T',' ')):'—'}
function recTable(r){var R=r.records;if(R.error)return '<div class="state stop">не смогли прочитать записи: '+esc(R.error)+'</div>';
var it=R.items.filter(fit);var h='<table class="rt"><thead><tr><th>тип</th><th>код</th><th>проект</th><th>создана</th><th>valid_from</th><th>valid_to</th><th>версия</th></tr></thead><tbody>';
h+=it.map(function(x){return '<tr><td>'+esc(x.kind)+'</td><td class="mono">'+esc(x.code||'—')+'</td><td>'+(x.project?esc(x.project)+(x.projectVia==='спринт'?' <span class="why">через спринт</span>':''):'<span class="why">—</span>')+'</td><td class="mono">'+d16(x.created)+(x.createdVia==='первая версия'?' <span class="why">1-я версия</span>':'')+'</td><td class="mono">'+d16(x.valid_from)+'</td><td class="mono">'+d16(x.valid_to)+'</td><td>'+(x.open===null?'<span class="why">без версий</span>':x.open?'<span class="chip ok">открыта</span>':'<span class="chip">закрыта</span>')+'</td></tr>'}).join('');
if(!it.length)h+='<tr><td colspan="7" class="why">'+(R.items.length?'по фильтру записей нет':'записей нет')+'</td></tr>';
var foot=[];if(fon())foot.push('по фильтру '+it.length+' из '+R.items.length+' показанных');if(R.more)foot.push('показаны первые '+R.items.length+' из '+R.total+' · ещё '+R.more);
return h+'</tbody></table>'+(foot.length?'<div class="why rf">'+foot.join(' · ')+'</div>':'')}
function propHtml(r,done){if(!r.proposed)return '';var same=done&&r.code===r.proposed.to;return '<div class="prop"><span class="chip prop" title="'+esc(r.proposed.note||'')+'">предложено: '+esc(r.proposed.to)+'</span>'+(same?' <span class="why">совпадает с решением</span>':' <button class="btn" data-one="'+r.i+'" data-to="'+esc(r.proposed.to)+'">принять</button>')+'</div>'}
function circlesHtml(){var C=D.circles||[];if(!C.length)return '';var h='<h3>Статусы-кружки <span class="sub">значения с эмодзи-кружком, в том числе распознанные словарём · '+C.length+'</span></h3><div class="tw"><table><thead><tr><th>Значение в старой базе</th><th>Тип</th><th>Записей</th><th>Распознано</th></tr></thead><tbody>';
C.forEach(function(c){var r=row(c.i);var st=c.state==='unified'?'<span class="chip ok">распознано → '+esc(c.recognized||'—')+'</span>':c.state==='decided'?'<span class="chip ok">решение '+esc(c.decision)+' → '+esc(c.recognized||'—')+'</span>':c.state==='defaulted'?'<span class="chip">пусто → начальный</span>':'<span class="chip bad">не распознано — ждёт решения</span>';
h+='<tr class="'+(hide(r)?'fhide':'')+'"><td><span class="val">'+esc(String(c.value).replace(/\s+/g,' ').slice(0,100))+'</span>'+recBtn('c',r)+'</td><td>'+esc(NAME[c.type]||c.type)+'</td><td class="num">'+c.n+'</td><td>'+st+'</td></tr>'+recRow('c',r,4)});return h+'</tbody></table></div>'}
function filtBar(){var s=document.getElementById('fproj');s.innerHTML='<option value="">все проекты</option>'+(D.projects||[]).map(function(p){return '<option'+(p===F.proj?' selected':'')+'>'+esc(p)+'</option>'}).join('');document.getElementById('fq').value=F.q;
var pr=D.proposals||{},fp=document.getElementById('fprop');fp.textContent=pr.error?pr.error:pr.file?'предложенных кодов в файле: '+pr.n+' — подсказка, в решения не пишутся до «принять»':'';fp.className='sub'+(pr.error?' errt':'')}
document.addEventListener('change',function(e){if(e.target.id==='fproj'){F.proj=e.target.value;OPEN={};fsave();draw()}});
document.addEventListener('input',function(e){if(e.target.id==='fq'){clearTimeout(F.t);F.t=setTimeout(function(){F.q=e.target.value.trim();OPEN={};fsave();draw()},250)}});
function by(){var v=document.getElementById('by').value.trim();try{localStorage.setItem(B,v)}catch(e){}return v}
function send(list){var who=by();if(!who){msg('Заполните «кто принимает решения» вверху страницы',true);document.getElementById('by').focus();return}
fetch('api/decisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(list.map(function(f){f.by=who;return f}))}).then(function(r){return r.json()}).then(function(d){if(d.error)throw new Error(d.error);D=d;draw();msg('Записано решений: '+list.length)}).catch(function(e){msg(e.message,true)})}
function form(i,action,to,labels){var r=row(i);return {type:r.type,field:r.field,value:r.value,action:action,to:to,labels:labels}}
document.addEventListener('change',function(e){var s=e.target.closest('select[data-sel]');if(s){var f=document.querySelector('[data-newform="'+s.dataset.sel+'"]');if(f)f.hidden=s.value!=='@new'}});
document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;
if(b.dataset.themeSet)return theme(b.dataset.themeSet);if(b.id==='reload')return load();
if(b.dataset.rec){var k=b.dataset.rec,tr=document.querySelector('[data-recrow="'+k+'"]');OPEN[k]=tr.hidden;tr.hidden=!tr.hidden;b.setAttribute('aria-expanded',String(OPEN[k]));b.innerHTML=(OPEN[k]?'▾':'▸')+b.innerHTML.slice(1);return}
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
if(stepFromHash()!=='0'&&stepFromHash()!=='s')location.hash='#step-0'})}
function step(n){n=String(n||1);document.querySelectorAll('section[data-page]').forEach(function(s){s.hidden=s.dataset.page!==n});document.querySelectorAll('#steps a').forEach(function(a){a.classList.toggle('on',a.dataset.step===n)});if(n==='1'&&!step.c1){step.c1=1;conn()}if(n==='p')rg();if(n==='k')pk();if(n==='m')dm();if(n==='o')osp();if(n==='d')dk();if(n==='w')wl();if(n==='r')dr()}
function postMap(url,m,done){fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({map:m,by:(document.getElementById('by')||{}).value||''})}).then(function(r){return r.json()}).then(function(x){if(x.error)return msg(x.error,true);msg('записано в файл решений');done()})}
function dk(){var el=document.getElementById('dk');fetch('api/dep-kinds').then(function(r){return r.json()}).then(function(d){if(d.error){el.className='state stop';el.textContent='не смогли прочитать зависимости без вида: '+d.error;return}
el.className='';var sug=d.rows.filter(function(r){return r.suggest}).length;
var h='<div class="kpis"><div class="kpi"><b>'+d.rows.length+'</b><span>без вида</span></div><div class="kpi"><b>'+sug+'</b><span>есть предложение</span></div><div class="kpi"><b>'+(d.rows.length-sug)+'</b><span>«какой?»</span></div><div class="kpi"><b>'+d.waiting.length+'</b><span>ждут решения</span></div></div>';
h+='<div class="state '+(d.waiting.length?'stop':'go')+'">'+(d.waiting.length?'Ждут решения — '+d.waiting.length+': без ответа связь переносится без вида':'У всех связей без вида есть ответ')+'</div>';
h+='<div style="margin:8px 0"><button class="btn" id="dkall">Принять все предложения</button></div>';
var opts=function(r){var a=d.answers[r.key];var o='<option value="">— не решено —</option><option value="-"'+(a===null?' selected':'')+'>оставить без вида</option>';d.kinds.forEach(function(k){o+='<option value="'+esc(k.code)+'"'+(a===k.code?' selected':'')+'>'+esc(k.code)+' — '+esc(k.label)+(r.suggest===k.code?' · предложено':'')+'</option>'});return o};
h+='<div class="tw"><table><thead><tr><th>зависит</th><th>от</th><th>предложение</th><th>подсказка</th><th>вид</th></tr></thead><tbody>'+d.rows.map(function(r){return '<tr><td class="mono">'+esc(r.from)+'<div class="sub">'+esc(r.from_name||'')+'</div></td><td class="mono">'+esc(r.to)+'<div class="sub">'+esc(r.to_name||'')+'</div></td><td>'+(r.suggest?'<span class="chip ok">'+esc(r.suggest)+'</span>':'<span class="chip">какой?</span>')+'</td><td class="why">'+esc(r.why)+'</td><td><select data-dk="'+esc(r.key)+'">'+opts(r)+'</select></td></tr>'}).join('')+'</tbody></table></div>';
el.innerHTML=h;
el.querySelectorAll('select[data-dk]').forEach(function(s){s.onchange=function(){if(!s.value)return;var m={};m[s.dataset.dk]=s.value==='-'?null:s.value;postMap('api/dep-kinds',m,dk)}});
document.getElementById('dkall').onclick=function(){var m={};d.rows.forEach(function(r){if(r.suggest&&d.answers[r.key]===undefined)m[r.key]=r.suggest});if(!Object.keys(m).length)return msg('нечего принимать: у строк с предложением ответ уже есть',true);postMap('api/dep-kinds',m,dk)}}).catch(function(e){el.className='state stop';el.textContent='не смогли прочитать зависимости без вида: '+e.message})}
function wl(){var el=document.getElementById('wl');fetch('api/waiting-links').then(function(r){return r.json()}).then(function(d){if(d.error){el.className='state stop';el.textContent='не смогли прочитать ожидания задач: '+d.error;return}
el.className='';var c=d.counts;
var h='<div class="kpis"><div class="kpi"><b>'+c.texts_with_waiting_for+'</b><span>текстов</span></div><div class="kpi"><b>'+c.proposed+'</b><span>можно связью</span></div><div class="kpi"><b>'+c.became_links+'</b><span>станут связями</span></div><div class="kpi"><b>'+c.stayed_text+'</b><span>останутся текстом</span></div><div class="kpi"><b>'+c.waiting+'</b><span>ждут решения</span></div></div>';
h+='<div style="margin:8px 0"><button class="btn" id="wlall">Принять все связи</button></div>';
var K={link:'связь',text:'текст',stale:'прошлый статус'};
h+='<div class="tw"><table><thead><tr><th>задача</th><th>чьего ответа ждём</th><th>предложение</th><th>основание</th><th>решение</th></tr></thead><tbody>'+d.rows.map(function(r){var a=d.answers[r.task_uid];var sel=r.kind==='link'?'<select data-wl="'+esc(r.task_uid)+'"><option value="">— не решено —</option><option value="1"'+(a===true?' selected':'')+'>связь '+esc(d.kind)+'</option><option value="0"'+(a===false?' selected':'')+'>оставить текстом</option></select>':'<span class="sub">текстом</span>';return '<tr><td class="mono">'+esc(r.task_uid)+'<div class="sub">'+esc(r.status_raw||'')+'</div></td><td>'+esc(r.text)+'</td><td><span class="chip'+(r.kind==='link'?' ok':'')+'">'+esc(K[r.kind])+'</span> '+esc((r.targets||[]).map(function(t){return t.type+':'+t.id}).join(', '))+'</td><td class="why">'+esc(r.why)+'</td><td>'+sel+'</td></tr>'}).join('')+'</tbody></table></div>';
el.innerHTML=h;
el.querySelectorAll('select[data-wl]').forEach(function(s){s.onchange=function(){if(!s.value)return;var m={};m[s.dataset.wl]=s.value==='1';postMap('api/waiting-links',m,wl)}});
document.getElementById('wlall').onclick=function(){var m={};d.rows.forEach(function(r){if(r.kind==='link'&&d.answers[r.task_uid]===undefined)m[r.task_uid]=true});if(!Object.keys(m).length)return msg('нечего принимать: у предложенных связей ответ уже есть',true);postMap('api/waiting-links',m,wl)}}).catch(function(e){el.className='state stop';el.textContent='не смогли прочитать ожидания задач: '+e.message})}
function osp(){var el=document.getElementById('os');fetch('api/orphan-sprints').then(function(r){return r.json()}).then(function(d){if(d.error){el.className='state stop';el.textContent='не смогли прочитать задачи без спринта: '+d.error;return}
el.className='';var K={exact:'точно',duplicate:'возможен дубль',similar:'похоже, подтвердите',where:'куда?'};var n=function(k){return d.rows.filter(function(r){return r.kind===k}).length};
var h='<div class="kpis"><div class="kpi"><b>'+d.rows.length+'</b><span>без спринта</span></div><div class="kpi"><b>'+n('exact')+'</b><span>точно</span></div><div class="kpi"><b>'+n('similar')+'</b><span>похоже</span></div><div class="kpi"><b>'+n('duplicate')+'</b><span>возможен дубль</span></div><div class="kpi"><b>'+n('where')+'</b><span>«куда?»</span></div></div>';
h+='<div class="state '+(d.waiting.length?'stop':'go')+'" data-testid="os-state">'+(d.waiting.length?'Ждут решения — '+d.waiting.length+': без ответа задача переносится без спринта':'У всех задач без спринта есть ответ')+'</div>';
h+='<div style="margin:8px 0"><button class="btn" id="osall">Принять все «точно»</button></div>';
var opts=function(r){var a=d.answers[r.task_uid];var o='<option value="">— не решено —</option><option value="-"'+(a===null?' selected':'')+'>оставить без спринта</option>';if(r.kind==='duplicate')o+='<option value="=dup"'+(a&&typeof a==='object'?' selected':'')+'>дубль '+esc(r.duplicate_of)+' — не переносить</option>';var seen={};(r.candidates||[]).concat(d.sprints).forEach(function(s){if(seen[s])return;seen[s]=1;o+='<option value="'+esc(s)+'"'+(a===s?' selected':'')+'>'+esc(s)+((r.candidates||[]).indexOf(s)>=0?' · предложено':'')+'</option>'});return o};
h+='<div class="tw"><table><thead><tr><th>задача</th><th>предложение</th><th>основание</th><th>спринт</th></tr></thead><tbody>'+d.rows.map(function(r){return '<tr data-os-row="'+esc(r.task_uid)+'"><td class="mono">'+esc(r.task_uid)+'<div class="sub">'+esc(r.title||'')+' · '+esc(r.status_raw||'')+'</div></td><td><span class="chip'+(r.kind==='exact'?' ok':'')+'">'+esc(K[r.kind])+'</span> '+esc(r.sprint||'')+'</td><td class="why">'+esc(r.why)+'</td><td><select data-os="'+esc(r.task_uid)+'">'+opts(r)+'</select></td></tr>'}).join('')+'</tbody></table></div>';
el.innerHTML=h;
var save=function(m){fetch('api/orphan-sprints',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({map:m,by:(document.getElementById('by')||{}).value||''})}).then(function(r){return r.json()}).then(function(x){if(x.error)return msg(x.error,true);msg('записано в файл решений');osp()})};
el.querySelectorAll('select[data-os]').forEach(function(s){s.onchange=function(){if(!s.value)return;var r=d.rows.filter(function(x){return x.task_uid===s.dataset.os})[0];var m={};m[s.dataset.os]=s.value==='-'?null:(s.value==='=dup'?{duplicate_of:r.duplicate_of}:s.value);save(m)}});
document.getElementById('osall').onclick=function(){var m={};d.rows.forEach(function(r){if(r.kind==='exact'&&d.answers[r.task_uid]===undefined)m[r.task_uid]=r.sprint});if(!Object.keys(m).length)return msg('нечего принимать: у строк «точно» ответ уже есть',true);save(m)}}).catch(function(e){el.className='state stop';el.textContent='не смогли прочитать задачи без спринта: '+e.message})}
function dm(){var el=document.getElementById('dm');fetch('api/decision-milestones').then(function(r){return r.json()}).then(function(d){if(d.error){el.className='state stop';el.textContent='не смогли посчитать вехи решений: '+d.error;return}
el.className='';var c=d.counts;var opts=function(cur,cands){var o='<option value="">— не решено —</option><option value="-"'+(cur===null?' selected':'')+'>без вехи</option>';var seen={};(cands||[]).concat(d.milestones).forEach(function(m){if(seen[m])return;seen[m]=1;o+='<option value="'+esc(m)+'"'+(cur===m?' selected':'')+'>'+esc(m)+((cands||[]).indexOf(m)>=0?' · веха продукта':'')+'</option>'});return o};
var h='<div class="kpis"><div class="kpi"><b>'+c.sprint+'</b><span>по спринту</span></div><div class="kpi"><b>'+c.time+'</b><span>по времени</span></div><div class="kpi"><b>'+c.waiting+'</b><span>«куда?»</span></div><div class="kpi"><b>'+c.human+'</b><span>решил человек</span></div><div class="kpi"><b>'+c.with_adr_skipped+'</b><span>с ADR — не связываются</span></div></div>';
h+='<div class="state '+(c.waiting?'stop':'go')+'">'+(c.waiting?'«Куда?» — '+c.waiting+' решений без вехи: без выбора они переносятся без связи':'У всех решений без ADR веха есть или решена')+'</div>';
var row=function(r,cur,why,cands){return '<tr><td class="mono">'+esc(r.decision)+'<div class="sub">'+esc(r.title||'')+'</div></td><td class="why">'+esc(why)+'</td><td><select data-dm="'+esc(r.decision)+'">'+opts(cur,cands)+'</select></td></tr>'};
h+='<h3>«Куда?» — ждут решения</h3><div class="tw"><table><thead><tr><th>решение</th><th>почему</th><th>веха</th></tr></thead><tbody>'+(d.waiting.length?d.waiting.map(function(r){return row(r,undefined,r.why,r.candidates)}).join(''):'<tr><td colspan="3" class="sub">таких нет</td></tr>')+'</tbody></table></div>';
h+='<h3>Решено человеком</h3><div class="tw"><table><thead><tr><th>решение</th><th>выбор</th><th>веха</th></tr></thead><tbody>'+(d.human.length?d.human.map(function(r){return row(r,r.milestone,r.milestone===null?'без вехи':'выбор человека',[])}).join(''):'<tr><td colspan="3" class="sub">пока нет</td></tr>')+'</tbody></table></div>';
h+='<h3>По времени — проверьте</h3><div class="tw"><table><thead><tr><th>решение</th><th>довод</th><th>веха</th></tr></thead><tbody>'+(d.time.length?d.time.map(function(r){return row(r,r.milestone,r.reason+(r.alternatives.length?' · ещё '+r.alternatives.join(', '):''),r.alternatives.concat([r.milestone]))}).join(''):'<tr><td colspan="3" class="sub">таких нет</td></tr>')+'</tbody></table></div>';
el.innerHTML=h;
el.querySelectorAll('select[data-dm]').forEach(function(s){s.onchange=function(){if(!s.value)return;var m={};m[s.dataset.dm]=s.value==='-'?null:s.value;fetch('api/decision-milestones',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({map:m,by:(document.getElementById('by')||{}).value||''})}).then(function(r){return r.json()}).then(function(x){if(x.error)return msg(x.error,true);dm()})}})}).catch(function(e){el.className='state stop';el.textContent='не смогли посчитать вехи решений: '+e.message})}
var PKM=null;
function pk(){var el=document.getElementById('pk');fetch('api/product-kind').then(function(r){return r.json()}).then(function(d){if(d.error){el.className='state stop';el.textContent='не смогли прочитать продукты: '+d.error;PKM=null;gate();return}
PKM=d.state.missing;gate();el.className='';var has=function(v,k){return Array.isArray(v)&&v.indexOf(k)>=0};var n=function(k){return d.rows.filter(function(r){return Array.isArray(r.kind)&&r.kind.join()===k}).length};
var h='<div class="kpis"><div class="kpi"><b>'+d.rows.length+'</b><span>продуктов</span></div><div class="kpi"><b>'+n('tech')+'</b><span>tech</span></div><div class="kpi"><b>'+n('service')+'</b><span>service</span></div><div class="kpi"><b>'+n('tech,service')+'</b><span>tech + service</span></div><div class="kpi"><b>'+d.state.missing.length+'</b><span>без вида</span></div></div>';
h+='<div class="state '+(d.state.ready?'go':'stop')+'">'+(d.state.ready?'У всех продуктов вид задан':'СТОП: нет вида у продуктов '+esc(d.state.missing.join(', '))+' — перенос не начинается')+'</div>';
h+='<div class="tw"><table><thead><tr><th>продукт</th><th>предложение</th><th>довод</th><th>вид</th></tr></thead><tbody>'+d.rows.map(function(r){var c=function(k){return '<label class="chip pkc'+(has(r.suggested,k)?' sug':'')+(has(r.kind,k)?' on':'')+'"><input type="checkbox" data-pk="'+esc(r.code)+'" value="'+k+'"'+(has(r.kind,k)?' checked':'')+'> '+k+(has(r.suggested,k)?' · предложение':'')+'</label> '};
return '<tr'+(r.kind?' class="done"':'')+'><td class="mono">'+esc(r.code)+'<div class="sub">'+esc(r.label)+'</div></td><td><span class="chip'+(r.suggested==='?'?'':' ok')+'">'+esc(Array.isArray(r.suggested)?r.suggested.join(' + '):r.suggested)+'</span></td><td class="why">'+esc(r.why)+'</td><td>'+c('tech')+c('service')+(r.decided?'':(r.kind?'<span class="sub">из источника</span>':''))+'</td></tr>'}).join('')+'</tbody></table></div>';
h+='<div class="top"><button class="btn pri" id="pkall">Принять все предложения</button> <span class="sub">предложенный набор — всем, у кого вида нет; строки с «?» решаются вручную</span></div>';
el.innerHTML=h;
function save(map){fetch('api/product-kind',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({map:map,by:(document.getElementById('by')||{}).value||''})}).then(function(r){return r.json()}).then(function(x){if(x.error){el.insertAdjacentHTML('afterbegin','<div class="state stop">'+esc(x.error)+'</div>');return}pk()})}
el.querySelectorAll('input[data-pk]').forEach(function(i){i.onchange=function(){var v=[];el.querySelectorAll('input[data-pk]').forEach(function(x){if(x.dataset.pk===i.dataset.pk&&x.checked)v.push(x.value)});if(!v.length){i.checked=true;return msg('вид продукта '+i.dataset.pk+' не может быть пустым: оставьте tech, service или оба',true)}var m={};m[i.dataset.pk]=v;save(m)}});
document.getElementById('pkall').onclick=function(){var m={};d.rows.forEach(function(r){if(!r.kind&&Array.isArray(r.suggested))m[r.code]=r.suggested});if(!Object.keys(m).length)return msg('нечего принимать: у всех строк вид уже есть или предложения нет',true);save(m)}}).catch(function(e){el.className='state stop';el.textContent='не смогли прочитать продукты: '+e.message;PKM=null;gate()})}
function stepFromHash(){var m=/^#step-([a-z0-9]+)$/.exec(location.hash);return m&&document.querySelector('[data-step="'+m[1]+'"]')?m[1]:'s'}
function dr(){var el=document.getElementById('dr'),sel=document.getElementById('drproj');fetch('api/decision-refs').then(function(r){return r.json()}).then(function(d){if(d.error){el.className='state stop';el.textContent='не смогли прочитать ссылки решений: '+d.error;return}
var sp=new URLSearchParams(location.search),P=sp.get('drproj')||'';sel.innerHTML='<option value="">все проекты</option>'+d.projects.map(function(p){return '<option'+(p===P?' selected':'')+'>'+esc(p)+'</option>'}).join('');
sel.onchange=function(){var q=new URLSearchParams(location.search);if(sel.value)q.set('drproj',sel.value);else q.delete('drproj');var s=q.toString();history.replaceState(null,'',location.pathname+(s?'?'+s:'')+location.hash);dr()};
var rows=d.rows.filter(function(r){return !P||r.projects.indexOf(P)>=0});var c=d.counts;
document.getElementById('drn').textContent=P?'показано '+rows.length+' из '+d.rows.length:'';
var h='<div class="kpis"><div class="kpi"><b>'+d.rows.length+'</b><span>ссылок в шаге</span></div><div class="kpi"><b>'+d.rows.filter(function(r){return r.reason==='ambiguous'}).length+'</b><span>неоднозначно</span></div><div class="kpi"><b>'+d.rows.filter(function(r){return r.reason==='not_found'}).length+'</b><span>нет цели</span></div><div class="kpi"><b>'+c.linked+'</b><span>связь выбрана</span></div><div class="kpi"><b>'+c.decided+'</b><span>не ставить связь</span></div><div class="kpi"><b>'+c.waiting+'</b><span>ждёт решения</span></div></div>';
h+='<div class="state '+(c.waiting?'stop':'go')+'" data-testid="dr-state">'+(c.waiting?'Ждут решения — '+c.waiting+': без ответа ссылка уходит в остаток со статусом «ждёт решения», перенос при этом не останавливается':'У всех ссылок шага есть ответ')+'</div>';
var F={adr_refs:'ADR',sprint_refs:'спринт',pr_refs:'PR',release_refs:'релиз'};
var st=function(a){if(!a||a.action==='defer')return '<span class="chip" style="color:var(--wrn);border-color:var(--wrn)">ждёт решения'+(a?' · '+esc(a.id):'')+'</span>';if(a.action==='drop')return '<span class="chip ok">решено человеком · '+esc(a.id)+'</span>';return '<span class="chip ok">связь → '+esc(a.to)+' · '+esc(a.id)+'</span>'};
var opt=function(i,r,v,label,on){return '<label><input type="radio" name="dr'+i+'" data-dr="'+i+'" value="'+esc(v)+'"'+(on?' checked':'')+'><span>'+label+'</span></label>'};
h+='<div class="drl">'+(rows.length?rows.map(function(r){var i=d.rows.indexOf(r),a=r.answer;
var ch=r.candidates.map(function(x){return opt(i,r,'link:'+x.uid,'<span class="cand">'+esc(x.uid)+'</span> <span class="sub">'+esc(x.project||'проект не указан')+' · '+esc(x.date||'дата не указана')+'</span>',a&&a.action==='link'&&a.to===x.uid)}).join('');
if(!r.candidates.length)ch='<span class="sub">кандидатов нет: цели с таким кодом в источнике не нашлось</span>';
ch+=opt(i,r,'drop','не ставить связь <span class="sub">— остаток «решено человеком»</span>',a&&a.action==='drop')+opt(i,r,'defer','решу позже <span class="sub">— остаток «ждёт решения»</span>',a&&a.action==='defer');
return '<div class="drc'+(a&&a.action!=='defer'?' dec':' wait')+'" data-dr-row="'+esc(r.key)+'"><div><span class="mono">решение '+esc(r.decision)+'</span><div>'+esc(r.title||'без названия')+'</div><div class="sub">'+esc(r.projects.join(', ')||'проект не указан')+'</div></div>'
+'<div><span class="chip">'+esc(F[r.field]||r.field)+'</span> <span class="val">«'+esc(r.value)+'»</span><div style="margin:3px 0"><span class="chip'+(r.reason==='ambiguous'?' sug':' bad')+'">'+(r.reason==='ambiguous'?'неоднозначно · кандидатов '+r.candidates.length:'нет цели')+'</span> '+st(a)+'</div><div class="why">'+esc(r.why)+'</div></div>'
+'<div class="ch" role="radiogroup" aria-label="выбор по ссылке '+esc(r.value)+'">'+ch+'</div></div>'}).join(''):'<div class="state">'+(d.rows.length?'в проекте '+esc(P)+' таких ссылок нет':'Все ссылки решений нашли цель сами — выбирать нечего')+'</div>')+'</div>';
el.className='';el.innerHTML=h;
el.querySelectorAll('input[data-dr]').forEach(function(x){x.onchange=function(){var r=d.rows[+x.dataset.dr],v=x.value,b={decision:r.decision,field:r.field,value:r.value,by:(document.getElementById('by')||{}).value||''};
if(v.indexOf('link:')===0){b.action='link';b.to=v.slice(5)}else b.action=v;
fetch('api/decision-refs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(q){return q.json()}).then(function(z){if(z.error){msg(z.error,true);return dr()}msg('записано в файл решений: '+z.id);dr()})}})}).catch(function(e){el.className='state stop';el.textContent='не смогли прочитать ссылки решений: '+e.message})}
function rg(){var el=document.getElementById('rg');fetch('api/regroup').then(function(r){return r.json()}).then(function(d){if(d.error){el.className='state stop';el.textContent=d.error;return}
el.className='';var gs=Object.keys(d.groups).sort();
var h='<div class="kpis">'+gs.map(function(g){return '<div class="kpi"><b>'+esc(g)+'</b><span class="sub">'+d.groups[g].from.length+' пр. · '+d.groups[g].records+' зап.</span></div>'}).join('')+(d.unassigned.length?'<div class="kpi"><b>куда?</b><span class="sub">'+d.unassigned.length+' пр.</span></div>':'')+'</div>';
h+='<datalist id="rgg">'+gs.map(function(g){return '<option value="'+esc(g)+'">'}).join('')+'</datalist>';
h+='<table class="tw"><thead><tr><th>проект</th><th>записей</th><th>почему</th><th>группа</th><th></th></tr></thead><tbody>'+d.rows.map(function(r){return '<tr><td class="mono">'+esc(r.from)+'<div class="sub">'+esc(r.name)+'</div></td><td>'+r.records+'</td><td class="sub">'+esc(r.why)+'</td><td><input list="rgg" data-from="'+esc(r.from)+'" value="'+esc(r.to||'')+'" placeholder="без группы"></td><td><button class="btn" data-save="'+esc(r.from)+'">Сохранить</button></td></tr>'}).join('')+'</tbody></table>';
h+='<div class="top"><button class="btn pri" id="rgall">Принять всю таблицу</button> <span class="sub">записывает группу каждой строки в файл решений</span></div>';
el.innerHTML=h;
function save(map){fetch('api/regroup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({overrides:map,by:(document.getElementById('by')||{}).value||''})}).then(function(r){return r.json()}).then(function(x){if(x.error){el.insertAdjacentHTML('afterbegin','<div class="state stop">'+esc(x.error)+'</div>');return}rg()})}
el.querySelectorAll('[data-save]').forEach(function(b){b.onclick=function(){var i=el.querySelector('input[data-from="'+b.dataset.save+'"]');var m={};m[b.dataset.save]=i.value;save(m)}});
document.getElementById('rgall').onclick=function(){var m={};el.querySelectorAll('input[data-from]').forEach(function(i){m[i.dataset.from]=i.value});save(m)}}).catch(function(e){el.className='state stop';el.textContent='не смогли прочитать проекты: '+e.message})}
window.addEventListener('hashchange',function(){step(stepFromHash())});
function sform(){var f=document.getElementById('sf'),o={components:[]};f.querySelectorAll('input[name=comp]:checked').forEach(function(x){o.components.push(x.value)});['kc','secrets','forgejo','llm','images','mode'].forEach(function(k){var x=f.querySelector('input[name='+k+']:checked');o[k]=x&&x.value});return o}
function helpOf(id){if(/keycloak|kc-/.test(id))return 'keycloak';if(/volva/.test(id))return 'volva';if(/forgejo/.test(id))return 'forgejo';if(/llm/.test(id))return 'llm';if(/secrets/.test(id))return 'secrets';if(id==='install-lore')return 'start';if(id==='agent')return 'check';return ''}
function helpOpen(){var m=/^#help-([a-z]+)$/.exec(location.hash);document.querySelectorAll('.hsteps a').forEach(function(a){a.classList.toggle('on',!!m&&a.dataset.help===m[1])});if(!m)return;var d=document.getElementById('help-'+m[1]);if(d){d.open=true;d.scrollIntoView({block:'start'})}}
window.addEventListener('hashchange',helpOpen);setTimeout(helpOpen,0);
function splan(){fetch('api/setup/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sform())}).then(function(r){return r.json()}).then(function(d){var el=document.getElementById('splan');if(d.error){el.innerHTML='<div class="state stop">'+esc(d.error)+'</div>';return}
el.innerHTML='<h3>План</h3><ol>'+d.plan.map(function(p){var hp=helpOf(p.id);return '<li><b>'+esc(p.title)+'</b>'+(hp?' <a class="sub" href="#help-'+hp+'">что нужно и как настроить</a>':'')+'<ul>'+p.howto.map(function(h){return '<li>'+esc(h)+'</li>'}).join('')+'</ul>'+(p.links.length?'<div class="sub">'+p.links.map(function(l){return '<a href="'+esc(l.url)+'" target="_blank" rel="noopener">'+esc(l.title)+'</a>'}).join(' · ')+'</div>':'')+(p.env.length?'<div class="sub mono">'+p.env.map(esc).join(' · ')+'</div>':'')+'</li>'}).join('')+'</ol>'})}
fetch('api/setup/defaults').then(function(r){return r.json()}).then(function(d){document.getElementById('scomp').innerHTML=d.components.map(function(c){return '<label style="display:block"><input type="checkbox" name="comp" value="'+esc(c.id)+'"'+(c.required?' checked disabled':'')+'> <b>'+esc(c.name)+'</b> <span class="sub">'+esc(c.about)+'</span></label>'}).join('');
var a=document.getElementById('af');Object.keys(d.agent).forEach(function(k){if(a.elements[k])a.elements[k].value=d.agent[k]});splan()}).catch(function(){});
document.addEventListener('change',function(e){if(e.target.closest&&e.target.closest('#sf'))splan()});
function iform(){var f=document.getElementById('if'),o={};Array.prototype.forEach.call(f.elements,function(x){if(x.name)o[x.name]=x.value});o.choice=sform();var a=aform();o.machineId=a.machineId;return o}
document.addEventListener('click',function(e){var map={ienv:'api/setup/env',iplan:'api/setup/install-plan',ivolva:'api/setup/volva-keys',ilink:'api/setup/link-toml'};var u=map[e.target.id];if(!u)return;
document.getElementById('ires').textContent='…';fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(iform())}).then(function(r){return r.json()}).then(function(d){var o=document.getElementById('iout'),r=document.getElementById('ires');if(d.error){r.innerHTML='<b style="color:var(--dng)">'+esc(d.error)+'</b>';return}o.textContent=d.text||'';r.innerHTML=esc(d.note||'')})});
document.addEventListener('click',function(e){if(e.target.id!=='acheck')return;var r=document.getElementById('ares');r.textContent='…';fetch('api/setup/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(aform())}).then(function(x){return x.json()}).then(function(d){if(d.error){r.innerHTML='<b style="color:var(--dng)">'+esc(d.error)+'</b>';return}var lab={ok:'да',warn:'внимание',fail:'нет',unchecked:'не смогли проверить'};r.innerHTML=d.checks.map(function(c){return '<div><span class="chip'+(c.state==='ok'?' ok':'')+'" style="'+(c.state==='fail'?'color:var(--dng)':c.state==='ok'?'':'color:var(--wrn)')+'">'+esc(c.name)+': '+lab[c.state]+'</span> '+esc(c.reason)+'</div>'}).join('')})});
document.addEventListener('click',function(e){if(e.target.id!=='amach')return;var r=document.getElementById('ares'),body=aform();var go=function(apply){body.apply=apply;r.textContent='…';return fetch('api/setup/machine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(x){return x.json()})};go(false).then(function(d){if(d.error){r.innerHTML='<b style="color:var(--dng)">'+esc(d.error)+'</b>';return}r.innerHTML='<span class="chip'+(d.state==='ok'?' ok':'')+'">'+esc(d.machineId||'')+'</span> '+esc(d.reason);if(d.state!=='plan')return;if(!confirm('Завести машину '+d.machineId+' в LORE? '+d.reason))return;go(true).then(function(d2){r.innerHTML=d2.error?'<b style="color:var(--dng)">'+esc(d2.error)+'</b>':'<span class="chip'+(d2.state==='ok'?' ok':'')+'">'+esc(d2.machineId||'')+'</span> '+esc(d2.reason)})})});
document.addEventListener('click',function(e){var id=e.target.id;if(id!=='ikcplan'&&id!=='ikcapply')return;var o=iform(),a=aform(),r=document.getElementById('ires'),out=document.getElementById('iout');o.harness=a.harness;o.apply=id==='ikcapply';if(o.apply&&!confirm('Завести область и клиенты в Keycloak '+(o.issuer||'')+'? Уже существующее не трогается.'))return;r.textContent='…';fetch('api/setup/kc-realm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}).then(function(x){return x.json()}).then(function(d){if(d.error){r.innerHTML='<b style="color:var(--dng)">'+esc(d.error)+'</b>';return}if(d.plan){out.textContent=d.plan.map(function(s){return s.method+' '+s.path+'  ('+s.id+')'}).join(String.fromCharCode(10));r.textContent='план: шагов '+d.plan.length+'; ничего не записано';return}out.textContent=d.results.map(function(s){return s.id+': '+s.reason}).join(String.fromCharCode(10));r.textContent=d.results.every(function(s){return s.state==='created'||s.state==='exists'})?'область готова':'остановлено на ошибке — см. список'})});
function aform(){var f=document.getElementById('af'),o={};Array.prototype.forEach.call(f.elements,function(x){if(x.name)o[x.name]=x.value});return o}
document.addEventListener('click',function(e){var id=e.target.id;if(id!=='apreview'&&id!=='aapply')return;var body=aform();if(id==='aapply'){if(!confirm('Записать строку MCP aida-lore в настройки Claude Code? Прежний файл сохранится копией.'))return;body.confirm=true}
fetch(id==='aapply'?'api/setup/mcp/apply':'api/setup/mcp/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(d){if(d.error){document.getElementById('ares').innerHTML='<b style="color:var(--dng)">'+esc(d.error)+'</b>';return}
document.getElementById('aout').textContent=JSON.stringify(d.entry,null,2);document.getElementById('aapply').hidden=!d.canApply;document.getElementById('ares').innerHTML=d.written?'<span class="chip ok">записано</span> '+esc(d.written)+' · копия '+esc(d.backup)+' · действует с нового старта сессии':esc(d.note||'')})});
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
function gate(){if(!D)return;var g=document.getElementById('s4gate'),b=document.getElementById('run4');var stop=D.unread&&D.unread.length?'источник прочитан не весь':(!D.ready?'на шаге 2 ждут решения '+D.summary.needs_decision+' значений ('+D.summary.records_waiting+' записей)':(PKM===null?'вид продуктов не проверен (шаг В)':(PKM.length?'нет вида у продуктов '+PKM.join(', ')+' (шаг В)':'')));
g.className='state '+(stop?'stop':'go');g.textContent=stop?'СТОП: '+stop+' — перенос не начинается':'Можно переносить: статусы сведены, вид у всех продуктов задан';b.disabled=!!stop||!document.getElementById('ack').checked}
document.addEventListener('change',function(e){if(e.target.id==='ack')gate()});
function job(){fetch('api/job').then(function(r){return r.json()}).then(function(j){var l=document.getElementById('log');if(j.lines&&j.lines.length){l.hidden=false;l.textContent=j.lines.join('\n');l.scrollTop=l.scrollHeight}
if(j.running){var s5=document.getElementById('s5');s5.className='state';s5.textContent='идёт '+(j.what==='transfer'?'перенос':'подсчёт отпечатка')+' — строк хода: '+j.lines.length+'; итог появится здесь';setTimeout(job,2000);return}if(j.result)res5(j.result);if(j.error)msg(j.error,true)})}
function res5(r){var el=document.getElementById('s5');var only=r.what!=='transfer';el.className='state '+(only?'':(r.ok?'go':'stop'));el.innerHTML=(only?'Посчитан только отпечаток: переноса и сверки в этот раз не было':(r.ok?'Сошлось':'НЕ сошлось')+': записи — '+(r.records?'сверка прошла':'расхождение')+', связи — '+(r.edges?'сверка прошла':'расхождение'))+(r.fingerprint?' · отпечаток содержимого <b class="mono">'+esc(r.fingerprint)+'</b>':'')+(r.reportFile?' · <a href="report.html" target="_blank">открыть отчёт</a> <span class="sub">'+esc(r.reportFile)+'</span>':'')+(r.types?'<div class="sub">'+Object.keys(r.types).map(function(k){return esc(k)+' '+r.types[k].n}).join(' · ')+'</div>':'')}
document.addEventListener('click',function(e){if(e.target.id==='run4'){fetch('api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({what:'transfer'})}).then(function(r){return r.json()}).then(function(d){if(d.error)return msg(d.error,true);msg('Перенос начат');job()})}
if(e.target.id==='run5'){fetch('api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({what:'fingerprint'})}).then(function(r){return r.json()}).then(function(d){if(d.error)return msg(d.error,true);location.hash='#step-5';job()})}});
auth();step(stepFromHash());load();job();if(stepFromHash()!=='k')pk();fetch('api/connect').then(function(r){return r.json()}).then(function(c){if(c.dstDb)document.getElementById('dstname').textContent=c.dstDb}).catch(function(){})})();
</script></body></html>`;

/** Диалог для страницы: строки с номерами, сгруппированные по типу и по предложению; отдельно — «кружки» и проекты записей. */
export function forPage(dialog, rules) {
  // у закрытых строк список кодов тоже нужен: решение можно переиграть
  const flat = dialog.rows.map((r, i) => ({ ...r, i, codes: r.codes || (r.dict ? rules.dictionaries[r.dict].codes.map(c => c.code) : []) }));
  const byType = new Map();
  // defaulted — пустой статус, начальный по справочнику (правило владелицы 19.11): виден, и его можно переиграть решением
  for (const r of flat) if (r.state === 'needs_decision' || r.state === 'decided' || r.state === 'defaulted') (byType.get(r.type) || byType.set(r.type, []).get(r.type)).push(r);
  const groups = [...byType.entries()].map(([type, rows]) => ({
    type, dict: rows[0].dict, waiting: rows.filter(r => r.state === 'needs_decision').length,
    groups: groupBySuggestion(rows),
  }));
  // «Статусы-кружки» (MIG-01, 20.11.2026): значения с эмодзи-кружком, в том числе распознанные словарём, — отдельной группой
  const circles = flat.filter(r => r.state !== 'no_rule' && hasCircle(r.value)).map(r => ({ i: r.i, type: r.type, value: r.value, n: r.n, state: r.state,
    recognized: r.state === 'unified' || r.state === 'decided' ? r.code || null : null, decision: r.decision || null }));
  const projects = [...new Set(flat.flatMap(r => ((r.records && r.records.items) || []).flatMap(x => (x.project ? x.project.split(', ') : []))))].sort();
  return { ...dialog, flat, groups, circles, projects };
}

export async function serve({ port = 2499, db: givenDb = null, decisionsFile = null, proposalsFile = null } = {}) {
  const [{ connect }, { RULES }, { collectStatusDialog }, { dryRun, reportFingerprint }, { dstUrl, updateEnvText, parseEnv, checkEnv, publicView }, { transfer }, { transferEdges }, { dstFingerprint }] = await Promise.all([import('./db.mjs'), import('./resources.mjs'), import('./status-run.mjs'), import('./dry-run.mjs'), import('./env.mjs'), import('./transfer.mjs'), import('./transfer-edges.mjs'), import('./dst-fingerprint.mjs')]);
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
  const file = decisionsFile || process.env.MIG_DECISIONS_FILE;
  if (!file) throw new Error('не указан файл решений: --decisions <файл> (создастся, если его нет)');
  const readDoc = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { format: DECISIONS_FORMAT, decisions: [] });
  let db = givenDb || connect();
  let cache = null;
  const recordsCache = new Map(); // записи за значениями статуса: между решениями не перечитываются (MIG-01)
  // Предложенные коды (MIG-01, 20.11.2026): файл в формате решений; только подсказка «предложено», в файл решений не пишется.
  const proposals = proposalsFile || process.env.MIG_PROPOSALS_FILE || null;
  const readProposals = () => {
    if (!proposals) return { doc: null, error: null };
    try { return { doc: JSON.parse(fs.readFileSync(proposals, 'utf8')), error: null }; } catch (e) { return { doc: null, error: 'файл предложений не прочитан: ' + e.message.slice(0, 120) }; }
  };
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
  // план шага «Ссылки решений» до переноса: все записи считаются перенесёнными — в шаг идут только неоднозначные и ненайденные
  const refsPlan = async doc => planDecisionRefs({ ...(await readDecisionRefsInput(db)), dstRid: { get: r => r }, doc });
  const readBody = async req => { let b = ''; for await (const ch of req) { b += ch; if (b.length > 1e5) throw new Error('слишком большой запрос'); } return JSON.parse(b || '{}'); };
  const dialog = async (fresh) => {
    if (!cache || fresh) {
      const d = await collectStatusDialog(db, RULES, readDoc(), { recordsCache });
      const p = readProposals();
      if (p.doc) attachProposals(d.rows, p.doc);
      d.proposals = { file: proposals, error: p.error, n: p.doc ? (p.doc.decisions || []).length : 0 };
      cache = forPage(d, RULES);
    }
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
  const tokens = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const full = new URL(req.url, 'http://127.0.0.1');
      req.url = full.pathname; // путь без строки запроса: ?… не должен давать «нет такой страницы»
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(pageHtml()); }
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
        const accessToken = await exchange(st.kc, full.searchParams.get('code') || '', redirect, st.verifier);
        const claims = tokenClaims(accessToken);
        let owner = null;
        try { owner = await ownerInDb(db, claims.sub, kc.project); } catch { owner = null; }
        const v = verdict(claims, kc.role, owner, kc.project);
        if (!v.ok) return page('Дальше нельзя', [`Вошли как ${claims.login}.`, ...v.reasons]);
        const id = crypto.randomBytes(24).toString('base64url');
        sessions.set(id, { login: claims.login, sub: claims.sub, kc: st.kc.url, realm: st.kc.realm, project: kc.project });
        // Токен — только в памяти процесса и отдельно от сессии: /api/me отдаёт сессию браузеру, токен туда не попадает.
        tokens.set(id, accessToken);
        res.writeHead(302, { 'Set-Cookie': `lmsid=${id}; HttpOnly; SameSite=Strict; Path=/`, Location: '/#step-1' });
        return res.end();
      }
      if (kc.configured && req.url.startsWith('/api/') && !me(req)) return json(res, 401, { error: 'нужен вход: шаг 0' });
      if (req.method === 'GET' && req.url === '/api/dialog') { recordsCache.clear(); return json(res, 200, await dialog(true)); } // «Перепроверить» — записи перечитываются
      if (req.method === 'GET' && req.url === '/api/connect') {
        const src = (await db.src('SELECT name, type, records FROM schema:types')).filter(t => t.type === 'vertex' && t.records > 0).map(t => ({ name: t.name, records: t.records })).sort((a, b) => a.name.localeCompare(b.name));
        let dstTypes = null, dstError = null;
        try { dstTypes = (await db.dstQuery('SELECT count(*) AS n FROM schema:types'))[0].n; } catch (e) { dstError = e.message.slice(0, 120); }
        return json(res, 200, { srcUrl: db.env.MIG_DB_URL, srcDb: db.env.MIG_SRC_DB, dstUrl: dstUrl(db.env), dstDb: db.env.MIG_DST_DB, dstTypes, dstError, src });
      }
      if (req.method === 'GET' && req.url === '/api/setup/defaults') {
        return json(res, 200, { components: COMPONENTS, agent: { harness: 'claude', machineId: os.hostname().toLowerCase(), backendUrl: process.env.LORE_BACKEND_URL || '', issuer: kc.configured ? kc.url.replace(/\/+$/, '') + '/realms/' + kc.realm : '', serverPath: '' } });
      }
      if (req.method === 'POST' && ['/api/setup/env', '/api/setup/install-plan', '/api/setup/volva-keys', '/api/setup/link-toml'].includes(req.url)) {
        // запись файлов и запуск — только со своей страницы
        if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:' + port) return json(res, 403, { error: 'только со страницы установщика' });
        const b = await readBody(req), ch = b.choice || {};
        try {
          const auth = ch.kc === 'own' || ch.kc === 'none' ? (b.issuer ? 'true' : 'false') : 'false';
          const env = () => installEnvText(INSTALL_BUNDLE.files['.env.example'], {
            LORE_VERSION: b.version || '', LORE_HTTP_PORT: String(b.port || 4400), LORE_AUTH_ENABLED: auth, LORE_OIDC_ISSUER: b.issuer || '',
            LORE_OIDC_ORIGIN: b.issuer ? new URL(b.issuer).origin : '',
            // встройка Völva: издатель — origin веба LORE (EMB-L6); без адреса веба — только адреса Völva, ES256 не включится
            // Forgejo (20.11.2026): профили compose и адреса; токены сюда не идут — их вписывает владелец
            ...forgejoEnv({ forgejo: ch.forgejo || 'none', url: b.forgejoUrl || '' }),
            // локальная LLM (20.11.2026): адрес и имя модели; ключ сюда не идёт — его вписывает владелец
            ...llmEnv({ llm: ch.llm || 'none', url: b.llmUrl || '', model: b.llmModel || '' }),
            ...((ch.components || []).includes('volva') && b.volva ? (b.web ? volvaEmbedEnv({ web: b.web, volva: b.volva }).lore : { LORE_VOLVA_ORIGIN: new URL(b.volva).origin, LORE_VOLVA_EMBED_SITE_URL: b.volva }) : {}),
          });
          const volvaSide = (ch.components || []).includes('volva') && b.volva && b.web ? volvaEmbedEnv({ web: b.web, volva: b.volva }).volva : null;
          if (req.url === '/api/setup/env') return json(res, 200, { text: env(), note: 'пароли останутся CHANGE_ME — install.sh сгенерирует их сам; вход ' + (auth === 'true' ? 'через Keycloak' : 'выключен')
            + (ch.forgejo === 'install' || ch.forgejo === 'own' ? '. Forgejo: токены FORGEJO_API_TOKEN (мост LORE) и FORGEJO_MCP_TOKEN (forgejo-mcp) впишите в .env сами; ключ FORGEJO_MCP_API_KEY сгенерирует install.sh' : '')
            + (volvaSide ? '. На стороне Völva: MB_EMBEDDING_JWT_ISSUERS=' + volvaSide.MB_EMBEDDING_JWT_ISSUERS + ', ключи — ' + volvaSide.jwks : (ch.components || []).includes('volva') ? '. Издатель Völva не задан — впишите «Адрес веба LORE», иначе подпись останется временной HS256' : '') });
          if (req.url === '/api/setup/install-plan') {
            const fromSource = ch.images === 'source';
            const args = installArgs({ dir: b.dir, version: b.version, port: b.port, dry: true, fromSource });
            const cmd = 'bash install.sh ' + args.join(' ');
            // Правило владелицы 16.11: установщик не зависит от операционки и не запускает программ. Поэтому пакет
            // установки с готовым .env выкладывается в папку, а запуск install.sh — команда для Linux-машины.
            const out = path.join(os.homedir(), 'lore-install');
            fs.mkdirSync(out, { recursive: true });
            for (const [n, t] of Object.entries(INSTALL_BUNDLE.files)) if (n !== '.env.example') fs.writeFileSync(path.join(out, n), t, { mode: n.endsWith('.sh') ? 0o755 : 0o644 });
            fs.writeFileSync(path.join(out, '.env.example'), env(), { mode: 0o600 });
            return json(res, 200, { text: cmd + String.fromCharCode(10) + 'bash install.sh ' + installArgs({ dir: b.dir, version: b.version, port: b.port, fromSource }).join(' '), note: 'пакет установки с вашим .env выложен в ' + out + '. Скопируйте папку на Linux-машину с Docker и выполните сначала план (первая строка), потом установку (вторая).'
              + (fromSource ? ' Сборка из исходников: рядом с install.sh положите каталог src/ из каталога версии пакета (src/lore-<версия>.tar.gz и .sha256) — без него install.sh остановится и назовёт причину.' : '') });
          }
          if (req.url === '/api/setup/volva-keys') {
            const dir = b.dir && fs.existsSync(b.dir) ? b.dir : os.homedir();
            const file = path.join(dir, 'volva-embed.env');
            if (fs.existsSync(file)) return json(res, 409, { error: 'ключи уже есть: ' + file + ' — не перезаписываю' });
            const k = volvaKeys();
            fs.writeFileSync(file, Object.entries(k).map(([n, v]) => n + '=' + v).join('\n') + '\n', { mode: 0o600 });
            return json(res, 200, { text: 'LORE_VOLVA_EMBED_ES256_PUBLIC_KEY=' + k.LORE_VOLVA_EMBED_ES256_PUBLIC_KEY, note: 'пара ES256 записана в ' + file + ' (права 600); на экране — только открытый ключ. Перенесите оба в хранилище или .env установки.' });
          }
          if (req.url === '/api/setup/link-toml') {
            if (!b.minilore) return json(res, 400, { error: 'не задан адрес сервера miniLORE' });
            const file = path.join(os.homedir(), 'minilore-link.toml');
            const text = linkConfigToml({ serverUrl: b.minilore, issuer: b.issuer || '', machineId: b.machineId, secret: '' });
            fs.writeFileSync(file, text, { mode: 0o600 });
            return json(res, 200, { text, note: 'файл ' + file + '; секрет пустой — он появится, когда установщик заведёт клиент minilore-link-' + b.machineId + ' в Keycloak' });
          }
        } catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (req.method === 'POST' && req.url === '/api/setup/kc-realm') {
        // Новая установка: область и клиенты Keycloak (слово владелицы 17.11 «ты реинсталлишь»). Только со своей страницы;
        // пароль администратора — только в этом запросе, не сохраняется и не пишется в журнал.
        if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:' + port) return json(res, 403, { error: 'только со страницы установщика' });
        const b = await readBody(req);
        // OH-MCP-HOSTED-SWITCH (слово владелицы 21.11 «везде KC секреты спрашивай — может, у них свои уже установлены»):
        // сначала выбор, что уже есть; заводить и писать секреты — только по явному «за меня».
        let form, kcUrl, realm;
        try { form = kcForm(b); ({ kcUrl, realm } = issuerParts(b.issuer)); }
        catch (e) { return json(res, 400, { error: e.message }); }
        if (form.mode === 'ask') return json(res, 400, { error: 'выберите, что уже есть в Keycloak: ничего / своя область / LORE уже стоит / свои клиенты и секреты' });
        if (form.mode === 'own') {
          // Свои клиенты и секреты: ни одного запроса к admin API — только токен по их паре из их окружения.
          const accounts = form.accounts.map(a => ({ ...a, secretVar: form.secretVars[a.role] || a.secretKey }));
          if (!b.apply) return json(res, 200, { plan: accounts.map(a => ({ id: 'token-check:' + a.clientId, method: 'POST', path: '/realms/' + realm + '/protocol/openid-connect/token (' + a.secretVar + ')' })) });
          return json(res, 200, { results: (await checkOwnClients({ issuer: b.issuer, accounts })).map(r => ({ id: 'token-check:' + r.clientId, state: r.state === 'ok' ? 'exists' : r.state, reason: r.reason + '; LORE_MCP_SECRET_VAR=' + r.secretVar })) });
        }
        const writeSecrets = async sec => {
          const NL = String.fromCharCode(10), inf = infisicalConfig();
          const file = path.join(os.homedir(), 'kc-clients-' + realm + '.env');
          if (inf) {
            const out = await upsertSecrets(inf, sec);
            const failed = out.filter(x => x.state !== 'written');
            if (!failed.length) return 'Infisical (' + inf.environment + ', ' + inf.path + '): ' + out.map(x => x.key).join(', ');
            // Сбой записи — секреты не теряются: файл 600 и громкая причина.
            fs.writeFileSync(file, Object.entries(sec).map(([k, v]) => k + '=' + v).join(NL) + NL, { mode: 0o600 });
            throw new Error('Infisical не принял ' + failed.map(x => x.key + ' (' + x.reason + ')').join(', ') + ' — все секреты лежат в ' + file + ' (права 600)');
          }
          fs.writeFileSync(file, Object.entries(sec).map(([k, v]) => k + '=' + v).join(NL) + NL, { mode: 0o600 });
          return file + ' (права 600; запись в Infisical не настроена)';
        };
        if (form.mode === 'topup') {
          if (!b.kcAdmin || !b.kcPassword) return json(res, 400, { error: 'доводке нужен вход администратора Keycloak: она читает, что уже заведено' });
          return json(res, 200, await topUpRealm({ kcUrl, adminUser: b.kcAdmin, adminPassword: b.kcPassword, realm, accounts: form.accounts, apply: !!b.apply, writeSecrets }));
        }
        let steps;
        try { steps = realmPlan({ realm, webOrigin: b.web, harnesses: form.harnesses, extraRoles: form.extraRoles, names: form.names, ownRealm: form.mode === 'own-realm' }); }
        catch (e) { return json(res, 400, { error: e.message }); }
        if (!b.apply) return json(res, 200, { plan: steps.map(x => ({ id: x.id, method: x.method, path: x.path })) });
        if (!b.kcAdmin || !b.kcPassword) return json(res, 400, { error: 'нужны логин и пароль администратора Keycloak' });
        const out = await applyRealm({ kcUrl, adminUser: b.kcAdmin, adminPassword: b.kcPassword, steps, writeSecrets, realm });
        return json(res, 200, out);
      }
      if (req.method === 'POST' && req.url === '/api/setup/machine') {
        // machine_new из окна: план (dry_run), запись — только с apply:true и только со своей страницы. Вход — токен шага 0.
        if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:' + port) return json(res, 403, { error: 'только со страницы установщика' });
        const b = await readBody(req), token = tokens.get(sid(req));
        if (!token) return json(res, 400, { error: 'нужен вход на шаге 0: машину заводят от имени человека' });
        let base, body;
        try { base = new URL(b.backendUrl); if (!/^https?:$/.test(base.protocol)) throw new Error(); } catch { return json(res, 400, { error: 'адрес бэкенда LORE — http(s)://хост:порт' }); }
        try { body = enrollBody({ machineId: b.machineId, harness: b.harness, dryRun: !b.apply }); } catch (e) { return json(res, 400, { error: e.message }); }
        let r;
        try {
          const x = await fetch(new URL('lore/actor/machine', base), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
          r = { status: x.status, body: await x.text() };
        } catch (e) { r = { error: e.cause?.code || e.message }; }
        return json(res, 200, { ...enrollVerdict(r), machineId: body.machine_id });
      }
      if (req.method === 'POST' && req.url === '/api/setup/check') {
        // Только чтение: два GET к LORE. Ключ Völva для сверки — из volva-embed.env, который выдал установщик.
        const b = await readBody(req);
        let base;
        try { base = new URL(b.backendUrl); if (!/^https?:$/.test(base.protocol)) throw new Error(); } catch { return json(res, 400, { error: 'адрес бэкенда LORE — http(s)://хост:порт' }); }
        const get = async p => { try { const r = await fetch(new URL(p, base), { signal: AbortSignal.timeout(8000) }); return { status: r.status, body: await r.text() }; } catch (e) { return { error: e.cause?.code || e.message }; } };
        let pub = '';
        for (const d of [b.dir, os.homedir()].filter(Boolean)) { try { pub = (fs.readFileSync(path.join(d, 'volva-embed.env'), 'utf8').match(/^LORE_VOLVA_EMBED_ES256_PUBLIC_KEY=(.+)$/m) || [])[1] || ''; if (pub) break; } catch { /* нет файла */ } }
        const [jw, wh] = await Promise.all([get('lore/embed/jwks'), get('lore/whoami')]);
        return json(res, 200, { checks: [
          { name: 'Völva: ключ встройки', ...jwksVerdict(jw, pub.trim() || undefined) },
          { name: 'LORE: whoami', ...whoamiVerdict(wh, { machineId: b.machineId }) },
        ] });
      }
      if (req.method === 'POST' && req.url === '/api/setup/plan') {
        try { return json(res, 200, { plan: planSetup(await readBody(req)) }); } catch (e) { return json(res, 400, { error: e.message }); }
      }
      if (req.method === 'POST' && (req.url === '/api/setup/mcp/preview' || req.url === '/api/setup/mcp/apply')) {
        // запись в настройки — только со своей страницы: чужой сайт не может послать JSON на 127.0.0.1 с нашим Origin
        if (req.url.endsWith('/apply') && req.headers.origin && req.headers.origin !== 'http://127.0.0.1:' + port) return json(res, 403, { error: 'запись только со страницы установщика' });
        const b = await readBody(req);
        let entry; try { entry = mcpEntry(b); } catch (e) { return json(res, 400, { error: e.message }); }
        const claude = b.harness === 'claude' || b.harness === 'claude-code';
        const file = path.join(os.homedir(), '.claude.json');
        if (req.url.endsWith('/preview')) return json(res, 200, { entry, canApply: claude, note: claude ? 'запишется в ' + file + ' (сервер aida-lore; секрет клиента сохраняется прежний)' : 'для этого harness вставьте строку в его настройки MCP сами' });
        if (!claude || b.confirm !== true) return json(res, 400, { error: 'записать можно только в настройки Claude Code и только с подтверждением' });
        const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}\n';
        const next = applyMcpEntry(text, entry);
        const backup = file + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
        if (fs.existsSync(file)) fs.copyFileSync(file, backup);
        const tmp = file + '.tmp-lore'; fs.writeFileSync(tmp, next, { mode: 0o600 }); fs.renameSync(tmp, file);
        return json(res, 200, { entry, written: file, backup: fs.existsSync(backup) ? backup : null });
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
          // шаг В: вид продукта решает человек; пока у продукта нет вида — перенос не начинается
          const pks = productKindState((await readProductKindInput(db)).products, readDoc());
          if (!pks.ready) return json(res, 409, { error: 'перенос не начинается: нет вида у продуктов ' + pks.missing.join(', ') + ' (шаг В)' });
          runJob('transfer', readDoc(), (me(req) || {}).login);
        } else if (what === 'fingerprint') runJob('fingerprint');
        else return json(res, 400, { error: 'неизвестное задание' });
        return json(res, 202, { started: what });
      }
      if (req.method === 'GET' && req.url === '/api/dryrun') {
        const report = await dryRun(db, readDoc());
        return json(res, 200, { ...report, fingerprint: reportFingerprint(report) });
      }
      // Шаг В: вид продукта (владелица 19.11.2026: «продукт · вид — в wizard переноса»)
      if (req.method === 'GET' && req.url === '/api/product-kind') {
        const input = await readProductKindInput(db), doc = readDoc(), m = productKindMap(doc), state = productKindState(input.products, doc);
        const rows = proposeProductKinds(input).map(r => ({ ...r, kind: state.kinds[r.code] || null, decided: Boolean(m[r.code]) }));
        return json(res, 200, { rows, state, by: (doc.product_kind || {}).by || null, at: (doc.product_kind || {}).at || null });
      }
      if (req.method === 'POST' && req.url === '/api/product-kind') {
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 1e5) throw new Error('слишком большой запрос'); }
        const b = JSON.parse(body); const who = me(req);
        const by = who ? who.login : (b.by || '').trim();
        if (!by) return json(res, 400, { error: 'не записано: не сказано, кто принял (поле «кто принимает решения»)' });
        const next = withProductKinds(readDoc(), b.map, by);
        fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
        return json(res, 200, { ok: true });
      }
      // Шаг Р: решения → вехи (владелица 19.11.2026: «веху храним, просто при переносе вычисляем»; с ADR — не связываем)
      if (req.method === 'GET' && req.url === '/api/decision-milestones') {
        const doc = readDoc(), input = await readDecisionMilestoneInput(db);
        const plan = planDecisionMilestones({ rules: decisionMilestoneRules(DECISION_MILESTONES), doc, ...input });
        const titles = new Map(input.decisions.map(d => [d.decision_id, d.title]));
        const human = Object.entries(decisionMilestoneMap(doc)).filter(([id]) => titles.has(id) && !plan.with_adr_skipped.includes(id)).map(([decision, milestone]) => ({ decision, milestone, title: titles.get(decision) }));
        return json(res, 200, { counts: plan.counts, waiting: plan.waiting, human,
          time: plan.edges.filter(e => e.method === 'time-window').map(e => ({ ...e, title: titles.get(e.decision) })),
          milestones: input.milestones.map(m => m.milestone_id).sort(), by: (doc.decision_milestones || {}).by || null, at: (doc.decision_milestones || {}).at || null });
      }
      if (req.method === 'POST' && req.url === '/api/decision-milestones') {
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 1e5) throw new Error('слишком большой запрос'); }
        const b = JSON.parse(body); const who = me(req);
        const by = who ? who.login : (b.by || '').trim();
        if (!by) return json(res, 400, { error: 'не записано: не сказано, кто принял (поле «кто принимает решения»)' });
        fs.writeFileSync(file, JSON.stringify(withDecisionMilestones(readDoc(), b.map, by), null, 2) + '\n');
        return json(res, 200, { ok: true });
      }
      // Шаг С: ссылки решений (MDL-08 ч.3; владелица 20.11.2026 про решение 23 → «v1.0.0» у трёх проектов: «визардом
      // с возможностью выбрать в миграции») — неоднозначные и ненайденные ссылки; ответ — в файл решений, DR-NN
      if (req.method === 'GET' && req.url === '/api/decision-refs') {
        const plan = await refsPlan(readDoc());
        return json(res, 200, { rows: plan.review, counts: plan.review_counts, projects: [...new Set(plan.review.flatMap(r => r.projects))].sort() });
      }
      if (req.method === 'POST' && req.url === '/api/decision-refs') {
        const b = await readBody(req); const who = me(req);
        const doc = readDoc();
        const next = withRefAnswer(doc, b, who ? who.login : (b.by || '').trim(), undefined, await refsPlan(doc));
        const bad = checkDecisions(next);
        if (bad.length) return json(res, 400, { error: 'не записано: ' + bad.join('; ') });
        fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
        const saved = next.decisions.find(d => d.scope.type === 'decision_refs' && d.scope.decision === String(b.decision) && d.scope.field === b.field && d.scope.value === String(b.value).trim());
        return json(res, 200, { ok: true, id: saved.id });
      }
      // Шаг З: задачи без спринта (владелица 19.11.2026: «без спринта реконструировать ребро в визарде предложить
      // владельцу привязать») — предложение с основанием, ответ человека — в файл решений, раздел orphan_sprints
      if (req.method === 'GET' && req.url === '/api/orphan-sprints') {
        const doc = readDoc(), input = await readOrphanSprintInput(q => db.src(q));
        const rows = proposeOrphanSprints(input), answers = orphanSprintAnswers(doc);
        const st = orphanSprintState(rows, answers);
        return json(res, 200, { rows, answers, waiting: st.waiting, sprints: [...input.sprints].sort(), by: (doc.orphan_sprints || {}).by || null, at: (doc.orphan_sprints || {}).at || null });
      }
      if (req.method === 'POST' && req.url === '/api/orphan-sprints') {
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 1e5) throw new Error('слишком большой запрос'); }
        const b = JSON.parse(body); const who = me(req);
        const by = who ? who.login : (b.by || '').trim();
        if (!by) return json(res, 400, { error: 'не записано: не сказано, кто принял (поле «кто принимает решения»)' });
        fs.writeFileSync(file, JSON.stringify(withOrphanSprints(readDoc(), b.map, by), null, 2) + '\n');
        return json(res, 200, { ok: true });
      }
      // Шаг Зв: вид зависимостей без вида (MDL-13, владелица 20.11.2026: «визард для миграции у нас прочесть и предложить»)
      if (req.method === 'GET' && req.url === '/api/dep-kinds') {
        const doc = readDoc(), rows = proposeDepKinds(await readDepKindInput(q => db.src(q)), RULES), answers = depKindAnswers(doc);
        const kinds = RULES.dictionaries.dependency_kind.codes.map(c => ({ code: c.code, label: c.labels.ru }));
        return json(res, 200, { rows, answers, kinds, waiting: depKindState(rows, answers).waiting, by: (doc.dependency_kinds || {}).by || null, at: (doc.dependency_kinds || {}).at || null });
      }
      if (req.method === 'POST' && req.url === '/api/dep-kinds') {
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 1e5) throw new Error('слишком большой запрос'); }
        const b = JSON.parse(body); const who = me(req);
        const by = who ? who.login : (b.by || '').trim();
        if (!by) return json(res, 400, { error: 'не записано: не сказано, кто принял (поле «кто принимает решения»)' });
        fs.writeFileSync(file, JSON.stringify(withDepKinds(readDoc(), b.map, by, RULES), null, 2) + '\n');
        return json(res, 200, { ok: true });
      }
      // Шаг Ж: ожидание → связи (MDL-13, владелица 20.11.2026: «ок связь где можно где нет текст»)
      if (req.method === 'GET' && req.url === '/api/waiting-links') {
        const doc = readDoc(), input = await readWaitingLinkInput(q => db.src(q));
        const rows = proposeWaitingLinks(input.rows, input.reg), answers = waitingLinkAnswers(doc);
        return json(res, 200, { rows, answers, kind: WAIT_KIND, counts: waitingLinkState(rows, answers).counts, by: (doc.waiting_links || {}).by || null, at: (doc.waiting_links || {}).at || null });
      }
      if (req.method === 'POST' && req.url === '/api/waiting-links') {
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 1e5) throw new Error('слишком большой запрос'); }
        const b = JSON.parse(body); const who = me(req);
        const by = who ? who.login : (b.by || '').trim();
        if (!by) return json(res, 400, { error: 'не записано: не сказано, кто принял (поле «кто принимает решения»)' });
        fs.writeFileSync(file, JSON.stringify(withWaitingLinks(readDoc(), b.map, by), null, 2) + '\n');
        return json(res, 200, { ok: true });
      }
      // Шаг П: перегруппировка проектов (владелица 19.11.2026: «сделай отдельное меню с предложением перегруппировки»)
      if (req.method === 'GET' && req.url === '/api/regroup') {
        return json(res, 200, proposeRegroup({ ...(await readRegroupInput(db)), overrides: regroupOverrides(readDoc()) }));
      }
      if (req.method === 'POST' && req.url === '/api/regroup') {
        let body = ''; for await (const ch of req) { body += ch; if (body.length > 1e6) throw new Error('слишком большой запрос'); }
        const b = JSON.parse(body); const who = me(req);
        const next = withRegroupOverrides(readDoc(), b.overrides, who ? who.login : (b.by || null), undefined, b.repos);
        fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
        return json(res, 200, { ok: true });
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
        // проверка до записи: негодное решение не должно испортить файл решений
        const bad = decisionsAgainstRules(RULES, doc);
        if (bad.length) return json(res, 400, { error: 'не записано: ' + bad.join('; ') });
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
const propArg = process.argv.indexOf('--proposals');
if (process.argv[1] === 'ui') serve({ port: portArg > 0 ? +process.argv[portArg + 1] : 2499, proposalsFile: propArg > 0 ? path.resolve(process.argv[propArg + 1]) : null }).catch(e => { console.error('ошибка: ' + e.message); process.exitCode = 1; });
