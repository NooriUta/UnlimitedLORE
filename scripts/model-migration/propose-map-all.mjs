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
import { legacyRule } from './legacy.mjs';
import { fileURLToPath } from 'node:url';
import { codeTypes, LORE_JAVA } from './code-types.mjs';

const FIRST = new Set(['KnowSprint', 'KnowSprintHist', 'KnowPhase', 'KnowPhaseHist', 'KnowTask', 'KnowTaskHist']);
const SERVICE = new Set(['valid_from', 'valid_to', 'state_uid', 'content_hash', 'changed_by', 'changed_by_kind', 'changed_by_session',
  'changed_by_harness', 'changed_by_harness_note', 'changed_by_machine', 'status_known_from', 'status_backfilled', 'source_commit', 'origin']);
const STATUS_TYPES = new Set(['KnowADR', 'KnowADRHist', 'KnowDecision', 'KnowDecisionHist', 'KnowSpec', 'KnowSpecHist', 'KnowMilestoneHist', 'KnowQuestion', 'KnowUseCase', 'QualityGate']);
const OWN_KEY = { LoreComponent: 'component_id' };
const EDGE_FIELDS = { component_id: 'связь с компонентом (BELONGS_TO)', project: 'связь с проектом (BELONGS_TO_PROJECT)', git_project: 'связь с проектом (BELONGS_TO_PROJECT)' };
const DATE = /(^date_|_date$|^created_date$)/, DATETIME = /(^|_)(created_at|updated_at|closed_at|merged_at|retired_at|reached_at|ts|at)$/;
/** Поля с окончанием _at, которые по смыслу — день, а не момент (MDL-06). */
const DAY_AT = new Set(['shipped_at']);
/**
 * MD-02 «что выключаем»: легаси-словари статусов, вид трека (сняты V89, #1401, LoreSchemaMigrations.RETIRED_LEGACY_STATUS_TYPES).
 * В переписи прода их уже нет, но источник без V89 их несёт — без правила структура вне карты воссоздала бы их «как есть».
 * Поэтому они в «не переносится» всегда, а не только когда их видела перепись.
 */
export const RETIRED_V89 = ['StatusAdr', 'StatusDecision', 'StatusMilestone', 'StatusPhase', 'StatusSprint', 'StatusTask', 'TrackType'];
const RETIRED_WHY = 'снят V89 (#1401): статус — код в строке версии, вид трека — поле; MD-02 «что выключаем»';
const W = 'владелица 17.11.2026: «перенеси по собственным рекомендациям и нашим правилам все объекты»';

/** Судьба типа целиком. */
export function typePlan(T) {
  if (FIRST.has(T)) return { move: false, why: 'первый объект — своей картой (sprint-phase-task.json)' };
  if (/^Plan/.test(T)) return { move: false, why: 'план-доска снята: D-2026-LORE-PLAN-BOARD-REMOVED («план доску удаляем»)' };
  if (RETIRED_V89.includes(T)) return { move: false, why: RETIRED_WHY };
  if (T === 'LoreSchemaVersion') return { move: false, why: 'журнал шагов V заменён отметкой LoreModelSchema (MIG-03)' };
  return { move: true };
}

