#!/usr/bin/env node
// MIG-01 · Смена слоя поля на настоящих данных: что объявлено в схеме источника СЕЙЧАС против слоя поля в
// новой модели, и какие виды значений реально лежат в полях, меняющих слой. Только чтение источника.
import fs from 'node:fs';
import { connect } from './db.mjs';

const here = p => new URL(p, import.meta.url);
const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const MAP = J(here('./map/sprint-phase-task.json')).types;
const TEXTS = J(here('./texts/sprint-phase-task.json')).types;
const db = connect();

const schema = await db.src('SELECT name, properties FROM schema:types');
const declared = {};
for (const t of schema) if (MAP[t.name]) declared[t.name] = Object.fromEntries((t.properties || []).map(p => [p.name, p.type]));

const LAYER = { ddl: 'стабильное', json: 'опциональное' };
const out = { source: db.env.MIG_SRC_DB, quadrants: {}, fields: [] };
for (const [T, fields] of Object.entries(MAP)) for (const [f, e] of Object.entries(fields)) {
  const tx = TEXTS[T]?.[f] || {};
  if (e.rule === 'drop' || tx.service) continue;
  const was = declared[T]?.[f] ? 'объявлено' : 'не объявлено';
  const will = LAYER[tx.layer] || 'слой не решён';
  const key = `${was} → ${will}`;
  (out.quadrants[key] ||= []).push(`${T}.${f}`);
  const row = { T, f, was, was_type: declared[T]?.[f] || null, will, rule: e.rule, basis: e.basis || null };
  if (was === 'объявлено' ? will !== 'стабильное' : will !== 'опциональное') {
    const kinds = await db.src(`SELECT t, count(*) AS n FROM (SELECT ${f}.type() AS t FROM ${T} WHERE ${f} IS NOT NULL) GROUP BY t`);
    row.kinds = Object.fromEntries(kinds.map(k => [k.t, k.n]));
  }
  out.fields.push(row);
}
for (const k of Object.keys(out.quadrants).sort()) console.log(`${k}: ${out.quadrants[k].length}`);
console.log('— поля, меняющие слой, и виды значений в них:');
for (const r of out.fields.filter(x => x.kinds)) console.log(`  ${r.T}.${r.f} · ${r.was}${r.was_type ? ' ' + r.was_type : ''} → ${r.will} · ${JSON.stringify(r.kinds)}`);
const o = process.argv.indexOf('--out');
if (o > 0) fs.writeFileSync(process.argv[o + 1], JSON.stringify(out, null, 1));
