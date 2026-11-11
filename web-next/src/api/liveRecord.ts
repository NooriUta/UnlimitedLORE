// Боевой паспорт записи: GET /lore/record → LoreRecord1
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-PASSPORT-LIST, ADR-LORE-048 п. 5).
//
// До сих пор паспорт ЭМУЛИРОВАЛСЯ на клиенте из срезов (`toLoreRecord`), и в
// эмуляции не было того, чего в срезах нет: версии записи, настоящих прав,
// состояния блоков. Фасад это отдаёт, поэтому переход — подмена источника, а
// не переписывание разметки: `fromLoreRecord` (объект → kit) остаётся как был.
//
// **Почему здесь целый слой перевода, а не `await res.json()`.** Клиентский
// тип `LoreRecord1` писался до фасада, и сервер расходится с ним не формой, а
// именами и вложенностью. Сверено по коду бэкенда (LoreRecordResource.envelope,
// LoreRecordRegistry.schemaJson, LoreRecordDataState):
//
//   клиентский LoreRecord1        сервер /lore/record
//   record.version: число         СТРОКА — valid_from открытого состояния
//   meta.loaded_at                нет: сервер не говорит, когда он прочитал
//   meta.sources: массив          meta.sources = {block: [...]} + meta.data_state
//   schema.tabs                   нет: вкладки — поведение (ADR-LORE-048)
//   schema.relations[].count      нет: считается из links
//   facts.tasks {done,total}      {done,total,open}
//
// Урок, из которого этот слой и вырос: `record/backlinksGraph.ts` объявил себя
// заглушкой, но транспорт уже был живой, и разбор шёл по несуществующему
// контракту — узлы графа получали `undefined` вместо кодов. Поэтому тут
// перевод по снятой с кода форме, а тесты — против ответов сервера.
//
// Честные состояния: «не найдено», «нет прав» и «сервер сломался» — разные
// ответы человеку, и каждый отказывает своим типом, а не пустым паспортом.
import { loreFetch } from '../auth/session';
import type { FieldKind, LoreField, LoreLink, LorePart, LorePlace, LoreRecord1, LoreRelation, LoreSource, LoreTab } from '../record/loreRecordContract';
import type { KitRelation } from '@seidr/kit';

type Json = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Json[] : []);

/**
 * Ключ записи в путь запроса: слэш остаётся живым, остальное кодируется.
 *
 * Два факта, оба проверены по коду, а не предположены:
 *
 *  1. **Слэш кодировать НЕЛЬЗЯ.** Шаблон пути фасада — `{type}/{id: .+}`, то
 *     есть жадный, и именно поэтому паспорт задачи с ключом
 *     `SPRINT_X/CO-11` работает со слэшем в открытом виде. Перевод на `%2F`
 *     сломал бы то, что уже работает.
 *  2. **Решётку кодировать НАДО.** Ключ релиза — `release_uid` вида
 *     `NooriUta/UnlimitedLORE#v1.17.4`. Браузер режет «#» как якорь и не
 *     отправляет хвост, то есть сервер получил бы
 *     `/lore/record/release/NooriUta/UnlimitedLORE` — ВАЛИДНЫЙ путь к другому
 *     ключу. Это худший вид поломки: не ошибка, а тихая подмена записи.
 *
 * Отсюда кодирование ПО СЕГМЕНТАМ: `encodeURIComponent` каждому куску между
 * слэшами. Для обычных ключов (`S4-09`, `ADR-LORE-049`) это тождество.
 */
export function recordPath(id: string): string {
  return id.split('/').map(encodeURIComponent).join('/');
}

/** Записи нет (404). Отдельно от «нет прав»: тут нечего ждать и не у кого просить. */
export class RecordNotFound extends Error {
  constructor(readonly type: string, readonly id: string, detail: string) {
    super(detail || `${type} «${id}» не найден`);
    this.name = 'RecordNotFound';
  }
}

