#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Конвейер пробного переноса первого объекта: спринт, фаза, задача и версии.
//
// Этапы (каждый печатает итог; отчёт целиком — файлом --out):
//   1 читает источник (только SELECT) и считает новую запись каждой старой — тем же исполнителем карты,
//     что и сухой прогон;
//   2 сводит: значение с записи кладётся в текущую версию, если там пусто; не-статус версии фазы — в
//     название фазы, если оно пусто;
//   3 создаёт в приёмнике типы по schema/<объект>.json и пишет записи, версии и связь «имеет состояние»;
//   4 складывает удержанное и не приведённое в служебный тип MigLeftover — ничего не теряется молча;
//   5 сверяет «до и после»: число записей и связей, и каждую запись приёмника поле в поле с расчётом.
//
// Приёмник — только база с именем migration_dst*; непустой приёмник трогается лишь с ключом --reset
// (удаляются только типы этого переноса). Источник не меняется: db.src отвергает всё, кроме чтения.
// Запуск: MIG_ENV_FILE=… node scripts/model-migration/transfer.mjs [--reset] [--out отчёт.json]
import fs from 'node:fs';
import { loadDecisions } from './decisions.mjs';
const DECISIONS = loadDecisions(); // решения человека из раздела «Перенос»; файла нет — решений нет
import crypto from 'node:crypto';
import { connect } from './db.mjs';
import { applyMap } from './apply-map.mjs';

import { MAP, SCHEMA, VOCAB, CODE_CASE, EDGES, RULES } from './resources.mjs';
import { writeDictionaries, ENTRY as DICT_ENTRY, LABEL as DICT_LABEL } from './dicts.mjs';
const DICT_OF = { KnowSprintHist: 'sprint_status', KnowTaskHist: 'task_status', KnowPhaseHist: 'phase_status' };
const BASES = ['KnowSprint', 'KnowPhase', 'KnowTask'];
const SERVICE = ['MigLeftover'], EDGE = 'HAS_STATE';
/** Типы новой базы, которые кладёт сам конвейер: записи, остаток, связь версий и связи с правилом keep (шаг связей). */
export const keptEdges = () => Object.entries(EDGES).filter(([n, r]) => r.rule === 'keep' && n !== EDGE).map(([n]) => n);
export const ownTypes = () => [...Object.keys(SCHEMA), ...SERVICE, EDGE, ...keptEdges(), DICT_ENTRY, DICT_LABEL];
const arg = k => process.argv.includes(k);
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;

