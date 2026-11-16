#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Перенос связей первого объекта, у которых оба конца уже в приёмнике.
// Запускается после transfer.mjs. По карте связей (map/*.edges.json): keep — переносится; wait — считается
// и ждёт своего объекта; drop — не переносится. Связь, которой нет в карте, — ошибка.
// Источник только читается; в приёмнике пересоздаются только типы связей этого шага.
// Сверка: число связей каждого типа и каждая пара концов (по адресам записей источника) совпали.
import fs from 'node:fs';
import { connect } from './db.mjs';

import { EDGES } from './resources.mjs';
const OWN = ['KnowSprint', 'KnowSprintHist', 'KnowPhase', 'KnowPhaseHist', 'KnowTask', 'KnowTaskHist'];
const db = connect();
if (!/^migration_dst/.test(db.env.MIG_DST_DB)) throw new Error('приёмник должен называться migration_dst*');
const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); };

// адрес записи источника → адрес в приёмнике
const dstRid = new Map();
for (const T of OWN) {
  let last = '#-1:-1';
  for (;;) {
    const rows = await db.dstQuery(`SELECT @rid AS r, mig_src_rid AS s FROM ${T} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`);
    if (!rows.length) break;
    for (const x of rows) dstRid.set(x.s, x.r);
    last = rows[rows.length - 1].r; if (rows.length < 5000) break;
  }
}
if (!dstRid.size) throw new Error('в приёмнике нет записей первого объекта — сначала transfer.mjs');

const srcTypes = await db.src("SELECT name, type, records FROM schema:types");
const report = { source: db.env.MIG_SRC_DB, target: db.env.MIG_DST_DB, moved: {}, waiting: {}, dropped: {}, anomalies: [], unknown: [] };
const dstTypes = new Set((await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name));
let ok = true;

for (const e of srcTypes.filter(t => t.type === 'edge' && t.records > 0)) {
  const ends = await db.src(`SELECT o, i, count(*) AS n FROM (SELECT @out.@type AS o, @in.@type AS i FROM ${e.name}) GROUP BY o, i`);
  const mine = ends.filter(x => OWN.includes(x.o) || OWN.includes(x.i));
  if (!mine.length) continue;
  const rule = EDGES[e.name];
  if (!rule) { report.unknown.push(e.name); ok = false; continue; }
  const touching = mine.reduce((a, x) => a + x.n, 0);
  if (rule.rule === 'drop') { report.dropped[e.name] = touching; continue; }
  if (rule.rule === 'wait') { report.waiting[e.name] = { links: touching, waits: rule.waits }; continue; }
  if (e.name === 'HAS_STATE') {
    // перенесена этапом записи версий; здесь только сверка и разбор аномалий
    const inside = mine.filter(x => !x.o.endsWith('Hist') && x.i === x.o + 'Hist').reduce((a, x) => a + x.n, 0);
    const odd = mine.filter(x => !(!x.o.endsWith('Hist') && x.i === x.o + 'Hist'));
    for (const x of odd) report.anomalies.push({ edge: e.name, from: x.o, to: x.i, n: x.n, why: 'связь «запись → версия» стоит не в ту сторону или между чужими типами; не переносится' });
    const got = (await db.dstQuery('SELECT count(*) AS n FROM HAS_STATE'))[0].n;
    report.moved[e.name] = { source: inside, target: got };
    if (inside !== got) ok = false;
    continue;
  }
  // keep: читаем связи источника, у которых оба конца — записи первого объекта
  const props = rule.props || [];
  const list = [];
  let last = '#-1:-1';
  for (;;) {
    const rows = await db.src(`SELECT @rid AS r, @out AS o, @in AS i${props.map(p => `, ${p}`).join('')} FROM ${e.name} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`);
    if (!rows.length) break;
    for (const x of rows) list.push(x);
    last = rows[rows.length - 1].r; if (rows.length < 5000) break;
  }
  const inside = list.filter(x => dstRid.has(x.o) && dstRid.has(x.i));
  const outside = list.length - inside.length;
  if (dstTypes.has(e.name)) await db.dstCommand(`DROP TYPE ${e.name} UNSAFE`);
  await db.dstCommand(`CREATE EDGE TYPE ${e.name}`);
  await db.dstCommand(`CREATE PROPERTY ${e.name}.mig_src_rid STRING`);
  await pool(inside, 8, x => {
    const c = { mig_src_rid: x.r };
    for (const p of props) if (x[p] !== undefined && x[p] !== null && x[p] !== '') c[p] = x[p];
    return db.dstCommand(`CREATE EDGE ${e.name} FROM ${dstRid.get(x.o)} TO ${dstRid.get(x.i)} CONTENT :c`, { c });
  });
  // сверка: каждая связь приёмника соединяет те же записи, что в источнике
  const want = new Map(inside.map(x => [x.r, `${x.o}>${x.i}`]));
  let got = 0, bad = 0; last = '#-1:-1';
  for (;;) {
    const rows = await db.dstQuery(`SELECT @rid AS r, mig_src_rid AS s, @out.mig_src_rid AS o, @in.mig_src_rid AS i FROM ${e.name} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`);
    if (!rows.length) break;
    for (const x of rows) { got++; if (want.get(x.s) !== `${x.o}>${x.i}`) bad++; }
    last = rows[rows.length - 1].r; if (rows.length < 5000) break;
  }
  report.moved[e.name] = { source: inside.length, target: got, wrong_ends: bad, props, to_other_objects: outside };
  if (got !== inside.length || bad) ok = false;
}
report.ok = ok;
for (const [k, v] of Object.entries(report.moved)) console.log(`перенесено ${k}: ${JSON.stringify(v)}`);
console.log('ждут своего объекта:', Object.entries(report.waiting).map(([k, v]) => `${k} ${v.links}`).join(' · '));
console.log('не переносится:', JSON.stringify(report.dropped), '· аномалии:', JSON.stringify(report.anomalies), '· вне карты:', JSON.stringify(report.unknown));
console.log('сверка связей:', ok ? 'сошлась' : 'НЕ сошлась');
const o = process.argv.indexOf('--out');
if (o > 0) fs.writeFileSync(process.argv[o + 1], JSON.stringify(report, null, 1));
process.exit(ok ? 0 : 1);
