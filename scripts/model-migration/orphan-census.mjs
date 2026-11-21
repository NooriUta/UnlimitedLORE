#!/usr/bin/env node
// MIG-01 · Перепись «потеряшек» по всему снимку: записи, у которых нет связи, без которой запись висит в
// воздухе. Раньше база этого не требовала — в новой модели обязательная связь становится правилом, поэтому
// каждую потеряшку надо либо привязать по смыслу, либо удалить (слова владелицы 16.11.2026).
// Только чтение источника. Что считать обязательной связью — ПРЕДЛОЖЕНИЕ исполнителя, перечень ниже.
import fs from 'node:fs';
import { connect } from './db.mjs';

const db = connect();
const types = await db.src('SELECT name, type, records FROM schema:types');
const vertex = new Map(types.filter(t => t.type === 'vertex').map(t => [t.name, t.records]));
const out = { source: db.env.MIG_SRC_DB, history: [], required: [] };
const n = async sql => (await db.src(sql))[0].n;

// 1. История: версия без записи, запись без версий, запись без текущей версии — для каждой пары «тип + типHist».
for (const [T, total] of vertex) {
  const H = T + 'Hist';
  if (!vertex.has(H) || !total) continue;
  const row = { type: T, records: total, versions: vertex.get(H) };
  row.versions_without_record = await n(`SELECT count(*) AS n FROM ${H} WHERE in('HAS_STATE').size() = 0`);
  row.records_without_versions = await n(`SELECT count(*) AS n FROM ${T} WHERE out('HAS_STATE').size() = 0`);
  row.records_without_current = await n(`SELECT count(*) AS n FROM ${T} WHERE out('HAS_STATE').size() > 0 AND out('HAS_STATE')[valid_to IS NULL].size() = 0`);
  row.records_with_two_current = await n(`SELECT count(*) AS n FROM ${T} WHERE out('HAS_STATE')[valid_to IS NULL].size() > 1`);
  out.history.push(row);
}

// 2. Обязательная связь (предложение): запись без неё — потеряшка.
const REQUIRED = [
  ['KnowTask', "out('PART_OF')", 'задача без спринта'],
  ['KnowPhase', "out('PART_OF')", 'фаза без спринта'],
  ['KnowSprint', "out('BELONGS_TO_PROJECT')", 'спринт без проекта'],
  ['KnowDecision', "out('DECIDED_IN')", 'решение без ADR'],
  ['KnowRelease', "out('BELONGS_TO_PROJECT')", 'релиз без проекта'],
  ['KnowADR', "out('BELONGS_TO_PROJECT')", 'ADR без проекта'],
  ['KnowSpec', "out('BELONGS_TO_PROJECT')", 'спека без проекта'],
  ['KnowDoc', "out('BELONGS_TO_PROJECT')", 'документ без проекта'],
  ['KnowQuestion', "out('BELONGS_TO_PROJECT')", 'вопрос без проекта'],
  ['KnowMilestone', "out('BELONGS_TO_PROJECT')", 'веха без проекта'],
  ['KnowPR', "out('BELONGS_TO_PROJECT')", 'PR без проекта'],
];
for (const [T, expr, label] of REQUIRED) {
  if (!vertex.get(T)) continue;
  try { out.required.push({ label, type: T, total: vertex.get(T), orphans: await n(`SELECT count(*) AS n FROM ${T} WHERE ${expr}.size() = 0`) }); }
  catch (e) { out.required.push({ label, type: T, total: vertex.get(T), error: e.message.slice(0, 120) }); }
}

console.log('ИСТОРИЯ (тип: записей / версий · версий без записи · записей без версий · без текущей версии · с двумя текущими)');
for (const r of out.history) if (r.versions_without_record || r.records_without_versions || r.records_without_current || r.records_with_two_current) console.log(`  ${r.type}: ${r.records} / ${r.versions} · ${r.versions_without_record} · ${r.records_without_versions} · ${r.records_without_current} · ${r.records_with_two_current}`);
console.log('  чистые пары:', out.history.filter(r => !(r.versions_without_record || r.records_without_versions || r.records_without_current || r.records_with_two_current)).map(r => r.type).join(', ') || '—');
console.log('ОБЯЗАТЕЛЬНАЯ СВЯЗЬ (предложение)');
for (const r of out.required) console.log(`  ${r.label}: ${r.error ? 'не посчитано — ' + r.error : r.orphans + ' из ' + r.total}`);
const o = process.argv.indexOf('--out');
if (o > 0) fs.writeFileSync(process.argv[o + 1], JSON.stringify(out, null, 1));