/** Перенос записей с версиями в новую базу и сверка. log — куда писать ход; reset — разрешить непустой приёмник. */
export async function transfer(db, DECISIONS, { reset = false, log = console.log } = {}) {
  if (!/^migration_dst/.test(db.env.MIG_DST_DB)) throw new Error('приёмник должен называться migration_dst*: перенос пишет только в отдельную пробную базу');
  const report = { source: db.env.MIG_SRC_DB, target: db.env.MIG_DST_DB, stages: {} };
  const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); };
  const given = v => v !== undefined && v !== null && v !== '';

  // ── 1. Чтение и расчёт ────────────────────────────────────────────────────────────────────────────
  const dictRows = await db.src("SELECT dict_type, code FROM KnowDictEntry WHERE dict_type IN ['sprint_status','task_status','phase_status']");
  const statusCodes = {};
  for (const r of dictRows) (statusCodes[r.dict_type] ||= []).push(r.code);
  const calc = {}; // T → [{ rid, res }]
  for (const T of Object.keys(MAP)) {
    calc[T] = [];
    for await (const rec of db.scan(T)) calc[T].push({ rid: rec['@rid'], res: applyMap(T, MAP[T], rec, { statusCodes, statusDict: DICT_OF[T], statusVocab: VOCAB, canonToCode: { in_progress: 'active' }, decisions: DECISIONS, codeCase: CODE_CASE }) });
  }
  const parentOf = {}; // rid версии → rid записи
  const orphans = {};
  for (const B of BASES) {
    const H = B + 'Hist'; let last = '#-1:-1'; orphans[H] = 0;
    for (;;) {
      const rows = await db.src(`SELECT @rid AS r, in('${EDGE}').@rid AS p FROM ${H} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`);
      if (!rows.length) break;
      for (const x of rows) { const own = (x.p || []).filter(Boolean); if (own.length) parentOf[x.r] = own[0]; else orphans[H]++; }
      last = rows[rows.length - 1].r; if (rows.length < 5000) break;
    }
  }
  report.stages.read = Object.fromEntries(Object.entries(calc).map(([T, a]) => [T, a.length]));
  report.stages.read.versions_without_record = orphans;
  log('1 чтение:', JSON.stringify(report.stages.read));

  // ── 2. Сведение ───────────────────────────────────────────────────────────────────────────────────
  const merge = { to_version_set: 0, to_version_kept_existing: 0, no_current_version: 0, phase_title_from_status: 0, phase_title_already_set: 0 };
  const leftovers = [];
  for (const B of BASES) {
    const H = B + 'Hist';
    const versions = new Map(); // rid записи → версии
    for (const v of calc[H]) { const p = parentOf[v.rid]; if (p) (versions.get(p) || versions.set(p, []).get(p)).push(v); }
    for (const b of calc[B]) {
      const own = versions.get(b.rid) || [];
      const open = own.filter(v => !given(v.res.out.valid_to)).sort((a, c) => String(c.res.out.valid_from || '').localeCompare(String(a.res.out.valid_from || '')) || a.rid.localeCompare(c.rid));
      const cur = open[0];
      for (const [f, val] of Object.entries(b.res.toVersion)) {
        if (!cur) { merge.no_current_version++; leftovers.push({ src_type: B, src_rid: b.rid, field: f, value: val, kind: 'held', why: 'значение для текущей версии, а текущей версии у записи нет' }); }
        else if (given(cur.res.out[f])) merge.to_version_kept_existing++;
        else { cur.res.out[f] = val; merge.to_version_set++; }
      }
      if (B === 'KnowPhase') {
        const fb = own.map(v => v.res.titleFallback).filter(Boolean);
        if (fb.length) { if (given(b.res.out.title)) merge.phase_title_already_set++; else { b.res.out.title = fb[0]; merge.phase_title_from_status++; } }
      }
    }
  }
  for (const [T, list] of Object.entries(calc)) for (const { rid, res } of list) {
    for (const [f, v] of Object.entries(res.held)) leftovers.push({ src_type: T, src_rid: rid, field: f, value: v, kind: 'held', why: 'нет решения по полю' });
    for (const x of res.rejects) leftovers.push({ src_type: T, src_rid: rid, field: x.field, value: x.value, kind: 'reject', why: x.why });
  }
  report.stages.merge = merge;
  log('2 сведение:', JSON.stringify(merge), '· остаток', leftovers.length);

  // ── 3. Схема и запись ─────────────────────────────────────────────────────────────────────────────
  const existing = (await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name);
  const mine = ownTypes();
  const clash = existing.filter(n => mine.includes(n));
  if (existing.length && !reset) throw new Error(`приёмник не пуст (${existing.length} типов): запуск с --reset удалит типы этого переноса и запишет заново`);
  if (existing.some(n => !mine.includes(n))) throw new Error('в приёмнике есть чужие типы: ' + existing.filter(n => !mine.includes(n)).join(', '));
  // сначала связи (версий и шага связей), потом записи — так тип записи не держат связи
  const edgesFirst = [EDGE, ...keptEdges()];
  for (const n of [...edgesFirst, ...clash.filter(n => !edgesFirst.includes(n))]) if (existing.includes(n)) await db.dstCommand(`DROP TYPE ${n} UNSAFE`);
  for (const [T, t] of Object.entries(SCHEMA)) {
    await db.dstCommand(`CREATE VERTEX TYPE ${T}`);
    for (const [f, e] of Object.entries(t.fields)) await db.dstCommand(`CREATE PROPERTY ${T}.${f} ${e.db_type}`);
    await db.dstCommand(`CREATE PROPERTY ${T}.mig_src_rid STRING`);
    await db.dstCommand(`CREATE INDEX ON ${T} (mig_src_rid) UNIQUE`);
  }
  await db.dstCommand('CREATE VERTEX TYPE MigLeftover');
  await db.dstCommand(`CREATE EDGE TYPE ${EDGE}`);

  const dstRid = {}; // rid источника → rid приёмника
  const undeclared = {};
  const written = {};
  for (const T of Object.keys(SCHEMA)) {
    const declared = new Set(Object.keys(SCHEMA[T].fields));
    written[T] = 0;
    await pool(calc[T], 8, async ({ rid, res }) => {
      const content = { mig_src_rid: rid };
      for (const [f, v] of Object.entries(res.out)) { if (!given(v)) continue; if (!declared.has(f)) { undeclared[`${T}.${f}`] = (undeclared[`${T}.${f}`] || 0) + 1; continue; } content[f] = v; }
      const r = await db.dstCommand(`INSERT INTO ${T} CONTENT :c`, { c: content });
      dstRid[rid] = r[0]['@rid']; written[T]++;
    });
  }
  const links = Object.entries(parentOf).filter(([v, p]) => dstRid[v] && dstRid[p]);
  await pool(links, 8, ([v, p]) => db.dstCommand(`CREATE EDGE ${EDGE} FROM ${dstRid[p]} TO ${dstRid[v]}`));
  await pool(leftovers, 8, x => db.dstCommand('INSERT INTO MigLeftover CONTENT :c', { c: { ...x, value: typeof x.value === 'string' ? x.value : JSON.stringify(x.value) } }));
  report.stages.write = { records: written, links: links.length, leftovers: leftovers.length, fields_not_in_schema: undeclared };
  log('3 запись:', JSON.stringify(report.stages.write));

  // ── 5. Сверка «до и после» ────────────────────────────────────────────────────────────────────────
  // Ожидаемое значение приводится к тому виду, в каком база его отдаёт: момент — «ГГГГ-ММ-ДД ЧЧ:ММ:СС.ммм» (UTC).
  const asRead = (v, type) => (type === 'DATETIME' && typeof v === 'string' ? v.replace('T', ' ').replace(/Z$/, '') : v);
  const canon = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  const verify = { counts: {}, mismatched_records: {}, samples: [], links: null, leftovers: null, digest: {} };
  for (const T of Object.keys(SCHEMA)) {
    const expected = new Map();
    for (const { rid, res } of calc[T]) { const e = {}; for (const [f, v] of Object.entries(res.out)) if (given(v) && SCHEMA[T].fields[f]) e[f] = asRead(v, SCHEMA[T].fields[f].db_type); expected.set(rid, e); }
    let n = 0, bad = 0, last = '#-1:-1'; const h = crypto.createHash('sha256');
    for (;;) {
      const rows = await db.dstQuery(`SELECT FROM ${T} WHERE @rid > ${last} ORDER BY @rid LIMIT 2000`);
      if (!rows.length) break;
      for (const row of rows) {
        n++; const got = {};
        for (const [f, v] of Object.entries(row)) if (!f.startsWith('@') && f !== 'mig_src_rid' && given(v)) got[f] = v;
        const want = expected.get(row.mig_src_rid);
        if (!want || canon(got) !== canon(want)) { bad++; if (verify.samples.length < 5) verify.samples.push({ T, src: row.mig_src_rid, got: canon(got).slice(0, 300), want: want ? canon(want).slice(0, 300) : 'нет в расчёте' }); }
      }
      last = rows[rows.length - 1]['@rid']; if (rows.length < 2000) break;
    }
    for (const rid of [...expected.keys()].sort()) h.update(rid + canon(expected.get(rid)));
    verify.counts[T] = { source: calc[T].length, target: n }; verify.mismatched_records[T] = bad; verify.digest[T] = h.digest('hex').slice(0, 16);
  }
  verify.links = { expected: links.length, target: (await db.dstQuery(`SELECT count(*) AS n FROM ${EDGE}`))[0].n };
  verify.leftovers = { expected: leftovers.length, target: (await db.dstQuery('SELECT count(*) AS n FROM MigLeftover'))[0].n };
  verify.ok = Object.values(verify.counts).every(c => c.source === c.target) && Object.values(verify.mismatched_records).every(b => b === 0) && verify.links.expected === verify.links.target && verify.leftovers.expected === verify.leftovers.target && Object.keys(undeclared).length === 0;
  // справочники с подписями на всех языках правил (правило переноса 16.11.2026) — частью сверки
  report.stages.dicts = await writeDictionaries(db, RULES, DECISIONS, { log });
  if (!report.stages.dicts.ok) verify.ok = false;
  report.stages.verify = verify;
  log('5 сверка:', JSON.stringify({ ok: verify.ok, counts: verify.counts, mismatched: verify.mismatched_records, links: verify.links, leftovers: verify.leftovers }));
  if (verify.samples.length) log('  расхождения (образцы):', JSON.stringify(verify.samples, null, 1).slice(0, 1500));
  return report;
}

if (process.argv[1] === 'transfer') {
const db = connect();
const report = await transfer(db, DECISIONS, { reset: arg('--reset') });
const verify = report.stages.verify;
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
process.exit(verify.ok ? 0 : 1);
}
