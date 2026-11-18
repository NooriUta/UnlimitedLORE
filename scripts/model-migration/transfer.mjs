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
import { SESSION_EDGES } from './session-model.mjs';
import { derivePhaseStatus } from './status-unify.mjs';
// Справочник статуса по типу: первый объект — по справочникам базы; остальные типы — по источникам правил (17.11.2026).
const RULES_DICT_OF = Object.fromEntries(RULES.sources.filter(s => s.field === 'status_raw' || s.field === 'status').map(s => [s.type, s.dict]));
const DICT_OF = { ...RULES_DICT_OF, KnowSprintHist: 'sprint_status', KnowTaskHist: 'task_status', KnowPhaseHist: 'phase_status' };
// Статусы задач в истории фазы — к коду фазы правилом «статус фазы по задачам» (derive.map справочника).
const PHASE_MAP = Object.fromEntries(Object.entries(DICT_OF).map(([t, d]) => [t, ((RULES.dictionaries[d] || {}).derive || {}).map]));
// Типы с версиями — все, у кого в схеме есть пара <T>Hist (18.11.2026: перенос всех объектов, не только первого).
const BASES = Object.keys(SCHEMA).filter(T => SCHEMA[T + 'Hist']);
const SERVICE = ['MigLeftover', 'LoreModelSchema'], EDGE = 'HAS_STATE';
/** Типы новой базы, которые кладёт сам конвейер: записи, остаток, связь версий и связи с правилом keep (шаг связей). */
export const keptEdges = () => Object.entries(EDGES).filter(([n, r]) => r.rule === 'keep' && n !== EDGE).map(([n]) => n);
/** MIG-03: отметка «схема собрана из модели» — по ней сервер узнаёт базу без журнала шагов V. Хэш — от схемы. */
export function modelMarker(schema, at = new Date().toISOString()) {
  const model_hash = crypto.createHash('sha256').update(JSON.stringify(schema)).digest('hex').slice(0, 16);
  return { model_hash, source: 'installer', built_at: at };
}
/** DDL поля: имя в обратных кавычках — поле с именем-ключевым словом SQL (KnowQuestion.trigger, 18.11.2026) иначе роняет перенос. */
export function ddlProperty(T, f, dbType) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f)) throw new Error('имя поля для схемы недопустимо: ' + f);
  return 'CREATE PROPERTY ' + T + '.`' + f + '` ' + dbType;
}
/** Поля, в которых запись приёмника разошлась с расчётом: имя, что в базе, что ждали (значения до 120 символов). */
export function fieldDiff(got, want) {
  const cut = v => (typeof v === 'string' && v.length > 120 ? v.slice(0, 120) : v);
  return [...new Set([...Object.keys(got), ...Object.keys(want)])].sort()
    .filter(f => JSON.stringify(got[f]) !== JSON.stringify(want[f]))
    .map(f => ({ field: f, got: cut(got[f]), want: cut(want[f]) }));
}
export const ownTypes = () => [...Object.keys(SCHEMA), ...SERVICE, EDGE, ...keptEdges(), ...SESSION_EDGES, DICT_ENTRY, DICT_LABEL];
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
    for await (const rec of db.scan(T)) calc[T].push({ rid: rec['@rid'], res: applyMap(T, MAP[T], rec, { statusCodes, statusDict: DICT_OF[T], statusVocab: VOCAB, canonToCode: { in_progress: 'active' }, decisions: DECISIONS, codeCase: CODE_CASE, phaseStatusMap: PHASE_MAP[T], statusRules: RULES.dictionaries[RULES_DICT_OF[T]] }) });
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
  // Статус фазы без кода — минимальный по задачам фазы (слово владелицы 16.11.2026). Задача → фаза по связи
  // IN_PHASE источника, статус задачи — её текущей версии после решений. Несведённое значение статуса фазы
  // уходит из остатка: оно решено правилом, исходный текст остаётся в status_note.
  const derive = RULES.dictionaries.phase_status && RULES.dictionaries.phase_status.derive;
  merge.phase_status_from_tasks = 0;
  if (derive) {
    const curOf = new Map(); // rid задачи → код текущей версии
    for (const v of calc.KnowTaskHist) {
      const p = parentOf[v.rid];
      if (!p || given(v.res.out.valid_to)) continue;
      const prev = curOf.get(p);
      if (!prev || String(v.res.out.valid_from || '') > prev.at) curOf.set(p, { at: String(v.res.out.valid_from || ''), code: v.res.out.status });
    }
    const tasksOf = new Map(); // rid фазы → коды задач
    let last = '#-1:-1';
    for (;;) {
      const rows = await db.src(`SELECT @rid AS t, out('IN_PHASE').@rid AS ph FROM KnowTask WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`);
      if (!rows.length) break;
      for (const x of rows) for (const ph of (x.ph || []).filter(Boolean)) {
        const c = curOf.get(x.t);
        (tasksOf.get(ph) || tasksOf.set(ph, []).get(ph)).push(c && c.code ? c.code : 'НЕТ_СТАТУСА');
      }
      last = rows[rows.length - 1].t; if (rows.length < 5000) break;
    }
    for (const v of calc.KnowPhaseHist) {
      if (given(v.res.out.status)) continue;
      const ph = parentOf[v.rid];
      const codes = [...(tasksOf.get(ph) || [])].sort();
      const d = derivePhaseStatus(codes, derive);
      v.res.out.status = d.code;
      v.res.rejects = v.res.rejects.filter(x => x.field !== 'status_raw');
      merge.phase_status_from_tasks++;
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
    for (const [f, e] of Object.entries(t.fields)) await db.dstCommand(ddlProperty(T, f, e.db_type));
    await db.dstCommand(`CREATE PROPERTY ${T}.mig_src_rid STRING`);
    await db.dstCommand(`CREATE INDEX ON ${T} (mig_src_rid) UNIQUE`);
  }
  await db.dstCommand('CREATE VERTEX TYPE MigLeftover');
  await db.dstCommand('CREATE VERTEX TYPE LoreModelSchema');
  await db.dstCommand('INSERT INTO LoreModelSchema CONTENT :c', { c: modelMarker(SCHEMA) });
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
  const perType = {};
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
        if (!want || canon(got) !== canon(want)) { bad++; if ((perType[T] = (perType[T] || 0) + 1) <= 2) verify.samples.push({ T, src: row.mig_src_rid, diff: want ? fieldDiff(got, want).slice(0, 4) : 'нет в расчёте' }); }
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
