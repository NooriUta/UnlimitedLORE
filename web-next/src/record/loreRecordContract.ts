// Объект паспорта lore.record/1 (SPEC-LORE-UXR-RECORD-CONTRACT, ADR-LORE-047 — PROPOSED).
// Демо-проверка контракта до решения по ADR: фасад /lore/record ЭМУЛИРУЕТСЯ на клиенте
// из существующих слайсов (toLoreRecord), а kit рисует только то, что пришло в объекте
// (fromLoreRecord). Когда фасад появится на бэкенде, toLoreRecord уходит, fromLoreRecord остаётся.
// Честность: эмуляция помечена в meta.facade; упавший блок — meta.sources[].state='error', не «пусто».
import { createElement, type ReactNode } from 'react';
import { NestedList } from '@seidr/kit';
import type { KitConfig, KitCtx, KitData, KitEdge, KitLang, KitRecord, KitRelation } from '@seidr/kit';
import { appT } from '../i18n';
import { baseConfig, type PassportLoad } from './passportAdapters';
import { SPRINT_FACTS } from './loreRecord';
import { ABSENT_NUMBERS, sumOfRow, type ServerSum } from '../sprints/sprintTotals';
import { ADR_BODY_READONLY, EDITABLE_BODY } from './passportSave';

export type FieldKind = 'text' | 'md' | 'enum' | 'ref' | 'date' | 'number';
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
  write?: { endpoint: string; field: string } | null;
  /** Справочник вариантов enum (срез `dictionary`, dict_type). S4-24. */
  dict?: string;
  /** Варианты enum из среза сервера (S4-24, #1241): автор / исполнитель / принимающий — task_identities. */
  options?: OptionsSpec;
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
  target_type?: string }
export interface LoreLink { rel: string; dir: 'out' | 'in'; id: string; type: string; title: string; status: string }
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

/** Объект контракта → входы kit. Kit не знает полей типа — всё отсюда. */
/** Итоги спринта: поле паспорта ← ключ `computed` сервера, подпись — та же, что у колонки списка. */
const SPRINT_SUMS = [
  ['effort_total', 'effort_days_total', 'lists.field.effortTotal'],
  ['actual_total', 'actual_days_total', 'lists.field.actualTotal'],
] as const;

/**
 * `body_md` — самостоятельный раздел тела записи, а не копия другого раздела:
 * схема называет его полем группы body, он непуст и не совпадает ни с одним
 * другим полем той же группы.
 */
export function bodyMdIsOwnSection(c: LoreRecord1): boolean {
  const body = c.values.body_md;
  if (typeof body !== 'string' || !body.trim()) return false;
  const bodyFields = c.schema.fields.filter(f => f.group === 'body');
  if (!bodyFields.some(f => f.key === 'body_md')) return false;
  return !bodyFields.some(f => f.key !== 'body_md' && c.values[f.key] === body);
}

