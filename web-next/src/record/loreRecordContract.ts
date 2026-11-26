// Объект паспорта lore.record/1 (SPEC-LORE-UXR-RECORD-CONTRACT, ADR-LORE-047 — PROPOSED).
// Демо-проверка контракта до решения по ADR: фасад /lore/record ЭМУЛИРУЕТСЯ на клиенте
// из существующих слайсов (toLoreRecord), а kit рисует только то, что пришло в объекте
// (fromLoreRecord). Когда фасад появится на бэкенде, toLoreRecord уходит, fromLoreRecord остаётся.
// Честность: эмуляция помечена в meta.facade; упавший блок — meta.sources[].state='error', не «пусто».
import { bodyMdIsOwnSection as kitBodyMdIsOwnSection, passportFromDoc } from '@seidr/kit';
import type { KitConfig, KitLang, KitRelation } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { baseConfig, type PassportLoad } from './passportAdapters';
import { SPRINT_FACTS } from './loreRecord';
import { ABSENT_NUMBERS, sumOfRow, type ServerSum } from '../sprints/sprintTotals';
import { ADR_BODY_READONLY, EDITABLE_BODY } from './passportSave';

// MC-08: bool — флаг (sprint.no_release, product.is_active); kit читает «Да»/«Нет», правит флагом.
export type FieldKind = 'text' | 'md' | 'enum' | 'ref' | 'date' | 'number' | 'bool';
export interface LoreField {
  key: string; label: string; kind: FieldKind;
  required: boolean; editable: boolean; multi?: boolean;
  group: 'head' | 'body' | 'props';
  /** Раздел внутри «Свойств» (S4-36): «Планирование», «Модули». */
  section?: string;
  /**
   * Куда писать ИМЕННО ЭТОТ раздел (сервер, `LoreRecordRegistry:532`).
   *
   * Своей таблицы «тип → поле тела» в клиенте быть не должно: у спринта
   * разделов ДВА («Контекст» и «Итог»), у ADR три, и таблица по одному имени
   * на тип молча не записала бы остальные. `null` вместе с `editable: false`
   * — «только чтение», и тогда ✎ не предлагается вовсе.
   */
  write?: { endpoint: string; field: string; idKey?: string } | null;
  /** Справочник вариантов enum (срез `dictionary`, dict_type). S4-24. */
  dict?: string;
  /** Варианты enum из среза сервера (S4-24, #1241): автор / исполнитель / принимающий — task_identities. */
  options?: OptionsSpec;
  /** MDL-07: определение и описание поля из модели (сервер шлёт с MDL-02) — подсказкой у подписи в kit. */
  definition?: string;
  description?: string;
}
/** Откуда брать варианты: срез, его параметр (id записи) и имена полей строки. */
export interface OptionsSpec { slice: string; param?: string; value: string; label: string; group?: string }
/** Вариант из среза: код, подпись, подпись группы (уже словами приложения). */
export interface SliceOption { code: string; title: string; group?: string }
/** Состояние вариантов поля из среза: пришли / не пришли (причина + повтор). */
export interface OptionState { items?: SliceOption[]; error?: string; retry?: () => void }

/** Строки среза → варианты; группа (например kind) → подпись через groupTitle. */
export function optionsFromSlice(rows: readonly Record<string, unknown>[], spec: OptionsSpec, groupTitle: (g: string) => string): SliceOption[] {
  return rows.map(r => {
    const code = String(r[spec.value] ?? '');
    const title = String(r[spec.label] ?? code);
    const g = spec.group ? r[spec.group] : undefined;
    return typeof g === 'string' && g ? { code, title, group: groupTitle(g) } : { code, title };
  }).filter(o => o.code !== '');
}
export interface LoreTab { key: string; label: string; zone: 'record' | 'around'; rel?: string; dir?: 'out' | 'in'; count?: number }

/**
 * Где связь ЖИВЁТ на экране (сервер, `schema.relations[].place`).
 *
 * Разница не косметическая: `prop` — это СВОЙСТВО, его значения лежат в
 * `values` (проекты, компоненты спринта), и рисовать его блоком связей значит
 * печатать «Проекты 0» рядом с живым значением. `part` — часть записи, её
 * элементы приходят в `parts[]`. `link_tab` — настоящая вкладка связей, и
 * только у неё элементы лежат в `links`.
 */