/** Нет прав / проектный скоуп (403). Запись может существовать — её не показывают. */
export class RecordForbidden extends Error {
  constructor(readonly type: string, readonly id: string, detail: string) {
    super(detail || 'нет прав на эту запись');
    this.name = 'RecordForbidden';
  }
}

/** Остальные отказы: сервер сломался, фасад выключен, форма ответа не та. */
export class RecordFetchError extends Error {
  constructor(readonly status: number, readonly code: string, detail: string) {
    super(detail || `сервер ответил ${status}${code ? ` (${code})` : ''}`);
    this.name = 'RecordFetchError';
  }
}

/**
 * Ответ пришёл с кодом 200, но это не паспорт.
 *
 * Поймано прогоном тестов 09.11: подставная сеть ответила телом СРЕЗА, разбор
 * прошёл «успешно» и дал запись с пустым типом и пустым кодом — паспорт
 * нарисовался пустым. На живом сервере то же даст любой 200 не того вида:
 * прокси с html-страницей, старая версия приложения, чужой эндпоинт.
 *
 * Пустой паспорт неотличим от записи без полей, поэтому разбирать «что дали»
 * нельзя: отказ по имени, и вызывающий решает, откатиться ему на эмуляцию или
 * показать ошибку.
 */
export class RecordShape extends Error {
  constructor(detail: string) {
    super(`ответ не похож на паспорт: ${detail}`);
    this.name = 'RecordShape';
  }
}

/**
 * Типы, у которых ОДНО поле группы `body` становится телом записи.
 *
 * Те же три, что умеет сохранять `passportSave` через `body_md`. ADR сюда не
 * входит: его тело склеено из трёх разделов, и одним полем его не сохранить,
 * не затерев соседние.
 */
const BODY_AS_RECORD: readonly string[] = ['sprint', 'task', 'spec'];

/** Виды поля паспорта; незнакомый вид показываем текстом, а не прячем поле. */
const KINDS: readonly FieldKind[] = ['text', 'md', 'enum', 'ref', 'date', 'number'];
const kindOf = (v: unknown): FieldKind => (KINDS as readonly string[]).includes(str(v)) ? (str(v) as FieldKind) : 'text';

/** Группа поля: голова, тело, свойства. Незнакомая — в свойства: потерять поле хуже. */
const groupOf = (v: unknown): LoreField['group'] => {
  const g = str(v);
  return g === 'head' || g === 'body' ? g : 'props';
};

/**
 * Вид связи по UML (D-2026-LORE-RECORD-RELATION-UML). Незнакомое слово —
 * 'association': рисуем самым слабым утверждением, а не выдумываем сильное.
 */
const RELATIONS: readonly string[] = ['composition', 'aggregation', 'association', 'attribute', 'realization', 'generalization'];
const relationOf = (v: unknown): KitRelation =>
  (RELATIONS.includes(str(v)) ? str(v) : 'association') as KitRelation;

/**
 * Состояния блоков: `meta.data_state` сервера → `meta.sources` контракта.
 *
 * Имя блока склеивается из `source` и `part` тем же правилом, что разбирает
 * kit («источник · часть»): так в блоке «Состояние данных» видно не только
 * ЧТО не прочиталось, но и ОТКУДА это читали.
 *
 * Незнакомое состояние попадает в «не смогли проверить» вместе со своим
 * словом. Пропустить его значило бы показать блок исправным, ничего о нём не
 * зная.
 */
export function sourcesFromServer(dataState: unknown): LoreSource[] {
  return arr(dataState).map(row => {
    const source = str(row.source) || str(row.block);
    const part = str(row.part);
    const block = part ? `${source} · ${part}` : source;
    const state = str(row.state);
    const reason = strOrNull(row.reason);
    const known = state === 'ok' || state === 'error' || state === 'truncated' || state === 'forbidden';
    const out: LoreSource = {
      block,
      state: known ? (state as LoreSource['state']) : 'error',
      ...(known
        ? (reason ? { reason } : {})
        : { reason: `состояние «${state}» неизвестно${reason ? ` — ${reason}` : ''}` }),
    };
    const shown = num(row.shown);
    const total = num(row.total);
    if (shown !== undefined) out.shown = shown;
    if (total !== undefined) out.total = total;
    // S4-TECH-NOTES: тег адресата, если его поставил сервер; иначе решит fromLoreRecord.
    const audience = str(row.audience);
    if (audience === 'user' || audience === 'tech') out.audience = audience;
    return out;
  });
}