export function fromLoreRecord(c: LoreRecord1, lang: KitLang): PassportLoad {
  const { type, id } = c.record;
  const { title, body_md, ...fields } = c.values;
  const bodyIsOwn = bodyMdIsOwnSection(c);
  if (bodyIsOwn) fields.body_md = body_md;
  const record: KitRecord = {
    id, kind: type, title: typeof title === 'string' && title ? title : id, status: c.record.status,
    body_md: typeof body_md === 'string' && body_md ? body_md : undefined, updated_at: c.record.updated_at ?? undefined, fields,
  };
  // Части записи (parts) — ЗАДАЧИ И ФАЗЫ спринта, вопросы и решения ADR.
  //
  // Дефект прода v1.17.8: «Задач нет» при 48 задачах. Сервер отдавал их в
  // `parts[]`, а здесь читались только `links` — и вкладки, и вердикт считались
  // по рёбрам, которых в ответе нет. Теперь элементы частей становятся
  // записями и рёбрами: дальше с ними работает всё обычное — вкладки, граф,
  // вердикт, таблица задач.
  const parts = c.parts ?? [];
  const partEdges: KitEdge[] = parts.flatMap(p => p.items.map(i =>
    p.dir === 'in' ? { from: i.id, to: id, type: p.rel } : { from: id, to: i.id, type: p.rel }));
  const partRecords: KitRecord[] = parts.flatMap(p => p.items.map(i => ({
    id: i.id, kind: p.type ?? 'ref', title: i.title || i.id, status: i.status, fields: { ...(i.values ?? {}) },
  })));
  const edges: KitEdge[] = [
    ...c.links.map(l => (l.dir === 'out' ? { from: id, to: l.id, type: l.rel } : { from: l.id, to: id, type: l.rel })),
    ...partEdges,
  ];
  const linkRecords: KitRecord[] = c.links.filter((l, i, a) => a.findIndex(x => x.id === l.id) === i)
    .map(l => ({ id: l.id, kind: l.type, title: l.title, status: l.status, fields: {} }));
  const others: KitRecord[] = [...linkRecords, ...partRecords]
    .filter((r, i, a) => r.id !== id && a.findIndex(x => x.id === r.id) === i);
  // Часть не прочиталась — это РАЗНЫЕ утверждения: «нет прав» (denied) и «сбой»
  // (error). Ни одно из них не «пусто»: без этой строки вердикт показал бы
  // проверенный ноль там, где проверки не было.
  const partErrors = parts.filter(p => p.state !== 'ok').map(p => ({
    block: p.key,
    state: p.state === 'denied' ? ('forbidden' as const) : ('error' as const),
    reason: p.error ?? p.state,
  }));
  const errors = [
    ...c.meta.sources.filter(s => s.state !== 'ok').map(s => ({ block: s.block, reason: s.reason ?? s.state })),
    ...partErrors.map(e => ({ block: e.block, reason: e.reason })),
  ];
  const props = c.schema.fields.filter(f => f.group === 'props');
  // Связь place=prop — свойство: значения уже лежат в `values`. Если в
  // `schema.fields` её не перечислили, поле добавляем сами — иначе значение
  // («Проекты: NooriUta/AIDA») не показалось бы вообще, а в блоке связей
  // стояло бы «Проекты 0».
  // Итоги спринта в паспорте (S4-09): поля-суммы с охватом — тем же разбором
  // (sumOfRow), что и ячейки списка. Сервер не прислал число — «не посчитали»
  // с причиной, а не ноль.
  const sumFields: { key: string; title: string; type: 'sum' }[] = [];
  if (type === 'sprint' && c.computed) {
    for (const [key, from, titleKey] of SPRINT_SUMS) {
      const v = c.computed[from];
      record.fields[key] = v && typeof v === 'object' ? sumOfRow(v as ServerSum, false) : { error: ABSENT_NUMBERS };
      sumFields.push({ key, title: appT(lang, titleKey), type: 'sum' });
    }
  }
  const propRels = c.schema.relations.filter(r => r.place === 'prop' && !props.some(f => f.key === r.key));
  // S4-24: у связи-свойства с путём привязки — её ребро: kit рисует чипы с «Отвязать»
  // и выбор с поиском (владелица 11.11: «не сделано редактирование множественного выбора привязок»).
  const edgeOf = (key: string) => {
    const r = c.schema.relations.find(x => x.place === 'prop' && x.key === key && x.manageable);
    return r ? { relation: { rel: r.rel, dir: r.dir } } : {};
  };
  const propFields = propRels.map(r => ({
    key: r.key, title: r.label, type: 'ref' as const, ...edgeOf(r.key),
  }));
  // body_md в разделах — только когда это НАСТОЯЩЕЕ тело, а не копия (прод
  // v1.17.13, 11.11: у решения «Контент» был пуст). Копия — когда его текст
  // совпадает с другим разделом тела (у задачи body_md = note_md, у спринта =
  // context_md); тогда второй раз его не показываем. Иначе (у решения body_md —
  // само решение, rationale_md — обоснование) это первый раздел.
  const sections = c.schema.fields.filter(f => f.group === 'body' && (f.key !== 'body_md' || bodyIsOwn));
  // Разделы текста — ДАННЫМИ, а не своей функцией рисования (S5-06).
  //
  // Было: функция, которая печатала разделы текстом. И это тихо отнимало
  // правку: ✎ у тела даёт kit, но ТОЛЬКО если у вида нет своего рисовальщика
  // обзора. У задачи заметка приходит полем группы «тело», значит функция
  // задавалась всегда — и редактор до заметки не доходил. Так и выглядел
  // дефект прода v1.17.7: «нет ни ✎, ни „Править", двойной клик не открывает
  // редактор», а вместе с ним было нечем проверить черновик (S5-09).
  //
  // Теперь kit получает список «ключ + подпись» и рисует разделы сам — с ✎,
  // черновиком и честным пустым состоянием у каждого.
  // Признак «можно писать» приходит из схемы сервера: у раздела может не быть
  // пути записи, и тогда ✎ обещал бы сохранение, которого некуда отправить
  // (проверено серверной сессией по LoreRecordRegistry.schemaJson 09.11).
  const bodySections = sections.map(s => ({ key: s.key, title: s.label, editable: s.editable !== false }));
  // Связи, которые рисует САМ kit (по видам UML — со счётчиком, значком и
  // управлением). Их ключи нужны ниже: своей вкладки на тот же ключ приложение
  // не отдаёт.
  const kitRels = c.schema.relations.filter(r => (r.place ?? 'link_tab') === 'link_tab');
  const kitRelKeys = new Set(kitRels.map(r => r.key));
  const linkTabs = c.schema.tabs.filter(t => t.zone === 'record' && t.rel).map(t => ({
    key: t.key, title: t.label,
    render: () => c.links.filter(l => l.rel === t.rel && l.dir === t.dir).map(l => l.title).join(' · ') || appT(lang, 'pp.contract.noLinks'),
  }));
  // Вкладка части: её элементы уже пришли. Не прочиталась — так и сказано,
  // а не «нет элементов» (ListPassport подменяет вкладку задач настоящей
  // таблицей — withSprintTasksTab; эта остаётся для прочих частей).
  // Сервер отдаёт первые элементы части, а `count` — полное число (у
  // компонента вкладки tasks/sprints — первые 100, S9-05). Шапка вкладки
  // называет полное число, значит тело обязано сказать, что пришла лишь часть:
  // иначе 100 имён под заголовком «230» читаются как «всё». Число неизвестно
  // (null) — оговорку не выдумываем.
  //
  // 11.11.2026 (владелица): «в паспорте, где табличный вид свёрнут под "ещё",
  // должны идти стандартные сортировки, фильтры, группировки … и поиск тоже».
  // Поэтому тело части — не строка имён через «·», а список kit (`NestedList`
  // → тот же ListView, что у разделов) с поиском, фасетами, группировкой и
  // порядком. Оговорка об обрезке — под списком.
  const partShown = (p: (typeof parts)[number]): string | undefined =>
    typeof p.count === 'number' && p.count > p.items.length
      ? appT(lang, 'pp.contract.partShown', { shown: p.items.length, total: p.count })
      : undefined;
  const partBody = (p: (typeof parts)[number], ctx: KitCtx): ReactNode => {
    if (p.items.length === 0) return appT(lang, 'pp.contract.noLinks');
    const records: KitRecord[] = p.items.map(i => ({
      id: i.id, kind: p.type ?? 'ref', title: i.title || i.id, status: i.status, fields: { ...(i.values ?? {}) },
    }));
    return createElement(NestedList, { ctx, records, note: partShown(p) });
  };
  const partTabs = parts.map(p => ({
    key: p.key, title: p.label,
    // Число элементов части — в ряд вкладок (B13). Часть уже отдаёт его
    // честной формы: при state !== 'ok' приходит null, то есть «не смогли
    // посчитать», и ряд покажет «?» с подсказкой, а не ложный ноль.
    count: p.count,
    render: (_r: KitRecord, ctx: KitCtx) => (p.state !== 'ok'
      ? (p.error ?? p.state)
      : partBody(p, ctx)),
  }));
  // ОДИН РАЗДЕЛ — ОДНО МЕСТО (ревью 10.11.2026, B13; просьба владелицы того же
  // дня: «проверить, почему… в паспорте у спринтов дублирующиеся вкладки»).
  //
  // Связь с `place: "link_tab"` проходила ДВУМЯ путями: `recordFromServer`
  // (api/liveRecord.ts, `tabsOf`) делал из неё `schema.tabs` — так было до
  // того, как kit научился рисовать вкладки связей сам, — а здесь та же связь
  // уходит в `relations`, и kit строит вкладку второй раз. В ряду выходили две
  // вкладки «Зависит от»: одна со счётчиком и значком ⇢, другая без ничего
  // (отсюда же «счётчики то есть, то нет» из ревью).
  //
  // Поэтому вкладку связи отдаёт kit, а приложение оставляет свои вкладки
  // только там, где kit связь НЕ рисует: части (`place: "part"` — у них в
  // `parts[]` лежат настоящие элементы) и свойства.
  const tabs = [...partTabs, ...linkTabs.filter(t => !partTabs.some(x => x.key === t.key) && !kitRelKeys.has(t.key))];
  const config0: KitConfig = baseConfig(lang, {
    [type]: { title: c.schema.label, icon: c.schema.icon, ...(bodySections.length ? { bodySections } : {}), relations: kitRels.map(({ count: _n, place: _p, target_type: _t, ...d }) => d), fields: [...props.map(f => ({ key: f.key, title: f.label, type: f.kind, ...(f.section ? { section: f.section } : {}),
      // S4-24: правимо только при ОБОИХ — сервер назвал поле правимым И дал путь записи.
      ...(f.editable && f.write ? { editable: true } : {}),
      ...(f.required ? { required: 'block' as const } : {}),
      ...(f.kind === 'ref' ? edgeOf(f.key) : {}) })), ...propFields, ...sumFields], ...(tabs.length ? { tabs } : {}) },
  });
  const config: KitConfig = { ...config0, roles: { reader: { canEdit: c.perms.can_edit, canStatus: c.perms.can_status } } };
  // Состояние блоков идёт в meta.data_state ТОЙ ЖЕ формой, что разбирает kit
  // (dataStateOf): «нет прав», «обрезано» и сбой — разные ответы, и список
  // errors их сливал в один. errors остаётся рядом: по нему рисует плашку блок
  // связей (blockError), и терять её нельзя. Задвоения нет — разбор пропускает
  // блок, о котором уже сказано через data_state.
  //
  // S4-TECH-NOTES: строки состояния — имена источников («relation:<ключ>»,
  // «срез · часть»), с ними человек ничего сделать не может. Приложение
  // помечает их tech: kit спрячет коды и оставит строку «часть сведений не
  // загрузилась». Тег, присланный сервером, главнее — решает тот, кто родил строку.
  const dataState = [
    ...c.meta.sources.map(s => ({
      source: s.block, state: s.state, audience: s.audience ?? ('tech' as const),
      ...(s.reason ? { reason: s.reason } : {}),
      ...(s.total !== undefined ? { total: s.total } : {}),
    })),
    ...partErrors
      .filter(e => !c.meta.sources.some(s => s.block === e.block))
      .map(e => ({ source: e.block, state: e.state, reason: e.reason, audience: 'tech' as const })),
  ];
  const data: KitData = {
    records: [record, ...others], edges, journal: [],
    meta: {
      generated_at: c.meta.loaded_at,
      ...(dataState.length ? { data_state: dataState } : {}),
      ...(errors.length ? { errors } : {}),
    } as KitData['meta'],
  };
  const tasksPart = parts.find(p => p.key === 'tasks');
  const served = c.facts?.tasks;
  const counts = served && 'total' in served
    ? { done: served.done, total: served.total, ...(typeof served.open === 'number' ? { open: served.open } : {}) }
    : undefined;
  // Вердикт нужен всегда, когда сервер прислал блок фактов, а не только когда
  // пришли ЧИСЛА задач:
  //  • задачи не прочитались — `facts.tasks` нет вовсе (контракт), и вердикт
  //    должен сказать «не смогли проверить», а не промолчать;
  //  • в этом же блоке живёт срок (`dueField`), и прежнее условие «есть
  //    facts.tasks» молча отнимало вместе с задачами и строку срока.
  return { record, data, config, ...(c.facts || tasksPart ? { facts: sprintFactsFor(c.links, tasksPart, counts) } : {}) };
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
