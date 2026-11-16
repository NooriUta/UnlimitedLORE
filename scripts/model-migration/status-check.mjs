#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Проверка статусов перед переносом — только чтение источника.
// Считает, какие значения статуса встречены в источнике, сводит их к кодам по правилам
// (rules/status-unification.json) и решениям человека, печатает диалог унификации. Код выхода 1 —
// есть строки, ждущие решения: перенос начинать нельзя.
// Запуск: MIG_ENV_FILE=… node scripts/model-migration/status-check.mjs [--out диалог.json]
import fs from 'node:fs';
import { connect } from './db.mjs';
import { loadDecisions, FORMAT as DECISIONS_FORMAT } from './decisions.mjs';
import { buildDialog } from './status-unify.mjs';

import { RULES } from './resources.mjs';
const decisions = loadDecisions() || { format: DECISIONS_FORMAT, decisions: [] };
const db = connect();

// Типы источника, у которых есть история версий, читаются по версиям — так статус переносится; остальные — по записи.
const counts = [];
for (const s of RULES.sources) {
  let rows;
  try { rows = await db.src(`SELECT ${s.field} AS v, count(*) AS n FROM ${s.type} GROUP BY ${s.field}`); }
  catch (e) { counts.push({ type: s.type, field: s.field, value: null, n: 0, error: e.message.slice(0, 120) }); continue; }
  for (const r of rows) counts.push({ type: s.type, field: s.field, value: r.v ?? null, n: r.n });
}
const failed = counts.filter(c => c.error);
const dialog = buildDialog(counts.filter(c => !c.error), RULES, decisions);
dialog.source = db.env.MIG_SRC_DB;
dialog.unread = failed.map(c => ({ type: c.type, field: c.field, error: c.error }));
if (failed.length) dialog.ready = false; // «не смогли прочитать» — не «чисто»

const outArg = process.argv.indexOf('--out');
if (outArg > 0) fs.writeFileSync(process.argv[outArg + 1], JSON.stringify(dialog, null, 1));

const s = dialog.summary;
console.log(`источник ${dialog.source}${dialog.unread.length ? ' (ПРОЧИТАН НЕ ВЕСЬ)' : ''}: значений ${dialog.rows.length}, записей ${s.records}`);
console.log(`  свелось само: ${s.unified} · закрыто решением: ${s.decided} · ждёт решения: ${s.needs_decision} · без правила: ${s.no_rule} · записей ждёт: ${s.records_waiting}`);
for (const u of dialog.unread) console.log(`  НЕ ПРОЧИТАНО ${u.type}.${u.field}: ${u.error}`);
const short = v => v === null ? '(пусто)' : String(v).replace(/\s+/g, ' ').slice(0, 50);
const byType = {};
for (const r of dialog.rows.filter(r => r.state === 'needs_decision' || r.state === 'no_rule')) (byType[`${r.type}.${r.field}`] ||= []).push(r);
for (const [k, rows] of Object.entries(byType)) {
  rows.sort((a, b) => b.n - a.n);
  console.log(`  ${k} [${rows[0].dict || 'правила нет'}]: ${rows.length} значений, ${rows.reduce((a, r) => a + r.n, 0)} записей — ` +
    rows.slice(0, 12).map(r => `«${short(r.value)}»×${r.n}${r.suggest ? ` → ${r.suggest}?` : ''}`).join(', ') + (rows.length > 12 ? ` … и ещё ${rows.length - 12}` : ''));
}
// «Не смогли прочитать» — не «ждёт решения»: причина стопа называется своя.
console.log(dialog.unread.length ? `СТОП: источник прочитан не весь (${dialog.unread.length} полей) — проверка не выполнена, перенос не начинается`
  : dialog.ready ? 'ГОТОВО: статусы сведены, перенос можно начинать' : 'СТОП: есть статусы без решения — перенос не начинается');
process.exit(dialog.ready ? 0 : 1);