/**
 * Вкладки записи строит КЛИЕНТ, по `relations[].place === 'link_tab'`.
 *
 * Вкладок в модели нет и не будет: по ADR-LORE-048 это поведение приложения,
 * а не данные (`assertDataOnly` их в модель не пустит). Сервер говорит
 * «у этой связи место — вкладка», решение «нарисовать вкладку» — наше.
 */
/**
 * Место связи, как его называет сервер: own · prop · part · link_tab.
 *
 * Неизвестное слово — НЕ повод угадывать: считаем вкладкой связей, потому что
 * так вело себя приложение до появления `place`, и это поведение видно
 * человеку (вкладка с элементами), а не прячет данные.
 */
function placeOf(v: unknown): LorePlace | undefined {
  const s = str(v);
  return s === 'own' || s === 'prop' || s === 'part' || s === 'link_tab' ? s : undefined;
}

/**
 * Части записи: `parts[]` фасада (LoreRecordRegistry.partJson).
 *
 * Дефект прода v1.17.8: паспорт спринта писал «Задач нет» при 48 задачах —
 * задачи и фазы приходят ИМЕННО ЗДЕСЬ, а слой перевода их молча терял.
 *
 * `state` у части — ровно три значения (сверено по коду сервера): ok · denied
 * (нет разрешённых проектов) · error (сбой среза). Чужое слово в `state`
 * становится 'error' с названной причиной: «состояние неизвестно» — это не
 * «всё хорошо». `count` при не-ok — null: «не посчитали» ≠ ноль.
 */
function partsOf(v: unknown): LorePart[] {
  return arr(v).map(row => {
    const raw = str(row.state) || 'ok';
    const state: LorePart['state'] = raw === 'ok' || raw === 'denied' || raw === 'error' ? raw : 'error';
    const error = strOrNull(row.error);
    const items = arr(row.items).map(i => ({
      id: str(i.id), title: str(i.title) || str(i.id), status: str(i.status),
      ...(i.values && typeof i.values === 'object' && !Array.isArray(i.values) ? { values: i.values as Record<string, unknown> } : {}),
    })).filter(i => i.id);
    const type = str(row.type);
    const count = num(row.count);
    return {
      key: str(row.key), label: str(row.label) || str(row.key),
      ...(type ? { type } : {}),
      rel: str(row.rel), dir: str(row.dir) === 'in' ? ('in' as const) : ('out' as const),
      ...(row.owned === true ? { owned: true } : {}),
      ...(row.relation ? { relation: relationOf(row.relation) } : {}),
      state,
      ...(state === 'ok'
        ? {}
        : { error: error ?? (raw === state ? state : `состояние «${raw}» неизвестно`) }),
      count: state === 'ok' ? (count ?? items.length) : null,
      items,
    };
  }).filter(p => p.key);
}

function tabsOf(relations: Json[]): LoreTab[] {
  return relations
    .filter(r => str(r.place) === 'link_tab')
    .map(r => ({
      key: str(r.key), label: str(r.label), zone: 'record' as const,
      rel: str(r.rel), dir: str(r.dir) === 'in' ? ('in' as const) : ('out' as const),
    }));
}

