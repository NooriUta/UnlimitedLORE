#!/usr/bin/env node
// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01 · Предложение новой схемы первого объекта — выводится, а не пишется руками.
// Вход: карта переноса, тексты полей и отчёт сухого прогона (какие поля реально получились и у скольких
// записей). Выход: schema/<объект>.json — конфиг, который показывает страница результата. Это ПРЕДЛОЖЕНИЕ:
// запись в приёмник по нему начинается только после слова владелицы.
// Запуск: node scripts/model-migration/propose-schema.mjs <отчёт сухого прогона.json>
import fs from 'node:fs';

const here = p => new URL(p, import.meta.url);
const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const report = J(process.argv[2]);
const MAP = J(here('./map/sprint-phase-task.json')).types;
const TEXTS = J(here('./texts/sprint-phase-task.json')).types;

// Вид нового поля: что делает преобразование — то и хранится.
const NEW_KIND = { created_at: 'date', updated_at: 'datetime', planned_start_date: 'date', planned_end_date: 'date', status_known_from: 'datetime', status: 'enum', status_note: 'text', priority: 'enum', priority_note: 'text', title: 'text' };
const DB_TYPE = { date: 'DATE', datetime: 'DATETIME', number: 'DOUBLE', bool: 'BOOLEAN', list: 'LIST' };

const types = {};
for (const [T, t] of Object.entries(report.types)) {
  if (!MAP[T]) continue; // отчёт пробного расчёта всех объектов: остальные типы — propose-schema-all.mjs
  // откуда пришло новое поле: имя старого поля по карте
  const from = {};
  for (const [f, e] of Object.entries(MAP[T])) {
    if (e.rule === 'keep') (from[f] ||= []).push(f);
    else if ((e.rule === 'rename' || e.rule === 'transform') && /^[a-z][a-z0-9_]*$/.test(e.to || '')) (from[e.to] ||= []).push(f);
  }
  from.status_note = ['status_raw']; from.priority_note = ['priority'];
  const fields = {};
  for (const [f, n] of Object.entries(t.outFields).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const src = (from[f] || []).filter(x => MAP[T][x]);
    const tx = TEXTS[T]?.[f] || TEXTS[T]?.[src[0]] || {};
    const kind = NEW_KIND[f] || tx.kind || 'text';
    fields[f] = { kind, db_type: DB_TYPE[kind] || 'STRING', from: src, filled: n, of: t.records, ...(tx.name ? { name: tx.name } : {}), ...(tx.service ? { service: true } : {}) };
  }
  types[T] = {
    records: t.records,
    version_of: T.endsWith('Hist') ? T.slice(0, -4) : null,
    fields,
    from_record_to_current_version: Object.keys(t.toVersion),
    held: t.held,
    rejects: Object.fromEntries(Object.entries(t.rejects).map(([k, e]) => [k, e.n])),
  };
}
// Поле, которое приходит в версию только с записи (этап сведения), сухой прогон в версии не видит — добавляем.
for (const [T, t] of Object.entries(types)) {
  const H = types[T + 'Hist'];
  if (!H) continue;
  for (const f of t.from_record_to_current_version) {
    if (H.fields[f]) continue;
    const kind = NEW_KIND[f] || 'text';
    H.fields[f] = { kind, db_type: DB_TYPE[kind] || 'STRING', from: [`${T}.${f.replace(/_note$/, '')}`], filled: report.types[T].toVersion[f] || 0, of: H.records, note: 'приходит с записи в текущую версию' };
  }
}
// Служебные поля, которые новая схема объявляет сама, даже если в данных источника их ещё нет (общий перечень
// служебных полей; сессия, harness и машина, записавшие версию: слова владелицы 16.11.2026 «в истории … пишет идентификатор
// сессии», «просить каждый mcp писать harness … константой», «и машину что уж то же», «при настройках MCP ещё две константы»).
const DECLARED_SERVICE = { changed_by_session: { kind: 'text', db_type: 'STRING', name: 'Сессия правки' }, changed_by_harness: { kind: 'text', db_type: 'STRING', name: 'Harness правки' }, changed_by_harness_note: { kind: 'text', db_type: 'STRING', name: 'Сверка harness' }, changed_by_machine: { kind: 'text', db_type: 'STRING', name: 'Машина правки' } };
for (const [T, t] of Object.entries(types)) {
  if (!T.endsWith('Hist')) continue;
  // Служебное поле служебное и с данными (снимок 18.11: changed_by_session заполнен у 52 версий задач).
  for (const [f, d] of Object.entries(DECLARED_SERVICE)) t.fields[f] = t.fields[f] ? { ...t.fields[f], ...d, service: true } : { ...d, from: [], filled: 0, of: t.records, service: true, note: 'объявлено общим перечнем служебных полей' };
}
const out = {
  _about: 'SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01. ПРЕДЛОЖЕНИЕ новой схемы первого объекта (спринт, фаза, задача) — владелицей не утверждено. Выведено из карты переноса и сухого прогона по снимку прода: в схему попали только поля, которые перенос реально дал. Запись в базу-приёмник по этой схеме начинается после её слова.',
  _source: report.source,
  _assumed: [
    'Имена типов остаются прежними (KnowSprint, KnowTask, KnowPhase): ответы срезов по решению владелицы не меняются, а новые имена типов потянули бы все срезы.',
    'Версия остаётся отдельным типом с окончанием Hist и связью «имеет состояние»: так записано решение «тип версии выводится из типа записи». Ключи записи в версии не хранятся.',
    'Удержанные значения (поля без решения) в новую схему не входят; при пробной записи они складываются в отдельный служебный тип отчёта, чтобы не потеряться.',
    'Связи первого объекта в это предложение не входят — их карта ещё не составлена.',
    'Служебные моменты версий (valid_from, valid_to, status_known_from) — DATETIME: перенос приводит их к моменту UTC, неразбираемое уходит в остаток MigLeftover (MDL-06, «даты переводи», 19.11.2026).',
  ],
  types,
};
fs.mkdirSync(here('./schema/'), { recursive: true });
fs.writeFileSync(here('./schema/sprint-phase-task.json'), JSON.stringify(out, null, 2) + '\n');
console.log(Object.entries(types).map(([T, t]) => `${T}: полей ${Object.keys(t.fields).length}`).join(' · '));