export type LorePlace = 'own' | 'prop' | 'part' | 'link_tab';

/** Элемент части — общая обёртка `item()` сервера. id деловой: у задачи «SPRINT_X/CODE». */
export interface LorePartItem { id: string; title: string; status: string; values?: Record<string, unknown> }

/**
 * Часть записи: задачи и фазы спринта, вопросы и решения ADR (place: 'part').
 *
 * `count` — число элементов при `state: 'ok'`, иначе null: «не посчитали» не
 * ноль. `state` ровно три значения (сверено по коду сервера серверной сессией
 * 09.11.2026): ok · denied (проектный скоуп: нет разрешённых проектов) ·
 * error (сбой среза). Состояния «обрезано» у части нет — обрезку показывает
 * `meta.data_state`.
 */
export interface LorePart {
  key: string; label: string; type?: string; rel: string; dir: 'out' | 'in';
  owned?: boolean; relation?: KitRelation;
  state: 'ok' | 'denied' | 'error'; error?: string;
  count: number | null; items: LorePartItem[];
  columns?: string[]; optional_columns?: string[]; order_by?: string; create?: unknown;
}
/** Связь типа по виду UML (D-2026-LORE-RECORD-RELATION-UML) — kit рисует и управляет по виду. */
export interface LoreRelation { key: string; label: string; relation: KitRelation; rel: string; dir: 'out' | 'in'; count: number; 
  /** Есть ли у сервера путь привязки именно для этой связи (LoreRecordRelationRoutes). */
  manageable?: boolean;
  /** Где связь живёт на экране; не прислали — считаем вкладкой связей, как было до фасада. */
  place?: LorePlace;
  /** Тип на другом конце (сервер: target_type) — для подписи и иконки. */
  target_type?: string;
  /** MDL-13: свойства ребра с подписями (у «зависит от» — вид и причина): kit рисует их колонками связи. */
  props?: { key: string; label: string }[];
  /** MDL-13: привязка требует причины (сервер: reason_required) — kit спросит её ReasonDialog. */
  reasonRequired?: boolean;
  /** MDL-13: типы другого конца у связи с target_type any (сервер: target_types) — откуда брать варианты выбора. */
  target_types?: string[] }
export interface LoreLink { rel: string; dir: 'out' | 'in'; id: string; type: string; title: string; status: string;
  /** Вид концов ребра (сервер: fromKind/toKind) — идёт в KitEdge, чтобы kit не угадывал вид по записям. */
  fromKind?: string; toKind?: string;
  /** S9-05 / D14: значения колонок таблицы детей по типу ребёнка (задача: executor/effort/work_class; спринт: progress/planned_start/planned_end). Нет — сервер их не читал. */
  values?: Record<string, unknown> }
export interface LoreSource { block: string; state: 'ok' | 'forbidden' | 'error' | 'truncated'; code?: number; reason?: string; shown?: number; total?: number;
  /** Кому строка (S4-TECH-NOTES), если её назвал сервер. Нет — решает приложение (fromLoreRecord). */
  audience?: 'user' | 'tech' }
