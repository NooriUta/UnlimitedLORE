// Документ записи → входы паспорта kit (SPRINT_UXR_S14_KIT5/K5-PASSPORT-FROM-MODEL, шаг 3).
//
// Повод — владелица 15.11.2026: «аводи а то это не kit а полкита». Детали паспорта в kit были,
// а СБОРКА их из ответа сервера жила только в приложении LORE (web-next `fromLoreRecord`).
// Чужое приложение («Дата-странники») собирало паспорт своим кодом и получило вкладку на
// каждый вид ребра, обзор текстом без значков и т. п. Теперь сборщик — здесь.
//
// ГРАНИЦА K-14. Документ записи — общая форма ответа «запись + схема + связи + части + права +
// состояние источников» (у LORE это контракт lore.record/1). Предметного kit не знает:
//   • колонки таблицы детей по виду ребёнка — слот `childColumns`;
//   • вычисляемые поля (итоги спринта у LORE) — слот `extraFields`;
//   • облик видов, статусы, рёбра — конфиг приложения, в который вливаются `kinds`.
//
// ЧЕСТНЫЕ СОСТОЯНИЯ. Часть, которая не прочиталась, — «нет прав» или «сбой», а не «пусто»;
// «обрезано» — не ошибка (оно идёт строкой data_state, а не в errors: иначе счётчик вкладки
// превращался в «?»); итог части больше пришедших элементов — оговорка «показаны N из M».
import { createElement, type ReactNode } from 'react';
import type { KindConfig, KitCtx, KitData, KitEdge, KitRecord, KitRelation, KitRelationDef } from '../core/contract';
import { kitT, type KitLang } from '../i18n';
import { NestedList } from '../list/NestedList';

type FieldDef = NonNullable<KindConfig['fields']>[number];

/** Вид поля документа (MC-08: bool — флаг «Да»/«Нет»). */
/** list — значения списком (K5-FIELD-LIST), kv — вложенный объект (K4-FIELD-KV): пилот передавал их «как есть», вне контракта. */
export type KitDocFieldKind = 'text' | 'md' | 'enum' | 'ref' | 'date' | 'number' | 'bool' | 'list' | 'kv';

/** Поле схемы документа. Куда писать (`write`) — понятие приложения: kit проверяет только наличие. */
export interface KitDocField {
  key: string; label: string; kind: KitDocFieldKind;
  required: boolean; editable: boolean; multi?: boolean;
  group: 'head' | 'body' | 'props';
  /** Раздел внутри «Свойств». */
  section?: string;
  /** Путь записи поля. Нет (или null) — поле только для чтения, даже если `editable`. */
  write?: unknown;
  /** Поле kv: подписи ключей значения (как props у связи). Нет — ключи как есть. */
  keys?: { key: string; label: string }[];
  /** MDL-07: что это за поле — одной фразой (модель). Подсказкой у подписи. */
  definition?: string;
  /** MDL-07: подробнее — как ставится, когда меняется. Подсказкой у подписи. */
  description?: string;
}

/** Вкладка схемы. `rel`/`dir` — ребро, которое она показывает. */
export interface KitDocTab { key: string; label: string; zone: 'record' | 'around'; rel?: string; dir?: 'out' | 'in'; count?: number }

/**
 * Где связь живёт на экране: `prop` — свойство (значения в `values`), `part` — часть записи
 * (элементы в `parts[]`), `link_tab` — вкладка связей (элементы в `links`), `own` — своё место.
 */
export type KitDocPlace = 'own' | 'prop' | 'part' | 'link_tab';

export interface KitDocRelation {
  key: string; label: string; relation: KitRelation; rel: string; dir: 'out' | 'in'; count: number;
  /** Есть ли у сервера путь привязки для этой связи. */
  manageable?: boolean;
  /** Не прислали — вкладка связей. */
  /**
   * Место показа: строкой — одинаково с обеих сторон (как было); объектом {out, in} — по сторонам связи
   * (методика §7.8: «обратная сторона состава у части — строкой во вкладке связей»). Для записи берётся
   * её сторона — `dir`. Не задано — вкладка связей (умолчание прежнее).
   */
  place?: KitDocPlace | { out?: KitDocPlace; in?: KitDocPlace };
  /** Вид записей на другом конце; `any` — любой. */
  target_type?: string;
  /**
   * Свойства ребра с подписями (место на тропе, сторона): во вкладке связей — колонками, значения —
   * из `values` каждой ссылки. Нет — общие колонки, как раньше.
   */
  props?: { key: string; label: string }[];
  /** Привязка требует причины (MDL-13): уходит в KitRelationDef как есть — «Привязать» спросит причину. */
  reasonRequired?: boolean;
}

