#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · ПРЕДЛОЖЕНИЕ схемы всех объектов, кроме первого (спринт, фаза, задача — у них своя
// schema/sprint-phase-task.json). Выводится, а не пишется руками: карта map/all-objects.json + перепись полей прода
// (tools/census/fields-all.json, объявленные типы) + отчёт пробного расчёта (какие поля реально получились и у скольких
// записей). Запись в приёмник по нему — только после слова владелицы.
// Запуск: node propose-schema-all.mjs <отчёт пробного расчёта.json>
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const KIND_OF = { STRING: 'text', INTEGER: 'number', LONG: 'number', DOUBLE: 'number', FLOAT: 'number', BOOLEAN: 'bool', DATE: 'date', DATETIME: 'datetime', MAP: 'map', LIST: 'list' };

/** Тип нового поля: у преобразования — из правила, у «как есть» — объявленный в схеме прода. */
export function fieldType(rule, declared) {
  if (rule && rule.rule === 'transform') {
    if (rule.how === 'DATE') return { kind: 'date', db_type: 'DATE' };
    if (rule.how === 'DATETIME') return { kind: 'datetime', db_type: 'DATETIME' };
    if (['status', 'priority', 'harness'].includes(rule.how)) return { kind: 'enum', db_type: 'STRING' };
  }
  if (declared && KIND_OF[declared]) return { kind: KIND_OF[declared], db_type: declared };
  return { kind: 'text', db_type: 'STRING', note: 'в схеме прода не объявлено — строкой' };
}

/** Из каких полей источника получается новое поле f. */
export function sourcesOf(map, f) {
  return Object.entries(map).filter(([k, e]) => (e.rule === 'keep' && k === f) || ((e.rule === 'transform' || e.rule === 'rename') && e.to === f)).map(([k]) => k);
}

function main() {
  const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const here = p => new URL(p, import.meta.url);
  const report = J(process.argv[2]);
  const MAP = J(here('./map/all-objects.json')).types;
  const CENSUS = J(here('./tools/census/fields-all.json'));
  const FIRST = new Set(Object.keys(J(here('./schema/sprint-phase-task.json')).types));
  const SERVICE = { changed_by_session: 'Сессия правки', changed_by_harness: 'Harness правки', changed_by_harness_note: 'Сверка harness', changed_by_machine: 'Машина правки' };
  const types = {};
  for (const [T, t] of Object.entries(report.types)) {
    if (FIRST.has(T) || !MAP[T]) continue;
    const declared = Object.fromEntries((CENSUS[T]?.fields || []).map(f => [f.name, f.declared]));
    const fields = {};
    for (const [f, n] of Object.entries(t.outFields).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      const src = sourcesOf(MAP[T], f);
      const rule = src.length ? MAP[T][src[0]] : null;
      fields[f] = { ...fieldType(rule, src.length ? declared[src[0]] : declared[f]), from: src, filled: n, of: t.records };
    }
    if (T.endsWith('Hist')) for (const [f, name] of Object.entries(SERVICE)) if (!fields[f]) fields[f] = { kind: 'text', db_type: 'STRING', name, from: [], filled: 0, of: t.records, service: true, note: 'объявлено общим перечнем служебных полей' };
    types[T] = { records: t.records, version_of: T.endsWith('Hist') ? T.slice(0, -4) : null, fields, held: t.held, rejects: Object.fromEntries(Object.entries(t.rejects).map(([k, e]) => [k, e.n ?? e])) };
  }
  const out = {
    _about: 'SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01. ПРЕДЛОЖЕНИЕ новой схемы всех объектов, кроме первого — владелицей не утверждено. Выведено propose-schema-all.mjs из карты map/all-objects.json, переписи полей прода и пробного расчёта: в схему попали только поля, которые перенос реально дал. Запись в приёмник по этой схеме — после её слова.',
    _source: report.source,
    _assumed: [
      'Имена типов прежние: ответы срезов не меняются.',
      'Версия — отдельный тип с окончанием Hist и связью HAS_STATE, как у первого объекта.',
      'Тип поля «как есть» — объявленный в схеме прода; не объявленное там поле — строкой (пометка у поля).',
      'Удержанные значения (component_id, project и *_refs до шага связей) в схему не входят — они становятся связями.',
      'Типы без записей в снимке (KnowCanvas, KnowSavedView, QGMetric и др.) получают пустой перечень полей — схема заводится, поля появятся с данными.',
    ],
    types,
  };
  fs.writeFileSync(here('./schema/all-objects.json'), JSON.stringify(out, null, 2) + '\n');
  const n = Object.values(types).reduce((a, t) => a + Object.keys(t.fields).length, 0);
  console.log(`типов ${Object.keys(types).length}, полей ${n}; не объявлено в проде: ${Object.values(types).flatMap(t => Object.values(t.fields)).filter(f => f.note && !f.service).length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])) main();