export interface LoreRecord1 {
  contract: 'lore.record/1';
  /**
   * `version` — СТРОКА, как её отдаёт фасад: `valid_from` открытого состояния
   * SCD2 (`LoreRecordVersion.normalize`). Раньше тут стояло число — тип
   * писался до фасада, по догадке. Строка нужна как есть: это метка версии
   * для `expected_version` (S5-08), а не счётчик, и арифметики над ней нет.
   */
  record: { type: string; id: string; title: string; status: string; version: string | null; updated_at: string | null; updated_by: string | null };
  schema: { type: string; label: string; icon: string; fields: LoreField[]; tabs: LoreTab[]; relations: LoreRelation[] };
  values: Record<string, unknown>;
  links: LoreLink[];
  /** Части записи; у старой клиентской эмуляции их нет. */
  parts?: LorePart[];
  /**
   * Итоги сервера (S4-09): у спринта `effort_days_total`, `actual_days_total`
   * формой {value, known, of}. У клиентской эмуляции блока нет вовсе — там
   * итогов не показываем, а не выдумываем.
   */
  computed?: Record<string, unknown>;
  /** MDL-10: значения записи вне модели (ключ → значение), только чтение; нет — ключа нет. */
  unmodeled?: Record<string, unknown>;
  /**
   * Итоги, посчитанные СЕРВЕРОМ по корпусу (не по присланной выборке).
   *
   * `facts.tasks` считается только при успешном чтении задач: при сбое ключа
   * НЕТ ВОВСЕ, а причина — в `parts[tasks].state/error` и `meta.data_state`.
   * Отсутствие ≠ ноль, поэтому клиент не подставляет 0/0.
   */
  facts: { tasks?: { done: number; total: number; open?: number } | { error: string }; due?: string | null } | null;
  perms: { can_edit: boolean; can_status: boolean; can_create: boolean; status_next: string[]; reason: string | null };
  meta: { loaded_at: string; facade: 'server' | 'client-emulated'; sources: LoreSource[] };
}

/**
 * Без чего запись не сохранить — по обязательным параметрам MCP-инструментов *_new
 * (task_new: sprint_id, title; sprint_new/adr_new/spec_new: id и название).
 * ВРЕМЕННО, до реестра полей на бэкенде (ADR-LORE-047 §1).
 */
const REQUIRED: Record<string, string[]> = { task: ['sprint'] };
/** Поля текста записи, идущие разделами (ADR: контекст / решение / следствия, как в v1). */
export const BODY_FIELDS = ['context_md', 'decision_md', 'consequences_md'];

/** Вкладки-связи типа: какое ребро они показывают. */
const TAB_REL: Record<string, { rel: string; dir: 'out' | 'in' }> = {
  tasks: { rel: 'HAS_TASK', dir: 'out' },
  decisions: { rel: 'DECIDED_IN', dir: 'in' },
};

/**
 * Право править (ADR-LORE-047 п. 14.1): текст спринта, задачи и спеки —
 * существующими путями записи; у ADR правятся разделы по отдельности (S4-24),
 * а склеенное тело — нет.
 */
function permsOf(type: string, lang: KitLang): LoreRecord1['perms'] {
  const canEdit = (EDITABLE_BODY as readonly string[]).includes(type) || type === 'adr';
  return {
    can_edit: canEdit, can_status: false, can_create: false, status_next: [],
    // У ADR причина говорит не «нельзя», а «по разделам»: разница важная,
    // иначе человек решит, что ADR не правится вовсе.
    reason: type === 'adr' ? ADR_BODY_READONLY : canEdit ? appT(lang, 'pp.contract.editNoVersion') : appT(lang, 'pp.contract.readonly'),
  };
}

