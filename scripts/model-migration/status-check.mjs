#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Проверка статусов перед переносом — только чтение источника.
// Считает, какие значения статуса встречены в источнике, сводит их к кодам по правилам
// (rules/status-unification.json) и решениям человека, печатает диалог унификации. Код выхода 1 —
// есть строки, ждущие решения: перенос начинать нельзя.
// Запуск: MIG_ENV_FILE=… node scripts/model-migration/status-check.mjs [--out диалог.json]
import fs from 'node:fs';
import { connect } from './db.mjs';
import { loadDecisions, FORMAT as DECISIONS_FORMAT } from './decisions.mjs';
import { collectStatusDialog } from './status-run.mjs';

import { RULES } from './resources.mjs';
const decisions = loadDecisions() || { format: DECISIONS_FORMAT, decisions: [] };
const db = connect();

// Сбор диалога — общий с интерфейсом установщика (status-run.mjs): один и тот же отпечаток в команде и в отчёте.
const dialog = await collectStatusDialog(db, RULES, decisions);

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
// Отпечаток для приёмки на двух машинах: одинаковые настройки и источник → одинаковый отпечаток.
console.log(`отпечаток итога: ${dialog.fingerprint}`);
// «Не смогли прочитать» — не «ждёт решения»: причина стопа называется своя.
console.log(dialog.unread.length ? `СТОП: источник прочитан не весь (${dialog.unread.length} полей) — проверка не выполнена, перенос не начинается`
  : dialog.ready ? 'ГОТОВО: статусы сведены, перенос можно начинать' : 'СТОП: есть статусы без решения — перенос не начинается');
process.exit(dialog.ready ? 0 : 1);
