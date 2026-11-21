#!/usr/bin/env node
// MIG-01 · Что лежит в статусах версий и какие коды есть в справочниках — только чтение источника.
// Печатает «голову» статуса (без значка, до приписки) со счётом: по ней составляется соответствие кодам.
import { connect } from './db.mjs';

const db = connect();
const lead = s => String(s).trim().replace(/^[^\p{L}\p{N}]+/u, '');
const head = s => lead(s).split(/\s+[—–\-:(]|\s{2,}|\s+\d{4}-/u)[0].trim().toUpperCase().slice(0, 40);

const dict = await db.src("SELECT dict_type, code, label FROM KnowDictEntry WHERE dict_type IN ['sprint_status','task_status','phase_status'] ORDER BY dict_type, code");
const byDict = {};
for (const r of dict) (byDict[r.dict_type] ||= []).push(r.code + (r.label ? ` «${r.label}»` : ''));
console.log('СПРАВОЧНИКИ', JSON.stringify(byDict, null, 1));

for (const T of ['KnowSprintHist', 'KnowPhaseHist', 'KnowTaskHist']) {
  const rows = await db.src(`SELECT status_raw AS s, count(*) AS n FROM ${T} WHERE status_raw IS NOT NULL GROUP BY status_raw`);
  const heads = {};
  for (const r of rows) heads[head(r.s)] = (heads[head(r.s)] || 0) + r.n;
  const sorted = Object.entries(heads).sort((a, b) => b[1] - a[1]);
  console.log(T, 'разных значений', rows.length, '· разных голов', sorted.length);
  console.log('  ' + sorted.slice(0, 40).map(([h, n]) => `${h}:${n}`).join(' | '));
}