/** Эмуляция фасада: загрузка из слайсов → объект контракта (только данные, без функций). */
export function toLoreRecord(load: PassportLoad, loadedAt: string, lang: KitLang = 'ru'): LoreRecord1 {
  const { record: r, data, config } = load;
  const type = r.kind.toLowerCase();
  const kind = config.kinds[r.kind];
  const req = REQUIRED[type] ?? [];
  const all = kind?.fields ?? [];
  const bodyDefs = all.filter(f => BODY_FIELDS.includes(f.key));
  // Поле-сумма (S4-09) — итог сервера, а не поле записи: в поля паспорта для
  // правки оно не идёт (писать его некуда).
  const props: LoreField[] = all.filter(f => !BODY_FIELDS.includes(f.key) && f.type !== 'sum').map(f => ({
    key: f.key, label: f.title, kind: f.type as FieldKind, required: req.includes(f.key), editable: true,
    ...(f.type === 'ref' && Array.isArray(r.fields[f.key]) ? { multi: true } : {}),
    ...(f.section ? { section: f.section } : {}),
    group: 'props' as const,
  }));
  props.sort((a, b) => Number(b.required) - Number(a.required));
  const byId = new Map(data.records.map(x => [x.id, x]));
  const links: LoreLink[] = data.edges.flatMap(e => {
    const out = e.from === r.id;
    if (!out && e.to !== r.id) return [];
    const other = byId.get(out ? e.to : e.from);
    return [{ rel: e.type, dir: out ? 'out' as const : 'in' as const, id: out ? e.to : e.from, type: other?.kind ?? 'ref', title: other?.title ?? (out ? e.to : e.from), status: other?.status ?? '' }];
  });
  const tabs: LoreTab[] = (kind?.tabs ?? []).map(t => {
    const rel = TAB_REL[t.key];
    return { key: t.key, label: t.title, zone: 'record' as const, ...(rel ? { ...rel, count: links.filter(l => l.rel === rel.rel && l.dir === rel.dir).length } : {}) };
  });
  const errors = data.meta.errors ?? [];
  const tasksErr = errors.find(e => e.block === 'tasks');
  const taskLinks = links.filter(l => l.rel === 'HAS_TASK' && l.dir === 'out');
  const facts = load.facts
    ? { tasks: tasksErr ? { error: tasksErr.reason } : { done: taskLinks.filter(l => l.status === 'done').length, total: taskLinks.length }, due: (r.fields.planned_end_date as string | null) ?? null }
    : null;
  const values: Record<string, unknown> = { title: r.title, body_md: r.body_md ?? null, ...r.fields };
  return {
    contract: 'lore.record/1',
    record: { type, id: r.id, title: r.title, status: r.status, version: null, updated_at: r.updated_at ?? null, updated_by: null },
    schema: {
      type, label: kind?.title ?? type, icon: kind?.icon ?? 'help',
      fields: [
        { key: 'title', label: appT(lang, 'pp.field.title'), kind: 'text', required: true, editable: true, group: 'head' },
        ...(bodyDefs.length
          ? bodyDefs.map(f => ({ key: f.key, label: f.title, kind: 'md' as const, required: false, editable: true, group: 'body' as const }))
          : [{ key: 'body_md', label: appT(lang, 'pp.field.body'), kind: 'md' as const, required: false, editable: true, group: 'body' as const }]),
        ...props,
      ],
      tabs,
      relations: (kind?.relations ?? []).map(d => ({ ...d, count: links.filter(l => l.rel === d.rel && l.dir === d.dir).length })),
    },
    values: JSON.parse(JSON.stringify(values)) as Record<string, unknown>,
    links,
    facts,
    perms: permsOf(type, lang),
    meta: {
      loaded_at: loadedAt,
      facade: 'client-emulated',
      sources: [{ block: 'record', state: 'ok' }, ...errors.map(e => ({ block: e.block, state: 'error' as const, reason: e.reason }))],
    },
  };
}

/**
 * S9-05 / D14: колонки таблицы детей по типу ребёнка — сверх общих. Ключи значений —
 * `values` связи с фасада (LoreRecordFrom.CHILD_VALUES).
 */
const CHILD_COLUMNS: Record<string, readonly string[]> = {
  task: ['fields.executor', 'fields.effort', 'fields.work_class'],
  sprint: ['progress:progress', 'fields.planned_start', 'fields.planned_end'],
};

function childFieldsOf(kind: string, lang: KitLang): NonNullable<KitConfig['kinds'][string]['fields']> {
  if (kind === 'task') return [
    { key: 'executor', title: appT(lang, 'pp.field.executor'), type: 'text' },
    { key: 'effort', title: appT(lang, 'pp.field.effort'), type: 'number' },
    { key: 'work_class', title: appT(lang, 'pp.field.workClass'), type: 'text' },
  ];
  return [
    { key: 'progress', title: appT(lang, 'sprintTree.field.progress'), type: 'text' },
    { key: 'planned_start', title: appT(lang, 'pp.field.plannedStart'), type: 'date' },
    { key: 'planned_end', title: appT(lang, 'pp.field.plannedEnd'), type: 'date' },
  ];
}

