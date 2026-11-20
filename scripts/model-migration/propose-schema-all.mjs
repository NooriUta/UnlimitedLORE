#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · ПРЕДЛОЖЕНИЕ схемы всех объектов, кроме первого (спринт, фаза, задача — у них своя
// schema/sprint-phase-task.json). Выводится, а не пишется руками: карта map/all-objects.json + перепись полей прода
// (tools/census/fields-all.json, объявленные типы) + отчёт пробного расчёта (какие поля реально получились и у скольких
// записей). Запись в приёмник по нему — только после слова владелицы.
// Запуск: node propose-schema-all.mjs <отчёт пробного расчёта.json>
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CODE_FIELDS } from './propose-map-all.mjs';
import { declaredDdl, LORE_JAVA } from './code-types.mjs';
import { markNotNull } from './notnull.mjs';

const KIND_OF = { STRING: 'text', INTEGER: 'number', LONG: 'number', DOUBLE: 'number', FLOAT: 'number', BOOLEAN: 'bool', DATE: 'date', DATETIME: 'datetime', MAP: 'map', LIST: 'list' };

export { valueKind } from './value-kind.mjs';

const BY_KINDS = { integer: { kind: 'number', db_type: 'LONG' }, number: { kind: 'number', db_type: 'DOUBLE' }, boolean: { kind: 'bool', db_type: 'BOOLEAN' }, list: { kind: 'list', db_type: 'LIST' }, map: { kind: 'map', db_type: 'MAP' }, string: { kind: 'text', db_type: 'STRING' } };

/**
 * Тип нового поля: у преобразования — из правила; у «как есть» — объявленный в схеме прода; не объявленный —
 * по фактическим значениям (kinds: {вид: сколько}). 18.11.2026, прогон all3: необъявленные числа, да/нет и списки
 * ложились строкой («4427», «false», «[]») — правило «строкой» потеряло тип.
 */
export function fieldType(rule, declared, kinds) {
  if (rule && rule.rule === 'transform') {
    if (rule.how === 'DATE') return { kind: 'date', db_type: 'DATE' };
    if (rule.how === 'DATETIME') return { kind: 'datetime', db_type: 'DATETIME' };
    if (['status', 'priority', 'harness'].includes(rule.how)) return { kind: 'enum', db_type: 'STRING' };
  }
  if (declared && KIND_OF[declared]) return { kind: KIND_OF[declared], db_type: declared };
  const seen = Object.keys(kinds || {}).filter(k => kinds[k] > 0);
  const k = seen.length === 1 ? seen[0] : seen.length === 2 && seen.includes('integer') && seen.includes('number') ? 'number' : null;
  if (k && k !== 'string') return { ...BY_KINDS[k], note: 'в схеме прода не объявлено — тип по значениям' };
  if (seen.length > 1) return { kind: 'text', db_type: 'STRING', note: 'в схеме прода не объявлено, значения разных типов — строкой' };
  return { kind: 'text', db_type: 'STRING', note: 'в схеме прода не объявлено — строкой' };
}

/** Из каких полей источника получается новое поле f. */
export function sourcesOf(map, f) {
  return Object.entries(map).filter(([k, e]) => (e.rule === 'keep' && k === f) || ((e.rule === 'transform' || e.rule === 'rename') && e.to === f)).map(([k]) => k);
}

// WK-01 (20.11.2026): + причина правки — служебное поле версии рядом с changed_by_*.
const SERVICE_NAMES = { changed_by_session: 'Сессия правки', changed_by_harness: 'Harness правки', changed_by_harness_note: 'Сверка harness', changed_by_machine: 'Машина правки', change_reason: 'Причина правки' };

/**
 * MD-02 8а · схема пустого типа «только схема» (тип нужен живому коду, данных нет). Источники свойства по порядку
 * (владелица 19.11.2026): старая схема (объявленный тип в переписи прода) → спека → вывод из кода → мягкий тип;
 * у каждого свойства назван источник. Индексы — из старой схемы: DDL шагов V в коде сервера (declaredDdl).
 * Пробного расчёта у такого типа нет (записей 0), поэтому схема выводится не из него, а отсюда.
 */
export function schemaOnlyType(T, mapT, censusT, ddlT = {}) {
  const declared = Object.fromEntries((censusT.fields || []).map(f => [f.name, f.declared]));
  const fields = {};
  for (const f of Object.keys(mapT).sort((a, b) => a.localeCompare(b))) {
    const code = (CODE_FIELDS[T] || {})[f];
    if (declared[f] && KIND_OF[declared[f]]) fields[f] = { kind: KIND_OF[declared[f]], db_type: declared[f], from: [f], filled: 0, of: 0, source: 'старая схема' };
    else if (code) fields[f] = { kind: KIND_OF[code.db_type] || 'text', db_type: code.db_type, from: [f], filled: 0, of: 0, source: code.source };
    else if (SERVICE_NAMES[f] && T.endsWith('Hist')) fields[f] = { kind: 'text', db_type: 'STRING', name: SERVICE_NAMES[f], from: [], filled: 0, of: 0, service: true, source: 'общий перечень служебных полей версии' };
    else fields[f] = { kind: 'text', db_type: 'STRING', from: [f], filled: 0, of: 0, source: 'по умолчанию (неоднозначно)' };
  }
  const indexes = ((ddlT && ddlT.indexes) || []).filter(ix => ix.fields.every(f => fields[f])).map(ix => ({ fields: [...ix.fields], kind: ix.kind, source: 'старая схема (DDL шагов V в коде сервера)' }));
  return { records: 0, schema_only: true, version_of: T.endsWith('Hist') ? T.slice(0, -4) : null, fields, indexes, held: {}, rejects: {} };
}