export interface KitDocLink {
  rel: string; dir: 'out' | 'in'; id: string; type: string; title: string; status: string;
  fromKind?: string; toKind?: string;
  /** Значения колонок таблицы детей. Нет — их не читали (а не «пусто»). */
  values?: Record<string, unknown>;
}

/**
 * Элемент части. `type` — свой вид элемента: часть бывает смешанной (у тропы ON_TRAIL — свитки и квизы,
 * пилот 16.11). Нет — вид части. `values` — значения колонок, в том числе свойства ребра (сторона, t).
 */
export interface KitDocPartItem { id: string; title: string; status: string; type?: string; values?: Record<string, unknown> }

/** Часть записи. `count` — число при `state: 'ok'`, иначе null («не посчитали» ≠ 0). */
export interface KitDocPart {
  key: string; label: string; type?: string; rel: string; dir: 'out' | 'in';
  owned?: boolean; relation?: KitRelation;
  state: 'ok' | 'denied' | 'error'; error?: string;
  count: number | null; items: KitDocPartItem[];
}

export interface KitDocSource {
  block: string; state: 'ok' | 'forbidden' | 'error' | 'truncated';
  code?: number; reason?: string; shown?: number; total?: number;
  /** Кому строка; не назвал источник — техническая. */
  audience?: 'user' | 'tech';
}

/** Документ записи: ответ сервера одной формой (у LORE — lore.record/1). */
export interface KitRecordDoc {
  contract: string;
  record: { type: string; id: string; title: string; status: string; version: string | null; updated_at: string | null; updated_by: string | null };
  schema: {
    type: string; label: string; icon: string; fields: KitDocField[]; tabs: KitDocTab[]; relations: KitDocRelation[];
    /** Подписи общих вкладок по виду связи (методика §7.8: «вкладка связей — одна на группу, подпись группы — из документа»). Нет — подпись kit («Зависимости»). */
    relation_groups?: Partial<Record<KitRelation, string>>;
  };
  values: Record<string, unknown>;
  links: KitDocLink[];
  parts?: KitDocPart[];
  computed?: Record<string, unknown>;
  /**
   * Значения записи ВНЕ модели (D-2026-LORE-FREE-FIELDS-SHOWN, владелица 16.11): не теряются и не
   * прячутся — блок «ключ → значение» в конце свойств с пометкой «не описано в модели», только чтение.
   */
  unmodeled?: Record<string, unknown>;
  perms: { can_edit: boolean; can_status: boolean; can_create: boolean; status_next: string[]; reason: string | null };
  meta: { loaded_at: string; facade: string; sources: KitDocSource[] };
}

export interface PassportFromDocOptions {
  lang: KitLang;
  /**
   * Колонки таблицы детей связи по виду ребёнка (сверх общих) и вид ребёнка с подписями полей.
   * Колонки применяются ТОЛЬКО если элементы связи принесли значения: иначе столбец «—»
   * читался бы как «значения нет», а его не читали.
   */
  childColumns?: (targetKind: string) => { columns: string[]; kind: KindConfig } | undefined;
  /** Вычисляемые поля вида (итоги и т. п.): поле в «Свойства» и значение в запись. */
  extraFields?: (doc: KitRecordDoc) => { field: FieldDef; value: unknown }[];
  /**
   * Колонки таблицы части — по СВЯЗИ, а не по виду ребёнка: свойства ребра (у ON_TRAIL — сторона и t)
   * принадлежат связи. Без них одна запись на двух отрезках выглядела двумя одинаковыми строками
   * (пилот 16.11). Нет — общие колонки списка.
   */
  partColumns?: (part: KitDocPart) => (string | { key: string; label?: string })[] | undefined;
}