/** Итоги спринта: поле паспорта ← ключ `computed` сервера, подпись — та же, что у колонки списка. */
const SPRINT_SUMS = [
  ['effort_total', 'effort_days_total', 'lists.field.effortTotal'],
  ['actual_total', 'actual_days_total', 'lists.field.actualTotal'],
] as const;

/**
 * Объект контракта → входы kit. Сборку делает kit (`passportFromDoc`, K5-PASSPORT-FROM-MODEL);
 * здесь — только то, что знает LORE: колонки детей задачи и спринта, итоги спринта (S4-09: тем же
 * разбором sumOfRow, что ячейки списка; не прислал сервер — «не посчитали», а не ноль), облик и
 * статусы LORE (baseConfig) и вердикт спринта.
 */
/** `body_md` — свой раздел тела или копия другого (правило kit, `bodyMdIsOwnSection`). */
export const bodyMdIsOwnSection = (c: LoreRecord1): boolean => kitBodyMdIsOwnSection(c);

/**
 * Метрики гейта (часть `metrics`, тип qg_metric — спека LORE_SCHEMA_V12_NEW_TYPES): все поля спеки колонками.
 * Владелица 20.11.2026: если значения нет — пишется словами, а не пустой ячейкой и не нулём.
 */
export const QG_METRIC_COLUMNS = ['fields.code', 'fields.current_value', 'fields.result', 'fields.threshold', 'fields.unit', 'fields.direction'] as const;

const QG_DIRECTIONS = ['gte', 'lte', 'eq'] as const;
const QG_RESULTS = ['pass', 'fail', 'unknown'] as const;

/** Часть метрик гейта → вид для таблицы: коды и пустые значения словами; прочие части — как есть. */
export function qgMetricPartForView(p: LorePart, lang: KitLang): LorePart {
  if (p.type !== 'qg_metric') return p;
  const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';
  const items = p.items.map(i => {
    const v = i.values ?? {};
    const dir = QG_DIRECTIONS.find(d => d === v.direction);
    const res = QG_RESULTS.find(r => r === v.status) ?? 'unknown';
    return {
      ...i,
      // итог — колонкой словами; чип статуса LORE у метрики не к месту (pass/fail — не статус плана)
      status: '',
      values: {
        ...v,
        result: appT(lang, `pp.qgMetric.result.${res}`),
        threshold: has(v.threshold) ? v.threshold : appT(lang, 'pp.qgMetric.noThreshold'),
        unit: has(v.unit) ? v.unit : appT(lang, 'pp.qgMetric.noUnit'),
        direction: dir ? appT(lang, `pp.qgMetric.direction.${dir}`) : appT(lang, 'pp.qgMetric.noDirection'),
        current_value: typeof v.current_value === 'number' ? v.current_value : appT(lang, 'pp.qgMetric.noValue'),
      },
    };
  });
  return { ...p, items };
}

const QG_METRIC_LABELS: Record<(typeof QG_METRIC_COLUMNS)[number], AppKey> = {
  'fields.code': 'pp.field.code',
  'fields.result': 'pp.field.qgMetricStatus',
  'fields.threshold': 'pp.field.threshold',
  'fields.unit': 'pp.field.unit',
  'fields.direction': 'pp.field.direction',
  'fields.current_value': 'pp.field.currentValue',
};

