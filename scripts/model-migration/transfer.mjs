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

import { MAP, SCHEMA, VOCAB, CODE_CASE, EDGES, RULES, NOT_MOVED, notMovedFor, SERIES, MODEL_VERSION } from './resources.mjs';
import { seriesPlan, copySeries, seriesIo } from './series.mjs';
import { writeDictionaries, ENTRY as DICT_ENTRY, LABEL as DICT_LABEL } from './dicts.mjs';
import { EDGE_STEP_TYPES } from './step-types.mjs';
import { orphanSprintAnswers, orphanSprintState } from './orphan-sprints.mjs';
import { derivePhaseStatus } from './status-unify.mjs';
import { computeEmptyStatuses, filledSummary } from './empty-fill.mjs';
import { structurePlan, asIsContent } from './structure-plan.mjs';
import { mergeKeyDups } from './key-dups.mjs';
import { splitActionsSetting } from './qg-actions.mjs';
import { repairVersions, addFixes } from './scd2-repair.mjs';
import { countLegacyBefore, legacyLeftovers, legacyDrop, assertLegacyDrop, LEGACY_KIND } from './legacy.mjs';
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
  // патч 1.18.1: номер модели (model_version lore-model.json) — рядом с хэшем; /lore/version отдаёт model:<N>
  return { model_hash, model_version: MODEL_VERSION, source: 'installer', built_at: at };
}
/** DDL поля: имя в обратных кавычках — поле с именем-ключевым словом SQL (KnowQuestion.trigger, 18.11.2026) иначе роняет перенос. */
// MDL-11 (ответ владелицы 19.11.2026 «5а»): поле схемы с notnull — MANDATORY + NOTNULL, пустое значение база не примет.
export function ddlProperty(T, f, dbType, { notnull = false } = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f)) throw new Error('имя поля для схемы недопустимо: ' + f);
  return 'CREATE PROPERTY ' + T + '.`' + f + '` ' + dbType + (notnull ? ' (MANDATORY true, NOTNULL true)' : '');
}
/** DDL полей типа по схеме переноса (без CREATE VERTEX TYPE и служебного mig_src_rid). */
export function schemaDdl(T, t) {
  return Object.entries(t.fields).map(([f, e]) => ddlProperty(T, f, e.db_type, { notnull: e.notnull === true }));
}
/**
 * MDL-11 · сторож перед записью: записи, у которых пусто обязательное (notnull) поле схемы. База такую запись
 * не примет, и перенос оборвался бы посреди записи; поэтому — поимённо и до первой команды в приёмник.
 */
export function notNullMissing(calc, schema) {
  const out = [];
  for (const [T, t] of Object.entries(schema)) for (const [f, e] of Object.entries(t.fields)) {
    if (e.notnull !== true) continue;
    const rids = (calc[T] || []).filter(x => { const v = x.res.out[f]; return v === undefined || v === null || v === ''; }).map(x => x.rid);
    if (rids.length) out.push({ type: T, field: f, rids });
  }
  return out;
}
/**
 * Ожидаемое значение в том виде, в каком его отдаёт база. Момент — «ГГГГ-ММ-ДД ЧЧ:ММ:СС.ммм» (UTC). Дата без времени
 * в поле DATETIME (created_at из date_created у ADR и решений — два поля источника в одно) ложится полночью.
 */
