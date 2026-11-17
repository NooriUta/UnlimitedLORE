#!/usr/bin/env node
// MIG-01 · Карта переноса всех объектов, кроме первого (спринт, фаза, задача — своей картой). Выводится правилами
// из переписи полей снимка, а не пишется руками. Слово владелицы 17.11.2026: «перенеси по собственным рекомендациям
// и нашим правилам все объекты».
//
// Правила (основание в скобках): служебные поля общего перечня — как есть (owner, 15–16.11 «утверждаю»); статус —
// код справочника (owner, «статусная модель uppercase»); приоритет — одна шкала (owner); даты — настоящим типом
// (owner, «унификация через миграцию базы»); компонент и проект — только связью (owner, «только ребро»), ссылки
// строкой — связями: удерживаются до шага связей; hist_for и status_category не переносятся; план-доска — снята
// (owner, «план доску удаляем»); журнал шагов — заменён отметкой схемы; остальное — как есть (delegated).
// Запуск: node propose-map-all.mjs <перепись.json> → map/all-objects.json
import fs from 'node:fs';

const FIRST = new Set(['KnowSprint', 'KnowSprintHist', 'KnowPhase', 'KnowPhaseHist', 'KnowTask', 'KnowTaskHist']);
const SERVICE = new Set(['valid_from', 'valid_to', 'state_uid', 'content_hash', 'changed_by', 'changed_by_kind', 'changed_by_session',
  'changed_by_harness', 'changed_by_harness_note', 'changed_by_machine', 'status_known_from', 'status_backfilled', 'source_commit', 'origin']);
const STATUS_TYPES = new Set(['KnowADR', 'KnowADRHist', 'KnowDecision', 'KnowDecisionHist', 'KnowSpec', 'KnowSpecHist', 'KnowMilestoneHist', 'KnowQuestion', 'KnowUseCase', 'QualityGate']);
const EDGE_FIELDS = { component_id: 'связь с компонентом (BELONGS_TO)', project: 'связь с проектом (BELONGS_TO_PROJECT)', git_project: 'связь с проектом (BELONGS_TO_PROJECT)' };
const DATE = /(^date_|_date$|^created_date$)/, DATETIME = /(^|_)(created_at|updated_at|closed_at|merged_at|retired_at|reached_at|ts|at)$/;
const W = 'владелица 17.11.2026: «перенеси по собственным рекомендациям и нашим правилам все объекты»';

/** Судьба типа целиком. */
export function typePlan(T) {
  if (FIRST.has(T)) return { move: false, why: 'первый объект — своей картой (sprint-phase-task.json)' };
  if (/^Plan/.test(T)) return { move: false, why: 'план-доска снята: D-2026-LORE-PLAN-BOARD-REMOVED («план доску удаляем»)' };
  if (T === 'LoreSchemaVersion') return { move: false, why: 'журнал шагов V заменён отметкой LoreModelSchema (MIG-03)' };
  return { move: true };
}

/** Правило одного поля. */
export function ruleFor(T, f) {
  if (f === 'hist_for') return { rule: 'drop', why: 'ключ записи в версии повторяет связь HAS_STATE', basis: 'delegated', note: W };
  // В версиях спеки status_raw не встречается без status (замер прода 17.11: 0 из 102) — дубль.
  if (T === 'KnowSpecHist' && f === 'status_raw') return { rule: 'drop', why: 'дубль status: без него не встречается (0 из 102, прод 17.11)', basis: 'delegated', note: W };
  if (f === 'status_category') return { rule: 'drop', why: 'категория выводится из кода статуса и справочника', basis: 'owner' };
  if (SERVICE.has(f)) return { rule: 'keep', basis: 'owner', note: 'служебное' };
  if ((f === 'status_raw' || f === 'status') && STATUS_TYPES.has(T)) return { rule: 'transform', to: 'status', how: 'status', basis: 'owner', note: 'код справочника, приписка — в status_note' };
  if (f === 'priority') return { rule: 'transform', to: 'priority', how: 'priority', basis: 'owner', note: 'одна шкала, приписка — в priority_note' };
  if (EDGE_FIELDS[f]) return { rule: 'open', question: EDGE_FIELDS[f] + ' — строится на шаге связей; до него значение удерживается' };
  if (/_refs$/.test(f)) return { rule: 'open', question: 'ссылки строкой становятся связями на шаге связей; ненайденное — текстом в заметке версии' };
  // date_display — подпись срока для людей («18 апр», «прогноз Q4 2026»), не дата (пробный расчёт 17.11).
  if (f === 'date_display') return { rule: 'keep', basis: 'delegated', note: 'подпись срока, не дата; ' + W };
  if (DATE.test(f)) return { rule: 'transform', to: f === 'created_date' || f === 'date_created' ? 'created_at' : f, how: 'DATE', basis: 'owner' };
  if (DATETIME.test(f)) return { rule: 'transform', to: f, how: 'DATETIME', basis: 'owner' };
  return { rule: 'keep', basis: 'delegated', note: W };
}

/** Карта по переписи: { types: {T: {f: правило}}, skipped: {T: почему} }. Порядок — по имени, детерминированно. */
export function proposeMap(census) {
  const types = {}, skipped = {};
  for (const T of Object.keys(census).sort()) {
    const p = typePlan(T);
    if (!p.move) { if (!FIRST.has(T)) skipped[T] = p.why; continue; }
    types[T] = {};
    for (const { name } of [...(census[T].fields || [])].sort((a, b) => a.name.localeCompare(b.name))) types[T][name] = ruleFor(T, name);
  }
  return { _about: 'MIG-01 · карта переноса всех объектов, кроме первого; выведена propose-map-all.mjs из переписи полей снимка прода. Не править руками — править правила.', types, skipped };
}

if (process.argv[1] && process.argv[1].endsWith('propose-map-all.mjs')) {
  const census = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const m = proposeMap(census);
  fs.writeFileSync(new URL('./map/all-objects.json', import.meta.url), JSON.stringify(m, null, 1) + '\n');
  const n = Object.values(m.types).reduce((a, t) => a + Object.keys(t).length, 0);
  console.log(`карта: типов ${Object.keys(m.types).length}, полей ${n}; не переносятся: ${Object.keys(m.skipped).join(', ')}`);
}
