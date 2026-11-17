#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Сухой прогон карты переноса по всем записям источника.
// Ничего не пишет: читает источник (только SELECT), пропускает каждую запись через исполнитель карты и
// считает, что вышло. Отвечает на три вопроса до первой записи в приёмник:
//   · знает ли карта каждое поле, которое есть в данных (поле вне карты — в «unknown», прогон не падает);
//   · сколько значений не привелось и почему («rejects», с образцами);
//   · сколько значений удержано до решения владелицы («held»).
// Запуск: MIG_ENV_FILE=… node scripts/model-migration/dry-run.mjs [--out отчёт.json]
import fs from 'node:fs';
import { loadDecisions } from './decisions.mjs';
const DECISIONS = loadDecisions(); // решения человека из раздела «Перенос»; файла нет — решений нет
import { connect } from './db.mjs';
import { fingerprint } from './fingerprint.mjs';
import { applyMap } from './apply-map.mjs';

import { MAP, VOCAB, CODE_CASE, RULES } from './resources.mjs';
// Справочник статуса по типу: первый объект — по справочникам базы; остальные типы — по источникам правил (17.11.2026).
const RULES_DICT_OF = Object.fromEntries(RULES.sources.filter(s => s.field === 'status_raw' || s.field === 'status').map(s => [s.type, s.dict]));
const DICT_OF = { ...RULES_DICT_OF, KnowSprintHist: 'sprint_status', KnowTaskHist: 'task_status', KnowPhaseHist: 'phase_status' };
// Статусы задач в истории фазы — к коду фазы правилом «статус фазы по задачам» (derive.map справочника).
const PHASE_MAP = Object.fromEntries(Object.entries(DICT_OF).map(([t, d]) => [t, ((RULES.dictionaries[d] || {}).derive || {}).map]));

/** Пробный расчёт без записи: отчёт по типам карты. Общий для команды dry-run и интерфейса установщика. */
export async function dryRun(db, DECISIONS) {
  const dictRows = await db.src("SELECT dict_type, code FROM KnowDictEntry WHERE dict_type IN ['sprint_status','task_status','phase_status']");
  const statusCodes = {};
  for (const r of dictRows) (statusCodes[r.dict_type] ||= []).push(r.code);

  const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  const report = { source: db.env.MIG_SRC_DB, types: {} };
  for (const T of Object.keys(MAP)) {
    const t = { records: 0, outFields: {}, toVersion: {}, dropped: {}, held: {}, unknown: {}, rejects: {}, titleFallback: 0, statusCodes: {} };
    const known = new Set(Object.keys(MAP[T]));
    for await (const rec of db.scan(T)) {
      t.records++;
      const clean = {};
      for (const [f, v] of Object.entries(rec)) { if (f.startsWith('@') || known.has(f)) clean[f] = v; else if (v !== null && v !== '') bump(t.unknown, f); }
      const r = applyMap(T, MAP[T], clean, { statusCodes, statusDict: DICT_OF[T], statusVocab: VOCAB, canonToCode: { in_progress: 'active' }, decisions: DECISIONS, codeCase: CODE_CASE, phaseStatusMap: PHASE_MAP[T], statusRules: RULES.dictionaries[RULES_DICT_OF[T]] });
      for (const f of Object.keys(r.out)) bump(t.outFields, f);
      for (const f of Object.keys(r.toVersion)) bump(t.toVersion, f);
      for (const f of r.dropped) bump(t.dropped, f);
      for (const f of Object.keys(r.held)) bump(t.held, f);
      if (r.titleFallback) t.titleFallback++;
      if ('status' in r.out) bump(t.statusCodes, r.out.status === null ? '(без кода)' : r.out.status);
      for (const x of r.rejects) {
        const k = `${x.field} · ${x.why}`;
        const e = (t.rejects[k] ||= { n: 0, samples: {} });
        e.n++;
        const s = String(x.value).replace(/\s+/g, ' ').slice(0, 60);
        if (Object.keys(e.samples).length < 12 || e.samples[s]) bump(e.samples, s);
      }
    }
    report.types[T] = t;
  }

  return report;
}

if (process.argv[1] === 'dry-run') {
const db = connect();
const report = await dryRun(db, DECISIONS);
const outArg = process.argv.indexOf('--out');
if (outArg > 0) fs.writeFileSync(process.argv[outArg + 1], JSON.stringify(report, null, 1));
for (const [T, t] of Object.entries(report.types)) {
  const rej = Object.values(t.rejects).reduce((a, e) => a + e.n, 0), held = Object.values(t.held).reduce((a, n) => a + n, 0);
  console.log(`${T}: записей ${t.records} · полей в новой записи ${Object.keys(t.outFields).length} · отказов ${rej} · удержано ${held} · снято ${Object.values(t.dropped).reduce((a, n) => a + n, 0)} · полей вне карты ${Object.keys(t.unknown).length}`);
  if (Object.keys(t.unknown).length) console.log('   ВНЕ КАРТЫ:', JSON.stringify(t.unknown));
  if (Object.keys(t.held).length) console.log('   удержано:', JSON.stringify(t.held));
  if (Object.keys(t.statusCodes).length) console.log('   статусы:', JSON.stringify(t.statusCodes), t.titleFallback ? `· не-статус → название: ${t.titleFallback}` : '');
  for (const [k, e] of Object.entries(t.rejects)) console.log(`   ОТКАЗ ${k}: ${e.n} — ` + Object.entries(e.samples).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => `«${s}»×${n}`).join(', '));
}
// Отпечаток для приёмки на двух машинах: одинаковые настройки и источник → одинаковый отпечаток.
console.log(`отпечаток итога: ${fingerprint(report)}`);
}