/** Правило одного поля. */
export function ruleFor(T, f) {
  // MDL-08 (владелица 20.11.2026): легаси-поле не переносится, значение — в остаток MigLeftover; правило старше прочих.
  const legacy = legacyRule(T, f);
  if (legacy) return legacy;
  if (f === 'hist_for') return { rule: 'drop', why: 'ключ записи в версии повторяет связь HAS_STATE', basis: 'delegated', note: W };
  // В версиях спеки status_raw не встречается без status (замер прода 17.11: 0 из 102) — дубль.
  if (T === 'KnowSpecHist' && f === 'status_raw') return { rule: 'drop', why: 'дубль status: без него не встречается (0 из 102, прод 17.11)', basis: 'delegated', note: W };
  if (f === 'status_category') return { rule: 'drop', why: 'категория выводится из кода статуса и справочника', basis: 'owner' };
  // MDL-06, владелица 19.11.2026 «даты переводи»: служебный момент «в текущем статусе с» — DATETIME у всех версий
  // (раньше — «как есть», строкой); неразбираемое значение — в остаток с причиной.
  if (f === 'status_known_from') return { rule: 'transform', to: f, how: 'DATETIME', basis: 'owner', note: 'служебное; момент UTC — «даты переводи» (19.11.2026)' };
  if (SERVICE.has(f)) return { rule: 'keep', basis: 'owner', note: 'служебное' };
  if ((f === 'status_raw' || f === 'status') && STATUS_TYPES.has(T)) return { rule: 'transform', to: 'status', how: 'status', basis: 'owner', note: 'код справочника, приписка — в status_note' };
  // harness агента — к кодам справочника miniLORE (её хозяйство, ADR-LORE-054 п.8; владелица 17.11: «как у minilore»).
  if (T === 'KnowActor' && f === 'harness') return { rule: 'transform', to: 'harness', how: 'harness', basis: 'owner', note: 'коды miniLORE: claude, kimi, dsh, qwen; известные codex, opencode, cursor' };
  if (f === 'priority') return { rule: 'transform', to: 'priority', how: 'priority', basis: 'owner', note: 'одна шкала, приписка — в priority_note' };
  // ключ своего типа — не ссылка: component_id у LoreComponent — его код (18.11.2026: в новой базе он пропадал)
  if (OWN_KEY[T] === f) return { rule: 'keep', basis: 'owner', note: 'ключ записи своего типа' };
  if (EDGE_FIELDS[f]) return { rule: 'open', question: EDGE_FIELDS[f] + ' — строится на шаге связей; до него значение удерживается' };
  if (/_refs$/.test(f)) return { rule: 'open', question: 'ссылки строкой становятся связями на шаге связей; ненайденное — текстом в заметке версии' };
  // date_display — подпись срока для людей («18 апр», «прогноз Q4 2026»), не дата (пробный расчёт 17.11).
  if (f === 'date_display') return { rule: 'keep', basis: 'delegated', note: 'подпись срока, не дата; ' + W };
  // MDL-06, 19.11.2026: «выпущено» сценария — день (путь записи ставит LocalDate); окончание _at здесь не момент.
  if (DAY_AT.has(f)) return { rule: 'transform', to: f, how: 'DATE', basis: 'owner', note: 'день, хоть и _at — «даты переводи» (19.11.2026)' };
  if (DATE.test(f)) return { rule: 'transform', to: f === 'created_date' || f === 'date_created' ? 'created_at' : f, how: 'DATE', basis: 'owner' };
  if (DATETIME.test(f)) return { rule: 'transform', to: f, how: 'DATETIME', basis: 'owner' };
  return { rule: 'keep', basis: 'delegated', note: W };
}

/**
 * Служебные поля правки у каждого типа версий — «как есть», даже если перепись их ещё не видела (их нет в снимке 15.11:
 * AO-SESSION-LOG пишет их с 16.11; снимок 18.11 их несёт, и без правила перенос терял бы их как «вне карты»).
 * Основание — D-2026-LORE-SESSION-MACHINE-PLACE-MODEL; схема объявляет те же поля (propose-schema*.mjs, SERVICE).
 */
export const SERVICE_EDIT = ['changed_by_session', 'changed_by_harness', 'changed_by_harness_note', 'changed_by_machine'];
const SERVICE_EDIT_RULE = { rule: 'keep', basis: 'owner', note: 'служебное поле правки: сессия, harness и машина, записавшие версию (AO-SESSION-LOG; D-2026-LORE-SESSION-MACHINE-PLACE-MODEL)' };

/**
 * MD-02 8а — пустой тип (0 записей по переписи). Владелица 19.11.2026: «по коду восстанови и по данным что выбрать»,
 * «функции оставить, алгоритмами и здравым смыслом подобрать типы». Тип, который трогает код сервера (code-types.mjs),
 * переходит в 1.18 «только схемой»: без данных, со свойствами старой схемы как есть (дата строкой остаётся строкой —
 * её так пишет код) и с её индексами. Пустой и не используемый кодом — не создаётся.
 */
export const SCHEMA_ONLY_WHY = 'пустой тип — только схема, без данных: тип нужен живому коду сервера (решение владелицы 19.11.2026, MD-02 8а «функции оставить»)';
export const EMPTY_UNUSED_WHY = 'пустой и не используется кодом — не создаётся (решение владелицы 19.11.2026, MD-02 8а)';
const SCHEMA_ONLY_RULE = { rule: 'keep', basis: 'owner', note: 'тип «только схема»: свойство старой схемы как есть (MD-02 8а)' };
/**
 * Свойства, которые код пишет, а старая схема не задаёт. Порядок источников (владелица 19.11.2026): старая схема →
 * спека → вывод из кода → мягкий тип. Сторож (md02-empty-types.test.mjs) находит каждое такое свойство по SQL кода
 * (codeWrittenFields) и требует запись здесь — с типом и источником.
 */