export interface PassportFromDoc {
  record: KitRecord;
  data: KitData;
  /** Вид записи и виды детей — их приложение вливает в свой конфиг. */
  kinds: Record<string, KindConfig>;
  /** Права вызывающего на эту запись — роль «читатель» конфига. */
  reader: { canEdit: boolean; canStatus: boolean };
}

/** Общие колонки таблицы связей (как у NestedList): Статус · Вид · Код · Запись. */
export const DOC_NESTED_COLUMNS = ['status', 'kind', 'id', 'title'] as const;
/** Ключ блока «не описано в модели» в полях записи. */
export const UNMODELED_KEY = '_unmodeled';

/**
 * `body_md` — самостоятельный раздел тела, а не копия другого: схема называет его полем группы
 * body, он непуст и не совпадает ни с одним другим полем той же группы.
 */
export function bodyMdIsOwnSection(c: Pick<KitRecordDoc, 'values' | 'schema'>): boolean {
  const body = c.values.body_md;
  if (typeof body !== 'string' || !body.trim()) return false;
  const bodyFields = c.schema.fields.filter(f => f.group === 'body');
  if (!bodyFields.some(f => f.key === 'body_md')) return false;
  return !bodyFields.some(f => f.key !== 'body_md' && c.values[f.key] === body);
}

/** Место связи для ЭТОЙ записи: строка — как есть; объект — сторона записи (`dir`); нет — вкладка связей. */
export function docPlaceOf(r: Pick<KitDocRelation, 'place' | 'dir'>): KitDocPlace {
  if (typeof r.place === 'string') return r.place;
  return r.place?.[r.dir] ?? 'link_tab';
}