/** Разбор ответа фасада. `loadedAt` — время КЛИЕНТА: сервер о нём не говорит. */
export function recordFromServer(body: unknown, loadedAt: string): LoreRecord1 {
  const b = obj(body);
  const rec = obj(b.record);
  // Проверка вида ответа — до разбора: см. RecordShape.
  if (str(b.contract) !== 'lore.record/1')
    throw new RecordShape(`contract = ${JSON.stringify(b.contract) ?? 'нет'}`);
  if (!str(rec.id) || !str(rec.type))
    throw new RecordShape('в ответе нет record.id или record.type');
  const schema = obj(b.schema);
  const perms = obj(b.perms);
  const facts = obj(b.facts);
  const meta = obj(b.meta);

  const links: LoreLink[] = arr(b.links).map(l => ({
    rel: str(l.rel), dir: str(l.dir) === 'in' ? 'in' : 'out', id: str(l.id),
    type: str(l.type), title: str(l.title) || str(l.id), status: str(l.status),
  }));

  const writeOf = (w: unknown): { endpoint: string; field: string } | null => {
    const o = w && typeof w === 'object' ? (w as Record<string, unknown>) : null;
    return o && str(o.endpoint) && str(o.field) ? { endpoint: str(o.endpoint), field: str(o.field) } : null;
  };
  const fields: LoreField[] = arr(schema.fields).map(f => {
    const section = str(f.section);
    return {
      key: str(f.key),
      // Подпись — label; label_key только подсказка, человеку ключ не показывают.
      label: str(f.label) || str(f.key),
      kind: kindOf(f.kind),
      required: f.required === true,
      editable: f.editable === true,
      ...(f.multi === true ? { multi: true } : {}),
      group: groupOf(f.group),
      // S4-24: путь записи поля и справочник вариантов — из схемы сервера. Без
      // write правка поля обещала бы сохранение, которого некуда отправить.
      ...(writeOf(f.write) ? { write: writeOf(f.write) } : { write: null }),
      ...(str(f.dict) ? { dict: str(f.dict) } : {}),
      ...(section ? { section } : {}),
    };
  });

  const parts = partsOf(b.parts);
  const relRows = arr(schema.relations);
  const relations: LoreRelation[] = relRows.map(r => {
    const rel = str(r.rel);
    const dir = str(r.dir) === 'in' ? ('in' as const) : ('out' as const);
    // Одно ребро делят несколько связей типа (у компонента BELONGS_TO:in — ADR, спринты,
    // решения…): считаем только связи своего типа цели, иначе «ADR 40» насчитал бы и спринты.
    const target = str(r.target_type);
    const ofTarget = (l: LoreLink) => !target || target === 'any' || l.type === target;
    return {
      key: str(r.key), label: str(r.label) || str(r.key),
      relation: relationOf(r.relation), rel, dir,
      // Счётчик сервер не присылает. У части число знает сама часть (её
      // элементы в links не приходят, и пересчёт давал бы 0); у остальных —
      // считаем по пришедшим связям.
      count: parts.find(x => x.key === str(r.key))?.count
        ?? links.filter(l => l.rel === rel && l.dir === dir && ofTarget(l)).length,
      // Есть ли путь привязки — знает только сервер (LoreRecordRelationRoutes).
      // Нет признака — это «нет пути», а не «решайте сами»: иначе человек
      // введёт код и получит UNKNOWN_RELATION.
      manageable: r.manageable === true,
      // Место связи нужно донести: по нему решают, что это — свойство
      // (значения в values), часть (элементы в parts) или вкладка связей.
      // Потеря этого слова и давала «Проекты 0» рядом с живым значением.
      ...(placeOf(r.place) ? { place: placeOf(r.place)! } : {}),
      ...(str(r.target_type) ? { target_type: str(r.target_type) } : {}),
    };
  });

  const tasks = obj(facts.tasks);
  const done = num(tasks.done);
  const total = num(tasks.total);
  const open = num(tasks.open);
  const factsOut: LoreRecord1['facts'] =
    // «open» сервер считает сам (и это не всегда total − done: отменённые
    // задачи в total не входят). Пришло — несём как есть.
    done !== undefined && total !== undefined ? { tasks: { done, total, ...(open !== undefined ? { open } : {}) } }
      : typeof facts.adrs_error === 'string' ? { tasks: { error: facts.adrs_error } }
        : null;

  // Тело записи (регрессия моего же перехода на фасад, поймана тестом 09.11).
  //
  // Эмуляция из срезов укладывала текст в `body_md`: у спринта — `context_md`,
  // у задачи — `note_md`, у спеки — `content_md`. `fromLoreRecord` правит
  // только `body_md`, остальные поля группы `body` рисует разделами ТОЛЬКО ДЛЯ
  // ЧТЕНИЯ. Фасад называет поля своими именами — и правка текста на месте
  // пропала: кнопки ✎ у спринта, задачи и спеки не стало.
  //
  // Поэтому первое ПРАВИМОЕ поле группы `body` становится телом записи, как и
  // было. Путь записи при этом прежний: `payload()` в `passportSave` переводит
  // `body_md` в нужное имя по типу. Остальные поля группы (у спринта — «Итог»)
  // остаются разделами.
  //
  // У ADR — намеренно иначе: его тело склеено из трёх разделов, и одним полем
  // его не сохранить, не затерев соседние (ADR_BODY_READONLY). Там тела записи
  // не появляется.
  const values = obj(b.values);
  let fieldsOut = fields;
  if (BODY_AS_RECORD.includes(str(rec.type)) && values.body_md === undefined) {
    const primary = fields.find(f => f.group === 'body' && f.editable);
    if (primary) {
      values.body_md = values[primary.key];
      fieldsOut = fields.filter(f => f.key !== primary.key);
    }
  }

  return {
    contract: 'lore.record/1',
    record: {
      type: str(rec.type), id: str(rec.id), title: str(rec.title) || str(rec.id), status: str(rec.status),
      // Версия сервера — СТРОКА (valid_from открытого состояния), не число.
      version: strOrNull(rec.version),
      updated_at: strOrNull(rec.updated_at), updated_by: strOrNull(rec.updated_by),
    },
    schema: {
      type: str(schema.type), label: str(schema.label) || str(schema.type), icon: str(schema.icon),
      fields: fieldsOut, tabs: tabsOf(relRows), relations,
    },
    values,
    links,
    ...(parts.length ? { parts } : {}),
    // Итоги, посчитанные сервером (S4-09): у спринта — та же функция, что у
    // среза sprint_totals. Блока нет — пустой объект: «сервер не прислал»
    // скажет разбор, а не молчаливое отсутствие полей.
    computed: obj(b.computed),
    facts: factsOut,
    perms: {
      can_edit: perms.can_edit === true, can_status: perms.can_status === true, can_create: perms.can_create === true,
      status_next: Array.isArray(perms.status_next) ? perms.status_next.map(String) : [],
      reason: strOrNull(perms.reason),
    },
    meta: {
      loaded_at: loadedAt,
      // Сервер сам говорит, что он фасад; подменять это словом клиента нельзя.
      facade: str(meta.facade) === 'server' ? 'server' : 'client-emulated',
      sources: sourcesFromServer(meta.data_state),
    },
  };
}