function main() {
  const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const here = p => new URL(p, import.meta.url);
  const report = J(process.argv[2]);
  const MAP = J(here('./map/all-objects.json')).types;
  const CENSUS = J(here('./tools/census/fields-all.json'));
  const FIRST = new Set(Object.keys(J(here('./schema/sprint-phase-task.json')).types));
  const SERVICE = SERVICE_NAMES;
  // WK-01: вид статьи словаря — набор (product: tech | service, ADR-LORE-044); шаг вида продукта (product-kind.mjs) пишет его
  // списком, поэтому схема объявляет поле сама, даже если в снимке источника значений ещё нет.
  const DECLARED = { KnowDictEntry: { kind: 'Вид' }, KnowDictEntryHist: { kind: 'Вид' } };
  const types = {};
  const MAPDOC = J(here('./map/all-objects.json'));
  const DDL = declaredDdl(fileURLToPath(LORE_JAVA));
  for (const T of Object.keys(MAPDOC.schema_only || {})) types[T] = schemaOnlyType(T, MAP[T], CENSUS[T], DDL[T]);
  for (const [T, t] of Object.entries(report.types)) {
    if (types[T]) continue;
    if (FIRST.has(T) || !MAP[T]) continue;
    const declared = Object.fromEntries((CENSUS[T]?.fields || []).map(f => [f.name, f.declared]));
    const fields = {};
    for (const [f, n] of Object.entries(t.outFields).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      const src = sourcesOf(MAP[T], f);
      const rule = src.length ? MAP[T][src[0]] : null;
      fields[f] = { ...fieldType(rule, src.length ? declared[src[0]] : declared[f], (t.outKinds || {})[f]), from: src, filled: n, of: t.records };
    }
    // Служебное поле служебное и с данными (снимок 18.11: у версий релизов и решений поля правки заполнены).
    if (T.endsWith('Hist')) for (const [f, name] of Object.entries(SERVICE)) fields[f] = fields[f] ? { ...fields[f], kind: 'text', db_type: 'STRING', name, service: true } : { kind: 'text', db_type: 'STRING', name, from: [], filled: 0, of: t.records, service: true, note: 'объявлено общим перечнем служебных полей' };
    for (const [f, name] of Object.entries(DECLARED[T] || {})) fields[f] = { kind: 'list', db_type: 'LIST', name, from: fields[f] ? fields[f].from : [], filled: fields[f] ? fields[f].filled : 0, of: t.records, note: 'вид статьи — набор (product: tech | service, ADR-LORE-044); объявляет шаг вида продукта (product-kind.mjs)' };
    types[T] = { records: t.records, version_of: T.endsWith('Hist') ? T.slice(0, -4) : null, fields, held: t.held, rejects: Object.fromEntries(Object.entries(t.rejects).map(([k, e]) => [k, e.n ?? e])) };
  }
  // MDL-11: обязательные поля (MANDATORY + NOTNULL) — из модели
  markNotNull(types, J(here('../../shared/model/lore-model.json')));
  const out = {
    _about: 'SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01. ПРЕДЛОЖЕНИЕ новой схемы всех объектов, кроме первого — владелицей не утверждено. Выведено propose-schema-all.mjs из карты map/all-objects.json, переписи полей прода и пробного расчёта: в схему попали только поля, которые перенос реально дал. Запись в приёмник по этой схеме — после её слова.',
    _source: report.source,
    _assumed: [
      'Имена типов прежние: ответы срезов не меняются.',
      'Версия — отдельный тип с окончанием Hist и связью HAS_STATE, как у первого объекта.',
      'Тип поля «как есть» — объявленный в схеме прода; не объявленное там поле — строкой (пометка у поля).',
      'Удержанные значения (component_id, project и *_refs до шага связей) в схему не входят — они становятся связями.',
      'Пустые типы, которые трогает код (KnowCanvas, KnowSavedView, QGMetric и др.), — «только схема»: свойства и индексы старой схемы, у каждого свойства назван источник (MD-02 8а, 19.11.2026).',
    ],
    types,
  };
  fs.writeFileSync(here('./schema/all-objects.json'), JSON.stringify(out, null, 2) + '\n');
  const n = Object.values(types).reduce((a, t) => a + Object.keys(t.fields).length, 0);
  console.log(`типов ${Object.keys(types).length}, полей ${n}; не объявлено в проде: ${Object.values(types).flatMap(t => Object.values(t.fields)).filter(f => f.note && !f.service).length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])) main();