export const CODE_FIELDS = {
  KnowCanvasLink: {
    graph_state: { db_type: 'STRING', source: 'выведено из кода: LoreCanvasResource.java — UPSERT graph_state = :g, значения «drawing» | «created», чтение ifnull(graph_state, \'drawing\')' },
  },
  QGMetric: {
    name: { db_type: 'STRING', source: 'выведено из кода: LoreIngestService.upsertQGMetric — name = truncate(metric.name(), 500), строка' },
    threshold: { db_type: 'STRING', source: 'спека LORE_SCHEMA_V12_NEW_TYPES называет поле («пороговое значение»), тип не задаёт; тип выведен из кода: LoreIngestService.upsertQGMetric — threshold = truncate(metric.threshold(), 200), строка' },
    // 20.11.2026, «доделать функции, чтобы все поля работали»: остальные поля спеки пишет QgMetricState.UPSERT_SQL.
    unit: { db_type: 'STRING', source: 'спека LORE_SCHEMA_V12_NEW_TYPES: unit — «% · s · MB/s · count», строка; пишет QgMetricState (из порога, иначе из прогона)' },
    direction: { db_type: 'STRING', source: 'спека LORE_SCHEMA_V12_NEW_TYPES: direction — «gte · lte · eq», код-строка; пишет QgMetricState (из текста порога)' },
    current_value: { db_type: 'DOUBLE', source: 'спека LORE_SCHEMA_V12_NEW_TYPES: current_value — «последнее измерение (NULL если нет)», число; пишет QgMetricState (значение метрики последнего прогона гейта, ClRoutineMetric.value — DOUBLE)' },
    status: { db_type: 'STRING', source: 'спека LORE_SCHEMA_V12_NEW_TYPES: status — «pass · fail · unknown», код-строка; пишет QgMetricState (по порогу и направлению)' },
  },
};

/**
 * Карта по переписи: { types: {T: {f: правило}}, skipped: {T: почему}, schema_only: {T: почему} }. Порядок — по имени.
 * opts.codeTypes — типы, которые трогает код сервера; не передан — пустой тип не выбрасывается (функцию не теряем по незнанию).
 */
export function proposeMap(census, opts = {}) {
  const types = {}, skipped = {}, schemaOnly = {};
  const used = opts.codeTypes;
  for (const T of Object.keys(census).sort()) {
    const p = typePlan(T);
    if (!p.move) { if (!FIRST.has(T)) skipped[T] = p.why; continue; }
    const empty = census[T].total === 0;
    if (empty && used && !used.has(T)) { skipped[T] = EMPTY_UNUSED_WHY; continue; }
    types[T] = {};
    if (empty) {
      schemaOnly[T] = SCHEMA_ONLY_WHY;
      const fields = [...(census[T].fields || []).map(f => f.name), ...Object.keys(CODE_FIELDS[T] || {})].sort((a, b) => a.localeCompare(b));
      for (const f of fields) types[T][f] = CODE_FIELDS[T] && CODE_FIELDS[T][f] ? { rule: 'keep', basis: 'owner', note: 'тип «только схема»: ' + CODE_FIELDS[T][f].source } : { ...SCHEMA_ONLY_RULE };
    } else for (const { name } of [...(census[T].fields || [])].sort((a, b) => a.name.localeCompare(b.name))) types[T][name] = ruleFor(T, name);
    if (T.endsWith('Hist')) for (const f of SERVICE_EDIT) if (!types[T][f]) types[T][f] = { ...SERVICE_EDIT_RULE };
  }
  for (const T of RETIRED_V89) skipped[T] ||= RETIRED_WHY;
  const sortedSkipped = Object.fromEntries(Object.entries(skipped).sort(([a], [b]) => a.localeCompare(b)));
  return { _about: 'MIG-01 · карта переноса всех объектов, кроме первого; выведена propose-map-all.mjs из переписи полей снимка прода. Не править руками — править правила.', types, skipped: sortedSkipped, schema_only: schemaOnly };
}

if (process.argv[1] && process.argv[1].endsWith('propose-map-all.mjs')) {
  const census = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  // какие типы трогает код сервера — по SQL исходников (имена переписи — для реестров вида HIST_PARENT)
  const m = proposeMap(census, { codeTypes: new Set(codeTypes(fileURLToPath(LORE_JAVA), new Set(Object.keys(census))).keys()) });
  fs.writeFileSync(new URL('./map/all-objects.json', import.meta.url), JSON.stringify(m, null, 1) + '\n');
  const n = Object.values(m.types).reduce((a, t) => a + Object.keys(t).length, 0);
  console.log(`карта: типов ${Object.keys(m.types).length}, полей ${n}; не переносятся: ${Object.keys(m.skipped).join(', ')}; только схема: ${Object.keys(m.schema_only).join(', ')}`);
}