export function passportFromDoc(c: KitRecordDoc, opts: PassportFromDocOptions): PassportFromDoc {
  const { lang } = opts;
  const { type, id } = c.record;
  const { title, body_md, ...fields } = c.values;
  const bodyIsOwn = bodyMdIsOwnSection(c);
  if (bodyIsOwn) fields.body_md = body_md;
  const record: KitRecord = {
    id, kind: type, title: typeof title === 'string' && title ? title : id, status: c.record.status,
    body_md: typeof body_md === 'string' && body_md ? body_md : undefined, updated_at: c.record.updated_at ?? undefined, fields,
  };
  // Части — записи и рёбра: дальше с ними работает всё обычное (вкладки, граф, вердикт).
  // Дефект прода v1.17.8: «Задач нет» при 48 задачах — читались только links.
  const parts = c.parts ?? [];
  const kinds = (fromKind?: string, toKind?: string) => ({ ...(fromKind ? { fromKind } : {}), ...(toKind ? { toKind } : {}) });
  const partEdges: KitEdge[] = parts.flatMap(p => p.items.map(i =>
    p.dir === 'in' ? { from: i.id, to: id, type: p.rel, ...kinds(i.type ?? p.type, type) } : { from: id, to: i.id, type: p.rel, ...kinds(type, i.type ?? p.type) }));
  const partRecord = (p: KitDocPart, i: KitDocPartItem): KitRecord => ({
    id: i.id, kind: i.type ?? p.type ?? 'ref', title: i.title || i.id, status: i.status, fields: { ...(i.values ?? {}) },
  });
  const partRecords: KitRecord[] = parts.flatMap(p => p.items.map(i => partRecord(p, i)));
  const edges: KitEdge[] = [
    ...c.links.map(l => ({ ...(l.dir === 'out' ? { from: id, to: l.id, type: l.rel } : { from: l.id, to: id, type: l.rel }),
      ...kinds(l.fromKind, l.toKind), ...(l.values ? { values: l.values } : {}) })),
    ...partEdges,
  ];
  const linkRecords: KitRecord[] = c.links.filter((l, i, a) => a.findIndex(x => x.id === l.id) === i)
    .map(l => ({ id: l.id, kind: l.type, title: l.title, status: l.status, fields: { ...(l.values ?? {}) } }));
  const others: KitRecord[] = [...linkRecords, ...partRecords]
    .filter((r, i, a) => r.id !== id && a.findIndex(x => x.id === r.id) === i);
  // Часть не прочиталась: «нет прав» и «сбой» — разные утверждения, ни одно не «пусто».
  const partErrors = parts.filter(p => p.state !== 'ok').map(p => ({
    block: p.key,
    state: p.state === 'denied' ? ('forbidden' as const) : ('error' as const),
    reason: p.error ?? p.state,
  }));
  // В errors — только сбой и отказ; «обрезано» сказано строкой data_state (MC-07).
  const errors = [
    ...c.meta.sources.filter(s => s.state === 'error' || s.state === 'forbidden').map(s => ({ block: s.block, reason: s.reason ?? s.state })),
    ...partErrors.map(e => ({ block: e.block, reason: e.reason })),
  ];
  const props = c.schema.fields.filter(f => f.group === 'props');
  const extra = opts.extraFields?.(c) ?? [];
  for (const x of extra) record.fields[x.field.key] = x.value;
  // Вне модели — последним полем свойств, только чтение (ключ служебный, с полями модели не совпадёт).
  const unmodeled = c.unmodeled && Object.keys(c.unmodeled).length ? c.unmodeled : null;
  if (unmodeled) record.fields[UNMODELED_KEY] = unmodeled;
  // Связь-свойство без поля в схеме — поле-ссылка: иначе значение не показалось бы вовсе,
  // а в блоке связей стояло бы «Проекты 0».
  const propRels = c.schema.relations.filter(r => docPlaceOf(r) === 'prop' && !props.some(f => f.key === r.key));
  const edgeOf = (key: string) => {
    const r = c.schema.relations.find(x => docPlaceOf(x) === 'prop' && x.key === key && x.manageable);
    return r ? { relation: { rel: r.rel, dir: r.dir } } : {};
  };
  const refKindOf = (key: string) => {
    const t = c.schema.relations.find(x => x.key === key)?.target_type;
    return t && t !== 'any' ? { refKind: t } : {};
  };
  const propFields: FieldDef[] = propRels.map(r => ({ key: r.key, title: r.label, type: 'ref' as const, ...edgeOf(r.key), ...refKindOf(r.key) }));
  // Разделы тела ДАННЫМИ (S5-06): kit рисует их сам — с ✎, черновиком и пустым состоянием.
  // body_md — разделом, только когда это настоящее тело, а не копия (прод v1.17.13).
  const sections = c.schema.fields.filter(f => f.group === 'body' && (f.key !== 'body_md' || bodyIsOwn));
  const bodySections = sections.map(s => ({ key: s.key, title: s.label, editable: s.editable !== false }));
  // Связи, которые рисует сам kit (по видам UML); своей вкладки на тот же ключ не отдаём.
  const kitRels = c.schema.relations.filter(r => docPlaceOf(r) === 'link_tab');
  const kitRelKeys = new Set(kitRels.map(r => r.key));
  const noLinks = kitT(lang, 'kit.record.links.empty');
  const linkTabs = c.schema.tabs.filter(t => t.zone === 'record' && t.rel).map(t => ({
    key: t.key, title: t.label,
    render: () => c.links.filter(l => l.rel === t.rel && l.dir === t.dir).map(l => l.title).join(' · ') || noLinks,
  }));
  // Тело части — список kit (поиск, фасеты, группировка); итог больше пришедшего — оговорка.
  const partShown = (p: KitDocPart): string | undefined =>
    typeof p.count === 'number' && p.count > p.items.length
      ? kitT(lang, 'kit.record.part.shown', { shown: p.items.length, total: p.count })
      : undefined;
  const partBody = (p: KitDocPart, ctx: KitCtx): ReactNode => {
    if (p.items.length === 0) return noLinks;
    // Колонки по связи: ключ и подпись приложения (подписи — list.fieldLabels, K4-FACET-LABELS: поля вне вида).
    const extra = opts.partColumns?.(p)?.map(c => (typeof c === 'string' ? { key: c } : c));
    const labels = Object.fromEntries((extra ?? []).filter(c => c.label).map(c => [c.key, c.label!]));
    return createElement(NestedList, {
      ctx, records: p.items.map(i => partRecord(p, i)), note: partShown(p),
      ...(extra ? { columns: [...DOC_NESTED_COLUMNS, ...extra.map(c => c.key)] } : {}),
      ...(Object.keys(labels).length ? { fieldLabels: labels } : {}),
    });
  };
  const partTabs = parts.map(p => ({
    key: p.key, title: p.label,
    // Счёт в ряд вкладок (B13): null — «не смогли посчитать», а не ноль.
    count: p.count,
    render: (_r: KitRecord, ctx: KitCtx) => (p.state !== 'ok' ? (p.error ?? p.state) : partBody(p, ctx)),
  }));
  // Один раздел — одно место (B13): вкладку связи отдаёт kit, приложение — только части и прочее.
  const tabs = [...partTabs, ...linkTabs.filter(t => !partTabs.some(x => x.key === t.key) && !kitRelKeys.has(t.key))];
  const childKinds: Record<string, KindConfig> = {};
  const childColumnsOf = (r: KitDocRelation): { columns?: string[] } => {
    const target = r.target_type;
    if (!target || !opts.childColumns) return {};
    const spec = opts.childColumns(target);
    if (!spec) return {};
    const carries = c.links.some(l => l.rel === r.rel && l.dir === r.dir && l.type === target && l.values);
    if (!carries) return {};
    if (target !== type) childKinds[target] = spec.kind;
    return { columns: [...DOC_NESTED_COLUMNS, ...spec.columns] };
  };
  const relDefs: KitRelationDef[] = kitRels.map(r => {
    const { count: _n, place: _p, target_type: t, props: rp, ...d } = r;
    // §7.8 шаг 1: явное место стороны побеждает OWN_TAB — только при объектной форме {out, in};
    // строка и «не задано» — как раньше (LORE не меняется).
    const sideShared = typeof r.place === 'object' && r.place !== null && docPlaceOf(r) === 'link_tab'
      && (r.relation === 'composition' || r.relation === 'aggregation');
    // Свойства ребра — колонками после колонок вида ребёнка (или общих), подписи — из props.
    const child = childColumnsOf(r);
    const propCols = rp?.length ? {
      columns: [...(child.columns ?? DOC_NESTED_COLUMNS), ...rp.map(x => `fields.${x.key}`)],
      fieldLabels: Object.fromEntries(rp.map(x => [`fields.${x.key}`, x.label])),
    } : child;
    return { ...d, ...(t && t !== 'any' ? { targetKind: t } : {}), ...propCols, ...(sideShared ? { shared: true } : {}) };
  });
  const kind: KindConfig = {
    title: c.schema.label, icon: c.schema.icon,
    ...(bodySections.length ? { bodySections } : {}),
    relations: relDefs,
    ...(c.schema.relation_groups ? { relationGroups: c.schema.relation_groups } : {}),
    fields: [
      ...props.map(f => ({
        key: f.key, title: f.label, type: f.kind, ...(f.section ? { section: f.section } : {}),
        // Правимо только при ОБОИХ: поле названо правимым И у него есть путь записи.
        ...(f.editable && f.write ? { editable: true } : {}),
        ...(f.required ? { required: 'block' as const } : {}),
        ...(f.kind === 'ref' ? { ...edgeOf(f.key), ...refKindOf(f.key) } : {}),
        ...(f.kind === 'kv' && f.keys?.length ? { keyLabels: Object.fromEntries(f.keys.map(k => [k.key, k.label])) } : {}),
        ...(f.definition || f.description ? { hint: { ...(f.definition ? { definition: f.definition } : {}), ...(f.description ? { description: f.description } : {}) } } : {}),
      })),
      ...propFields,
      ...extra.map(x => x.field),
      ...(unmodeled ? [{ key: UNMODELED_KEY, title: kitT(lang, 'kit.record.unmodeled'), type: 'kv' as const }] : []),
    ],
    ...(tabs.length ? { tabs } : {}),
  };
  // Состояние блоков — формой dataStateOf: «нет прав», «обрезано» и сбой — разные ответы.
  // Строки — имена источников; не назвал адресата источник — техническая (S4-TECH-NOTES).
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
  return { record, data, kinds: { ...childKinds, [type]: kind }, reader: { canEdit: c.perms.can_edit, canStatus: c.perms.can_status } };
}