export interface FetchRecordOptions {
  /** Подмена сети (тесты); по умолчанию — fetch с токеном сеанса. */
  fetchImpl?: typeof fetch;
  /** Префикс API; по умолчанию относительный, как у остальных вызовов v2. */
  base?: string;
  /** Часы для `meta.loaded_at` (тесты). */
  now?: () => string;
}

/**
 * Паспорт записи с сервера.
 *
 * Код записи в адрес НЕ кодируется: сервер принимает `{id: .+}`, и у задачи
 * код — «спринт/код». Экранировать дробь значило бы потерять половину кода.
 */
export async function fetchLoreRecord(type: string, id: string, opts: FetchRecordOptions = {}): Promise<LoreRecord1> {
  const http = opts.fetchImpl ?? loreFetch;
  const base = opts.base ?? '';
  const now = opts.now ?? (() => new Date().toISOString());
  const res = await http(`${base}/lore/record/${type}/${recordPath(id)}`);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const e = obj(body);
    const code = str(e.error);
    const detail = str(e.detail) || str(e.message);
    if (res.status === 404) throw new RecordNotFound(type, id, detail);
    if (res.status === 403) throw new RecordForbidden(type, id, detail);
    throw new RecordFetchError(res.status, code, detail);
  }
  return recordFromServer(body, now());
}