export function fromLoreRecord(c0: LoreRecord1, lang: KitLang): PassportLoad {
  const c: LoreRecord1 = c0.parts?.some(p => p.type === 'qg_metric')
    ? { ...c0, parts: c0.parts.map(p => qgMetricPartForView(p, lang)) }
    : c0;
  const { type } = c.record;
  const doc = passportFromDoc(c, {
    lang,
    // Метрики — свой набор колонок целиком: статус плана, вид и полный ключ строки у метрики — шум.
    partColumns: p => (p.type === 'qg_metric'
      ? { base: false as const, columns: ['title', ...QG_METRIC_COLUMNS.map(key => ({ key, label: appT(lang, QG_METRIC_LABELS[key]) }))] }
      : undefined),
    childColumns: target => (CHILD_COLUMNS[target]
      ? { columns: [...CHILD_COLUMNS[target]], kind: { title: appT(lang, target === 'task' ? 'pp.kind.task' : 'pp.kind.sprint'), icon: target, fields: childFieldsOf(target, lang) } }
      : undefined),
    extraFields: d => (type === 'sprint' && d.computed
      ? SPRINT_SUMS.map(([key, from, titleKey]) => {
        const v = d.computed?.[from];
        return { field: { key, title: appT(lang, titleKey), type: 'sum' as const }, value: v && typeof v === 'object' ? sumOfRow(v as ServerSum, false) : { error: ABSENT_NUMBERS } };
      })
      : []),
  });
  const config0: KitConfig = baseConfig(lang, doc.kinds);
  const config: KitConfig = { ...config0, roles: { reader: doc.reader } };
  const parts = c.parts ?? [];
  const tasksPart = parts.find(p => p.key === 'tasks');
  const served = c.facts?.tasks;
  const counts = served && 'total' in served
    ? { done: served.done, total: served.total, ...(typeof served.open === 'number' ? { open: served.open } : {}) }
    : undefined;
  // Вердикт нужен всегда, когда сервер прислал блок фактов, а не только когда пришли ЧИСЛА
  // задач: задачи не прочитались — вердикт говорит «не смогли проверить»; в этом же блоке срок.
  return { record: doc.record, data: doc.data, config, ...(c.facts || tasksPart ? { facts: sprintFactsFor(c.links, tasksPart, counts) } : {}) };
}

/**
 * Связь «спринт ↔ задача» в той форме, в какой её прислали.
 *
 * Серверный фасад /lore/record (с v1.17.5) отдаёт задачи спринта связью
 * PART_OF «in» (задача → спринт), прежняя эмуляция из срезов — HAS_TASK «out».
 * Вердикт искал только HAS_TASK, и паспорт спринта писал «Задач нет» при 16
 * задачах (владелица 09.11.2026). Берём ту форму, что пришла; PART_OF к не
 * задаче (спринт в вехе) задачей не считается.
 */
function sprintFactsFor(
  links: LoreLink[],
  tasksPart: LorePart | undefined,
  counts: { done: number; total: number; open?: number } | undefined,
): typeof SPRINT_FACTS {
  // Форму берём у части, если она есть: имя ребра и направление приходят в
  // ответе, и догадываться о них незачем.
  const base = tasksPart
    ? { ...SPRINT_FACTS, childEdge: tasksPart.rel, childDir: tasksPart.dir }
    : links.some(l => l.rel === 'PART_OF' && l.dir === 'in' && l.type === 'task')
      ? { ...SPRINT_FACTS, childEdge: 'PART_OF', childDir: 'in' as const }
      : SPRINT_FACTS;
  return counts ? { ...base, counts } : base;
}

/**
 * Варианты enum-полей вида — из справочников (S4-24). Ключ — dict_type поля
 * схемы; справочника нет — вариантов нет, и kit такое поле не даст править
 * (выбирать не из чего), а не покажет пустой список.
 */
export function withFieldOptions(cfg: KitConfig, type: string, dicts: Readonly<Record<string, readonly { code: string; title: string }[]>>, dictOf: (key: string) => string | undefined = k => k, sliceOptions: Readonly<Record<string, OptionState>> = {}): KitConfig {
  const kind = cfg.kinds[type];
  if (!kind?.fields) return cfg;
  const fields = kind.fields.map(f => {
    if (f.type !== 'enum') return f;
    const items = dicts[dictOf(f.key) ?? ''];
    if (items?.length) return { ...f, options: items.map(i => ({ value: i.code, label: i.title })) };
    // S4-24: варианты из среза сервера; не пришли — причина и «Повторить», а не свободный ввод.
    const st = sliceOptions[f.key];
    if (st?.items?.length) return { ...f, options: st.items.map(i => (i.group ? { value: i.code, label: i.title, group: i.group } : { value: i.code, label: i.title })) };
    if (st?.error) return { ...f, optionsError: st.error, ...(st.retry ? { onOptionsRetry: st.retry } : {}) };
    return f;
  });
  return { ...cfg, kinds: { ...cfg.kinds, [type]: { ...kind, fields } } };
}
