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
import type { FieldKind, LoreField, LoreLink, LoreRecord1, LoreRelation, LoreSource, LoreTab } from '../record/loreRecordContract';
import type { KitRelation } from '@seidr/kit';

type Json = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Json[] : []);

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
const RELATIONS: readonly string[] = ['aggregation', 'composition', 'dependency', 'association', 'generalization'];
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
      ...(section ? { section } : {}),
    };
  });

  const relRows = arr(schema.relations);
  const relations: LoreRelation[] = relRows.map(r => {
    const rel = str(r.rel);
    const dir = str(r.dir) === 'in' ? ('in' as const) : ('out' as const);
    return {
      key: str(r.key), label: str(r.label) || str(r.key),
      relation: relationOf(r.relation), rel, dir,
      // Счётчик сервер не присылает — считаем по тем связям, что пришли.
      count: links.filter(l => l.rel === rel && l.dir === dir).length,
    };
  });

  const tasks = obj(facts.tasks);
  const done = num(tasks.done);
  const total = num(tasks.total);
  const factsOut: LoreRecord1['facts'] =
    done !== undefined && total !== undefined ? { tasks: { done, total } }
      : typeof facts.adrs_error === 'string' ? { tasks: { error: facts.adrs_error } }
        : null;

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
      fields, tabs: tabsOf(relRows), relations,
    },
    values: obj(b.values),
    links,
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
  const res = await http(`${base}/lore/record/${type}/${id}`);
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