export function asRead(v, type) {
  if (type !== 'DATETIME' || typeof v !== 'string') return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v + ' 00:00:00.000';
  const s = v.replace('T', ' ').replace(/Z$/, '');
  // DATETIME ArcadeDB — миллисекунды: секунды она дополняет до .000, наносекунды Instant.toString() отбрасывает
  // до трёх знаков. Старая база несёт все формы сразу (бэкап прода 01.11.2026: 19, 20, 23, 24, 27 и 30 знаков),
  // и сверка «было = стало» сравнивала строки — равные моменты объявлялись расхождением (ryzenai 22.11.2026).
  const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(:\d{2})?(?:\.(\d+))?$/.exec(s);
  if (!m) return s;
  return m[1] + (m[2] || ':00') + '.' + ((m[3] || '') + '000').slice(0, 3);
}
/** Поля, в которых запись приёмника разошлась с расчётом: имя, что в базе, что ждали (значения до 120 символов). */
export function fieldDiff(got, want) {
  const cut = v => (typeof v === 'string' && v.length > 120 ? v.slice(0, 120) : v);
  return [...new Set([...Object.keys(got), ...Object.keys(want)])].sort()
    .filter(f => JSON.stringify(got[f]) !== JSON.stringify(want[f]))
    .map(f => ({ field: f, got: cut(got[f]), want: cut(want[f]) }));
}
/**
 * Остаток по несоответствию, которое не закрыто решением человека. MD-02 7а (владелица 19.11.2026): перенос честно
 * пишет «ждёт решения» (или «отложено человеком», если человек выбрал «решу позже»), а не подставляет значение молча.
 */
/** DDL индексов, объявленных схемой 1.18 у типа (indexes: [{fields, kind}]); IF NOT EXISTS — индекс источника не дублируется. */
export function schemaIndexDdl(schema) {
  const out = [];
  for (const [T, t] of Object.entries(schema)) for (const ix of t.indexes || [])
    out.push(`CREATE INDEX IF NOT EXISTS ON ${T} (${ix.fields.map(f => '`' + f + '`').join(', ')}) ${ix.kind}`);
  return out;
}
export function rejectLeftover(T, rid, x) {
  return { src_type: T, src_rid: rid, field: x.field, value: x.value, kind: 'reject', why: x.why, state: x.deferred ? 'отложено человеком' : 'ждёт решения' };
}
export const ownTypes = () => [...Object.keys(SCHEMA), ...SERVICE, EDGE, ...keptEdges(), ...EDGE_STEP_TYPES, DICT_ENTRY, DICT_LABEL, ...Object.keys(SERIES)];
const arg = k => process.argv.includes(k);
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;

