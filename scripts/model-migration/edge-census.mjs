#!/usr/bin/env node
// MIG-01 · Перепись связей первого объекта по снимку: какие типы связей касаются спринта, фазы, задачи и
// их версий, между какими типами они стоят, сколько их и какие у связи свойства. Только чтение источника.
import fs from 'node:fs';
import { connect } from './db.mjs';

const OWN = ['KnowSprint', 'KnowSprintHist', 'KnowPhase', 'KnowPhaseHist', 'KnowTask', 'KnowTaskHist'];
const db = connect();
const types = await db.src("SELECT name, type, records, properties FROM schema:types");
const edgeTypes = types.filter(t => t.type === 'edge' && t.records > 0);
const out = { source: db.env.MIG_SRC_DB, edges: [] };
for (const e of edgeTypes) {
  const ends = await db.src(`SELECT o, i, count(*) AS n FROM (SELECT @out.@type AS o, @in.@type AS i FROM ${e.name}) GROUP BY o, i`);
  const mine = ends.filter(x => OWN.includes(x.o) || OWN.includes(x.i));
  if (!mine.length) continue;
  const declared = (e.properties || []).map(p => `${p.name}:${p.type}`);
  // свойства, реально встречающиеся на связи (по образцу), кроме служебных движка
  const sample = await db.src(`SELECT FROM ${e.name} LIMIT 300`);
  const seen = {};
  for (const r of sample) for (const k of Object.keys(r)) if (!k.startsWith('@')) seen[k] = (seen[k] || 0) + 1;
  out.edges.push({ edge: e.name, total: e.records, ends: mine.map(x => ({ from: x.o, to: x.i, n: x.n, inside: OWN.includes(x.o) && OWN.includes(x.i) })), declared, seen_in_sample: seen });
}
out.edges.sort((a, b) => b.total - a.total);
for (const e of out.edges) console.log(`${e.edge} · всего ${e.total} · ${e.ends.map(x => `${x.from}→${x.to}: ${x.n}${x.inside ? '' : ' (наружу)'}`).join('; ')} · свойства: ${Object.keys(e.seen_in_sample).join(', ') || '—'}`);
const o = process.argv.indexOf('--out');
if (o > 0) fs.writeFileSync(process.argv[o + 1], JSON.stringify(out, null, 1));