/** Перенос записей с версиями в новую базу и сверка. log — куда писать ход; reset — разрешить непустой приёмник. */
export async function transfer(db, DECISIONS, { reset = false, log = console.log, freshInstall = false } = {}) {
  // MIG-01: свежая установка (init-empty) пишет пустую базу из модели в базу самой установки — имя любое, кроме
  // рабочей базы стенда, и только в пустой приёмник (сторож ниже: непустой без --reset — отказ, а reset здесь не дают).
  if (freshInstall) {
    if (/^system_aida_lore/i.test(db.env.MIG_DST_DB)) throw new Error('свежая установка не пишет в system_aida_lore*: новой базе нужно своё имя (LORE_DB)');
    if (reset) throw new Error('свежая установка пишет только в пустую базу — --reset здесь не применяется');
  } else if (!/^migration_dst/.test(db.env.MIG_DST_DB)) throw new Error('приёмник должен называться migration_dst*: перенос пишет только в отдельную пробную базу');
  const report = { source: db.env.MIG_SRC_DB, target: db.env.MIG_DST_DB, stages: {} };
  const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); };
  const given = v => v !== undefined && v !== null && v !== '';

  // ── 1. Чтение и расчёт ────────────────────────────────────────────────────────────────────────────
  const dictRows = await db.src("SELECT dict_type, code FROM KnowDictEntry WHERE dict_type IN ['sprint_status','task_status','phase_status']");
  const statusCodes = {};
  for (const r of dictRows) (statusCodes[r.dict_type] ||= []).push(r.code);
  const calc = {}; // T → [{ rid, res }]
  // Старая база не знает типов, заведённых позже: SELECT из такого типа ArcadeDB отвечает 500 «Type with name
  // 'KnowCanvas' was not found», и перенос падал невнятно — прогон установщика 1.18.2 на бэкапе прода 01.11.2026
  // (ryzenai 22.11.2026): 15 типов карты из 69 в источнике отсутствуют. Нет типа в источнике = нет записей:
  // в приёмнике он заводится из модели пустым, а имена названы в отчёте (absent_in_source), чтобы «пусто»
  // не выглядело потерей.
  const srcTypeNames = new Set((await db.src('SELECT name FROM schema:types')).map(x => x.name));
  const absentInSource = [];
  // MDL-08: «было» по легаси-полям — по исходным записям, независимо от исполнителя карты (сверка с остатком на шаге 2)
  const legacyBefore = {};
  for (const T of Object.keys(MAP)) {
    calc[T] = [];
    if (!srcTypeNames.has(T)) { absentInSource.push(T); continue; }
    for await (const rec of db.scan(T)) countLegacyBefore(T, rec, legacyBefore), calc[T].push({ rid: rec['@rid'], res: applyMap(T, MAP[T], rec, { statusCodes, statusDict: DICT_OF[T], statusVocab: VOCAB, canonToCode: { in_progress: 'active' }, decisions: DECISIONS, codeCase: CODE_CASE, phaseStatusMap: PHASE_MAP[T], statusRules: RULES.dictionaries[RULES_DICT_OF[T]], deferEmpty: true }) });
  }
  const parentOf = {}; // rid версии → rid записи
  const orphans = {};
  for (const B of BASES) {
    const H = B + 'Hist'; let last = '#-1:-1'; orphans[H] = 0;
    if (!srcTypeNames.has(H)) continue;
    for (;;) {
      const rows = await db.src(`SELECT @rid AS r, in('${EDGE}').@rid AS p FROM ${H} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`);
      if (!rows.length) break;
      for (const x of rows) { const own = (x.p || []).filter(Boolean); if (own.length) parentOf[x.r] = own[0]; else orphans[H]++; }
      last = rows[rows.length - 1].r; if (rows.length < 5000) break;
    }
  }
  report.stages.read = Object.fromEntries(Object.entries(calc).map(([T, a]) => [T, a.length]));
  report.stages.read.versions_without_record = orphans;
  report.stages.read.absent_in_source = absentInSource;
  log('1 чтение:', JSON.stringify(report.stages.read));
  if (absentInSource.length) log('1 нет в источнике (в приёмнике заведутся пустыми):', absentInSource.join(', '));

  // ── 2. Сведение ───────────────────────────────────────────────────────────────────────────────────
  const merge = { to_version_set: 0, to_version_kept_existing: 0, no_current_version: 0, phase_title_from_status: 0, phase_title_already_set: 0 };
  const leftovers = [];
  // MT-MCP-TRUTH Б6: битая история лечится ДО сведения — пустой state_uid, лишние открытые версии, запись без
  // текущей версии. Прежние значения — в остаток (MigLeftover), счёт — в отчёт.
  const scd2Fixes = { state_uid_filled: 0, extra_open_closed: 0, current_reopened: 0 };
  for (const B of BASES) {
    const H = B + 'Hist';
    const versions = new Map(); // rid записи → версии
    for (const v of calc[H]) { const p = parentOf[v.rid]; if (p) (versions.get(p) || versions.set(p, []).get(p)).push(v); }
    for (const b of calc[B]) {
      const own = versions.get(b.rid) || [];
      // лечится только то, что тип версий ведёт по схеме: у KnowMilestoneHist/KnowRunbookHist нет valid_to,
      // у KnowFindingHist нет и state_uid
      const hf = (SCHEMA[H] && SCHEMA[H].fields) || {};
      const fixed = repairVersions(own, { parent: b.rid, type: H, intervals: Boolean(hf.valid_to), stateUid: Boolean(hf.state_uid) });
      addFixes(scd2Fixes, fixed.fixes);
      leftovers.push(...fixed.leftovers);
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
  // Пустой статус — правило владелицы 19.11.2026 (empty-fill.mjs): вычислить из данных (предыдущая версия, открытая
  // версия записи) → решение из файла решений установки → начальный статус справочника. Каждая подстановка — в отчёте.
  computeEmptyStatuses(calc, parentOf, T => ({ statusCodes, statusDict: DICT_OF[T], codeCase: CODE_CASE, decisions: DECISIONS, statusRules: RULES.dictionaries[RULES_DICT_OF[T]] }));
  report.stages.empty_fill = { basis: 'правило владелицы 19.11', by_type: filledSummary(calc) };
  log('2 пустой статус:', JSON.stringify(report.stages.empty_fill.by_type));
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
  // настройка qg.actions_projects снимается (AP-DICT-UPSERT-DUP, выбор владельца 23.11.2026 «а»): что опрашивать в Actions,
  // задаёт гейт канала Actions с ребром на проект — его заводит шаг связей (qg-actions.mjs); убыль — в остаток с причиной
  if (calc.KnowDictEntry) {
    const qa = splitActionsSetting(calc.KnowDictEntry);
    calc.KnowDictEntry = qa.keep;
    for (const x of qa.leftovers) leftovers.push({ src_type: 'KnowDictEntry', ...x });
    report.stages.qg_actions_setting = { removed: qa.leftovers.map(x => x.src_rid), values: qa.values };
    log('2 настройка qg.actions_projects: снято строк', qa.leftovers.length, qa.values.length ? '(' + qa.values.join(', ') + ') → гейт канала Actions' : '');
  }
  // дубли уникального ключа справочника (D-2026-MIG-SETTING-LIST-VALUE): отличаются только организацией — одна строка
  if (calc.KnowDictEntry) {
    const slugs = new Set((await db.src('SELECT slug FROM KnowGitProject')).map(x => x.slug).filter(Boolean));
    const kd = mergeKeyDups(calc.KnowDictEntry, ['dict_type', 'code'], 'label_ru', slugs);
    calc.KnowDictEntry = kd.keep;
    for (const x of kd.leftovers) leftovers.push({ src_type: 'KnowDictEntry', ...x });
    report.stages.key_dups = { merged: kd.leftovers.map(x => x.src_rid), conflicts: kd.conflicts };
    log('2 дубли ключа справочника: слито', kd.leftovers.length, '· конфликтов', kd.conflicts.length, kd.conflicts.length ? JSON.stringify(kd.conflicts) : '');
  }
  // задачи без спринта (шаг «З» мастера, владелица 19.11.2026: «предложить владельцу привязать»): ребро ставит
  // шаг связей по ответу человека; ответ «дубль» — задача и её версии не переносятся, уходят в остаток с причиной;
  // без ответа задача переносится без спринта, в отчёте — «ждёт решения»
  if (calc.KnowTask) {
    const loose = await db.src("SELECT @rid AS rid, task_uid FROM KnowTask WHERE out('PART_OF').size() = 0");
    const st = orphanSprintState(loose, orphanSprintAnswers(DECISIONS));
    const ridOf = new Map(loose.map(x => [x.task_uid, x.rid]));
    const dropRid = new Set();
    for (const d of st.duplicate) {
      const rid = ridOf.get(d.task_uid);
      dropRid.add(rid);
      leftovers.push({ src_type: 'KnowTask', src_rid: rid, field: 'task_uid', value: d.task_uid, kind: 'merged_duplicate',
        why: `дубль: задача без спринта ${d.task_uid} — та же задача, что ${d.of} (ответ человека в мастере, шаг «З»); вторая задача с тем же кодом не заводится` });
      for (const [v, p] of Object.entries(parentOf)) if (p === rid) {
        dropRid.add(v);
        leftovers.push({ src_type: 'KnowTaskHist', src_rid: v, field: 'parent', value: rid, kind: 'merged_duplicate', why: `версия задачи-дубля ${d.task_uid} (см. ${d.of})` });
      }
    }
    calc.KnowTask = calc.KnowTask.filter(x => !dropRid.has(x.rid));
    if (calc.KnowTaskHist) calc.KnowTaskHist = calc.KnowTaskHist.filter(x => !dropRid.has(x.rid));
    report.stages.orphan_sprints = { without_sprint: loose.length, to_link: st.link.length, duplicate: st.duplicate, keep: st.keep, waiting: st.waiting, state: st.waiting.length ? 'ждёт решения' : 'решено' };
    log('2 задачи без спринта:', loose.length, '· привяжет шаг связей', st.link.length, '· дубль', st.duplicate.map(d => `${d.task_uid} = ${d.of}`).join(', ') || '—', '· без спринта по ответу', st.keep.length, st.waiting.length ? '· ЖДУТ РЕШЕНИЯ (шаг «З»): ' + st.waiting.join(', ') : '');
  }
  for (const [T, list] of Object.entries(calc)) for (const { rid, res } of list) {
    leftovers.push(...legacyLeftovers(T, rid, res));
    for (const [f, v] of Object.entries(res.held)) leftovers.push({ src_type: T, src_rid: rid, field: f, value: v, kind: 'held', why: 'нет решения по полю' });
    for (const x of res.rejects) leftovers.push(rejectLeftover(T, rid, x));
  }
  report.stages.merge = merge;
  report.stages.scd2_repair = scd2Fixes;
  log('2 история SCD2:', JSON.stringify(scd2Fixes));
  log('2 сведение:', JSON.stringify(merge), '· остаток', leftovers.length);
  // MDL-08 · объявление убыли: снятое легаси-поле — в остатке столько же раз, сколько записей источника его несли;
  // расхождение — стоп до первой записи в приёмник (значение потерялось бы молча)
  report.legacy_drop = legacyDrop(legacyBefore, leftovers);
  log('2 легаси MDL-08: было', report.legacy_drop.total.before, '· в остаток', report.legacy_drop.total.leftover, '·', Object.entries(report.legacy_drop.fields).filter(([, e]) => e.before).map(([k, e]) => k + ' ' + e.before).join(', '));
  assertLegacyDrop(report.legacy_drop);

  // ── 3. Схема и запись ─────────────────────────────────────────────────────────────────────────────
  // MDL-11: обязательное поле пусто — запись не начинается (пустой статус закрыт правилом выше; сторож — на прочие обязательные поля)
  const missing = notNullMissing(calc, SCHEMA);
  if (missing.length) throw new Error('обязательное поле пусто — нужно решение в разделе «Перенос» (несоответствие «пусто» или «вне справочника»): ' + missing.map(m => `${m.type}.${m.field} — ${m.rids.length} (${m.rids.slice(0, 5).join(', ')}${m.rids.length > 5 ? ', …' : ''})`).join('; '));
  const existing = (await db.dstQuery('SELECT name FROM schema:types')).map(x => x.name);
  // структура вне карты: типы источника без карты (пустыми) и индексы источника на новых именах полей
  const srcTypes = await db.src('SELECT name, type, properties, indexes, timestampColumn, tsColumns FROM schema:types');
  // ряды модели (series): DDL — из модели, точки источника — своим шагом; «как есть» их не заводит (дефект 1.18,
  // 19.11.2026: AgentActionLog и MetricSnapshot заводились только шагами V, которых у базы из модели нет)
  const seriesSteps = seriesPlan(srcTypes, SERIES);
  const structure = structurePlan(srcTypes, SCHEMA, notMovedFor(db.env), SERIES);
  // свои: типы карты и структуры; плюс типы «не переносить», оставленные прежней версией переноса, — их --reset удаляет
  const mine = [...ownTypes(), ...structure.types.map(t => t.name), ...Object.keys(NOT_MOVED)];
  const clash = existing.filter(n => mine.includes(n));
  if (existing.length && !reset) throw new Error(`приёмник не пуст (${existing.length} типов): запуск с --reset удалит типы этого переноса и запишет заново`);
  if (existing.some(n => !mine.includes(n))) throw new Error('в приёмнике есть чужие типы: ' + existing.filter(n => !mine.includes(n)).join(', '));
  // сначала связи (версий и шага связей), потом записи — так тип записи не держат связи
  const edgesFirst = [EDGE, ...keptEdges()];
  for (const n of [...edgesFirst, ...clash.filter(n => !edgesFirst.includes(n))]) if (existing.includes(n)) await db.dstCommand(`DROP TYPE ${n} UNSAFE`);
  for (const [T, t] of Object.entries(SCHEMA)) {
    await db.dstCommand(`CREATE VERTEX TYPE ${T}`);
    for (const s of schemaDdl(T, t)) await db.dstCommand(s);
    await db.dstCommand(`CREATE PROPERTY ${T}.mig_src_rid STRING`);
    await db.dstCommand(`CREATE INDEX ON ${T} (mig_src_rid) UNIQUE`);
  }
  for (const s of structure.typeDdl) await db.dstCommand(s);
  await db.dstCommand('CREATE VERTEX TYPE MigLeftover');
  await db.dstCommand('CREATE VERTEX TYPE LoreModelSchema');
  await db.dstCommand('INSERT INTO LoreModelSchema CONTENT :c', { c: modelMarker(SCHEMA) });
  await db.dstCommand(`CREATE EDGE TYPE ${EDGE}`);
  // DBR-07: временные ряды модели (AuditDbLogin — сторож входов, AgentActionLog — журнал действий, MetricSnapshot —
  // метрики) — DDL модели; точки источника переносятся ниже, после записей.
  for (const s of seriesSteps) await db.dstCommand(s.ddl);

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
  // типы без карты — как есть (журналы, снимки метрик, планы): строка источника без @-полей + mig_src_rid; сверка счётом
  // ряды модели: точки источника — по страницам (окна времени), детерминированно, со сверкой счёта (copySeries)
  const seriesCopied = {};
  for (const s of seriesSteps) {
    seriesCopied[s.name] = s.copy ? await copySeries(seriesIo(db, s.name, s.ts)) : { source: 0, target: 0, absent_in_source: true };
    log('3 ряд модели:', s.name, JSON.stringify(seriesCopied[s.name]));
  }
  report.stages.series = seriesCopied;
  const asIs = {};
  for (const t of structure.types) {
    if (t.kind === 'TIMESERIES') {
      // ряд источника вне модели — тем же переносом по страницам, структура — источника
      asIs[t.name] = await copySeries(seriesIo(db, t.name, t.ts));
      continue;
    }
    let last = '#-1:-1', n = 0;
    for (;;) {
      const rows = await db.src(`SELECT FROM ${t.name} WHERE @rid > ${last} ORDER BY @rid LIMIT 5000`);
      if (!rows.length) break;
      await pool(rows, 8, r => db.dstCommand(`INSERT INTO ${t.name} CONTENT :c`, { c: asIsContent(r) }));
      n += rows.length; last = rows[rows.length - 1]['@rid'];
      if (rows.length < 5000) break;
    }
    const src = (await db.src(`SELECT count(*) AS n FROM ${t.name}`))[0].n;
    asIs[t.name] = { source: src, target: n };
    if (src !== n) throw new Error(`перенос как есть: ${t.name} — в источнике ${src}, перенесено ${n}`);
  }
  log('3 как есть (типы без карты):', JSON.stringify(asIs));
  // индексы источника — после записи: индекс, которому мешают данные (дубль под уникальным), не роняет перенос,
  // а называется в отчёте с причиной базы
  const indexFailed = [];
  // MD-02 8а: у типа «только схема» (пустой, но его трогает код) индексы старой схемы объявлены в схеме 1.18 —
  // UPSERT кода требует уникального индекса, и он не должен зависеть от того, есть ли индекс в источнике
  for (const s of schemaIndexDdl(SCHEMA)) structure.indexDdl.push(s);
  for (const s of structure.indexDdl) {
    try { await db.dstCommand(s); } catch (e) { indexFailed.push({ ddl: s, why: String(e.message || e).slice(0, 300) }); }
  }
  report.stages.structure = { as_is: asIs, not_carried: structure.notCarried, indexes: structure.indexes.length - indexFailed.length, skipped: structure.skipped, failed: indexFailed };
  log('3 структура вне карты:', structure.types.length, 'типов как есть,', structure.indexes.length - indexFailed.length, 'индексов источника,', structure.skipped.length, 'пропущено,', indexFailed.length, 'не создано (данные мешают)');
  for (const x of indexFailed) log('  индекс не создан:', x.ddl, '—', x.why);
  log('3 запись:', JSON.stringify(report.stages.write));

  // ── 5. Сверка «до и после» ────────────────────────────────────────────────────────────────────────
  // Ожидаемое значение приводится к тому виду, в каком база его отдаёт: момент — «ГГГГ-ММ-ДД ЧЧ:ММ:СС.ммм» (UTC).
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
  // MDL-08: остаток легаси в приёмнике — поле в поле с объявлением убыли
  const legacyRows = await db.dstQuery(`SELECT src_type, field FROM MigLeftover WHERE kind = '${LEGACY_KIND}'`);
  const legacyGot = {}; for (const x of legacyRows) legacyGot[x.src_type + '.' + x.field] = (legacyGot[x.src_type + '.' + x.field] || 0) + 1;
  const legacyBad = Object.entries(report.legacy_drop.fields).filter(([k, e]) => (legacyGot[k] || 0) !== e.leftover).map(([k]) => k);
  verify.legacy_drop = { expected: report.legacy_drop.total.leftover, target: legacyRows.length, mismatched: legacyBad, ok: legacyBad.length === 0 && legacyRows.length === report.legacy_drop.total.leftover };
  verify.ok = verify.legacy_drop.ok && Object.values(verify.counts).every(c => c.source === c.target) && Object.values(verify.mismatched_records).every(b => b === 0) && verify.links.expected === verify.links.target && verify.leftovers.expected === verify.leftovers.target && Object.keys(undeclared).length === 0;
  // справочники с подписями на всех языках правил (правило переноса 16.11.2026) — частью сверки
  report.stages.dicts = await writeDictionaries(db, RULES, DECISIONS, { log });
  if (!report.stages.dicts.ok) verify.ok = false;
  report.stages.verify = verify;
  log('5 сверка:', JSON.stringify({ ok: verify.ok, counts: verify.counts, mismatched: verify.mismatched_records, links: verify.links, leftovers: verify.leftovers, legacy_drop: verify.legacy_drop }));
  if (verify.samples.length) log('  расхождения (образцы):', JSON.stringify(verify.samples, null, 1).slice(0, 1500));
  return report;
}

if (process.argv[1] === 'transfer') {
const db = connect();
// Те же ворота, что у мастера (шаг 4): без решений по статусам и вида продукта перенос не начинается.
const { collectStatusDialog } = await import('./status-run.mjs');
const { readProductKindInput, productKindState } = await import('./product-kind.mjs');
const { transferGate } = await import('./transfer-gate.mjs');
const dlg = await collectStatusDialog(db, RULES, DECISIONS);
const pks = productKindState((await readProductKindInput(db)).products, DECISIONS || { decisions: [] });
const gate = transferGate({ needsDecision: dlg.summary.needs_decision || 0, missingKinds: pks.missing, unread: dlg.unread.length, allowPending: arg('--allow-pending') });
if (gate.reasons.length) console.log((gate.ok ? 'внимание (--allow-pending): ' : 'СТОП: перенос не начинается — ') + gate.reasons.join('; '));
if (!gate.ok) process.exit(3);
const report = await transfer(db, DECISIONS, { reset: arg('--reset') });
const verify = report.stages.verify;
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
process.exit(verify.ok ? 0 : 1);
}
