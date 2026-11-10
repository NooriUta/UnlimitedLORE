// Модель вкладки «История» записи (SPRINT_UXR_S5_RECORD_TASKS/S5-11).
//
// Формы повторяют контракт S2 «история SCD2» (SPEC-LORE-UXR-S2-CONTRACTS,
// GET /lore/history, web-next/src/api/contracts/s2.ts → HistoryResponse):
// версии новейшей первой, у каждой — снимок полей и автор (человек / агент /
// unknown — старые версии без авторства честно unknown). Контракт ядра
// (core/contract.ts) не трогаем: история — отдельный необязательный источник
// записи, его приносит экран (RecordView.history).
//
// Возврат версии — НЕ «откат» SCD2: это новая версия с полями старой, которую
// пишет существующий write-API приложения (onRestore). Поэтому план возврата —
// только поля, которые этот API умеет писать (restorable), и только отличные
// от текущей версии.

export type KitHistoryAuthor =
  | { kind: 'human'; kc_sub: string; display_name: string | null }
  | { kind: 'agent'; client_id: string; actor_id: string | null; session_id: string | null; owner_kc_sub: string | null }
  | { kind: 'unknown' };

/**
 * Свёрнутая серия подряд идущих правок одного агента (S9-09, `collapse=agent`).
 * Строка серии несёт ПОСЛЕДНЮЮ версию серии, а здесь — сколько правок в ней
 * было и с какой версии она началась. Одиночная правка агента серией не
 * считается и сюда не попадает.
 */
export interface KitHistoryRun {
  count: number;
  first_state_uid: string | null;
  first_valid_from: string | null;
}

export interface KitHistoryVersion {
  state_uid: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_open: boolean;
  status: string | null;
  /** Снимок полей версии без служебных (@rid, valid_*, state_uid). */
  fields: Record<string, unknown>;
  /** Поля, отличные от предыдущей (более старой) версии; у первой — все. */
  changed: string[];
  author: KitHistoryAuthor;
  /**
   * Серия свёрнутых правок, последней версией которой является эта строка.
   * Нет — строка не свёрнута (в том числе одиночная правка агента).
   */
  collapsed?: KitHistoryRun | null;
}

/**
 * Счёт страницы. `total` и `has_more` сервер считает по тем же строкам, что
 * прислал: со свёрткой — по свёрнутым. Поэтому «показано N из M» говорит о том
 * же, что человек видит, а не о сырых версиях.
 *
 * `author` и `collapse` — ЭХО сервера: что он действительно применил. Эха нет
 * (сервер старее) — это «не сказал», а не «не применил».
 */
export interface KitHistoryPage {
  limit: number | null;
  offset: number;
  total: number;
  has_more: boolean;
  author?: string | null;
  collapse?: 'agent' | null;
}

/** Что именно спрашивает вкладка. Всюду «null / false» = без сужения. */
export interface KitHistoryQuery {
  /** Вид автора: правки человека или агента. */
  authorKind: 'human' | 'agent' | null;
  /** Конкретный автор — его идентификатор вызывающего (kc_sub / client_id). */
  author: string | null;
  /** Свернуть подряд идущие правки одного агента в одну строку. */
  collapse: boolean;
  /** Только смены статуса или только правки содержимого. */
  field: 'status' | 'content' | null;
}

export const HISTORY_QUERY_ALL: KitHistoryQuery = { authorKind: null, author: null, collapse: false, field: null };

/**
 * Сужает ли запрос выдачу. Свёртка НЕ сужает: правки те же, строк меньше.
 * Нужно для честной пустоты: «ничего не нашлось по фильтру» ≠ «истории нет».
 */
export function narrowed(q: KitHistoryQuery | null | undefined): boolean {
  return Boolean(q && (q.authorKind !== null || q.author !== null || q.field !== null));
}

/**
 * Свёрнут ли вид. Эхо сервера главнее запроса экрана: показываем то, что он
 * сделал. Эха нет — верим запросу, но ничего не выдумываем (нет `page` вовсе —
 * «сервер про страницы не сказал», и свёрнутым вид не считается).
 */
export function collapsedView(page: KitHistoryPage | null, q?: KitHistoryQuery | null): boolean {
  if (page && page.collapse !== undefined) return page.collapse === 'agent';
  return Boolean(q?.collapse);
}

export interface KitHistory {
  /** not_tracked — у типа нет цепочки SCD2: «история не ведётся», а не «правок не было». */
  tracking: 'scd2' | 'not_tracked';
  /** Новейшая первой. */
  versions: KitHistoryVersion[];
  /** Аномалии цепочки от сервера (multiple_open_versions…) — показываются как есть. */
  anomalies: string[];
  page: KitHistoryPage | null;
  /** Предупреждения источника (уже словами) — показываются как есть. */
  warnings: string[];
}

export interface KitFieldDiff {
  field: string;
  from: unknown;
  to: unknown;
  change: 'added' | 'removed' | 'changed';
}

export interface KitRestoreRequest {
  record_id: string;
  /** Версия, поля которой возвращаются. */
  version: KitHistoryVersion;
  /** Что запишется: from — текущее значение, to — значение из версии. */
  changes: KitFieldDiff[];
}

const isEmpty = (v: unknown) => v === null || v === undefined;
const norm = (v: unknown) => JSON.stringify(isEmpty(v) ? null : v);

/** Пополевая разница older → newer; пусто (null/undefined/нет ключа) — одно значение. По алфавиту. */
export function diffVersions(older: Record<string, unknown> | null, newer: Record<string, unknown>): KitFieldDiff[] {
  const prev = older ?? {};
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(newer)])].sort();
  const out: KitFieldDiff[] = [];
  for (const field of keys) {
    const from = isEmpty(prev[field]) ? null : prev[field];
    const to = isEmpty(newer[field]) ? null : newer[field];
    if (norm(from) === norm(to)) continue;
    out.push({ field, from, to, change: from === null ? 'added' : to === null ? 'removed' : 'changed' });
  }
  return out;
}

export type KitAuthorView =
  | { kind: 'human'; name: string }
  | { kind: 'agent'; name: string; owner: string | null }
  | { kind: 'unknown'; name: null };

/** Автор словами: человек — имя (иначе kc_sub), агент — client_id и владелец. */
export function historyAuthor(a: KitHistoryAuthor): KitAuthorView {
  if (a.kind === 'human') return { kind: 'human', name: a.display_name || a.kc_sub };
  if (a.kind === 'agent') return { kind: 'agent', name: a.client_id, owner: a.owner_kc_sub };
  return { kind: 'unknown', name: null };
}

/** Автор как ВЫБОР в фильтре: кто правил и сколько правок за ним. */
export interface KitHistoryAuthorOption {
  kind: 'human' | 'agent';
  /** Идентификатор вызывающего — им же фильтрует сервер (`author=`). */
  caller: string;
  count: number;
}

/** Идентификатор автора правки; у «автор неизвестен» его нет — фильтровать нечем. */
export function authorCaller(a: KitHistoryAuthor): string | null {
  if (a.kind === 'human') return a.kc_sub || null;
  if (a.kind === 'agent') return a.client_id || null;
  return null;
}

/**
 * Авторы ЗАГРУЖЕННЫХ версий — варианты для фильтра. Свёрнутая серия весит
 * столько правок, сколько в ней было (`collapsed.count`), а не одну строку:
 * иначе число рядом с автором врало бы о его вкладе.
 *
 * Это авторы загруженного, а не всей истории: дальше в цепочке могут быть
 * другие, и вкладка говорит об этом словами.
 */
export function authorOptions(versions: readonly KitHistoryVersion[]): KitHistoryAuthorOption[] {
  const by = new Map<string, KitHistoryAuthorOption>();
  for (const v of versions) {
    const kind = v.author.kind;
    const caller = authorCaller(v.author);
    if (caller === null || (kind !== 'human' && kind !== 'agent')) continue;
    const count = v.collapsed ? v.collapsed.count : 1;
    const seen = by.get(caller);
    if (seen) seen.count += count;
    else by.set(caller, { kind, caller, count });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.caller.localeCompare(b.caller));
}

/**
 * Объединить уже известных авторов с авторами новой выдачи. Нужно, чтобы
 * выбранный фильтр не съедал остальные варианты: выдача сузилась до одного
 * автора — и переключиться на другого стало бы нечем.
 */
export function mergeAuthorOptions(
  known: readonly KitHistoryAuthorOption[],
  fresh: readonly KitHistoryAuthorOption[],
): KitHistoryAuthorOption[] {
  const by = new Map(known.map(o => [o.caller, { ...o }]));
  for (const o of fresh) {
    const seen = by.get(o.caller);
    // Число — наибольшее из виденных: сузив выдачу, мы видим МЕНЬШЕ правок
    // автора, а не меньше его вклад.
    if (seen) { seen.count = Math.max(seen.count, o.count); seen.kind = o.kind; }
    else by.set(o.caller, { ...o });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.caller.localeCompare(b.caller));
}

/** Устойчивый ключ версии: state_uid, без него — valid_from и позиция в списке. */
export function versionKey(v: KitHistoryVersion, index: number): string {
  return v.state_uid ?? `${v.valid_from ?? 'none'}#${index}`;
}

/** Текущая версия: открытая, а если открытой нет (аномалия) — новейшая. */
export function currentVersion(versions: readonly KitHistoryVersion[]): KitHistoryVersion | undefined {
  return versions.find(v => v.is_open) ?? versions[0];
}

/** С чем сравнивать по умолчанию: со следующей более старой версией; у первой — null. */
export function compareBase(versions: readonly KitHistoryVersion[], key: string): string | null {
  const i = versions.findIndex((v, idx) => versionKey(v, idx) === key);
  if (i < 0 || i + 1 >= versions.length) return null;
  return versionKey(versions[i + 1], i + 1);
}

/** План возврата target как новой версии поверх current: только restorable и только отличные. */
export function restoreChanges(
  target: KitHistoryVersion,
  current: KitHistoryVersion,
  restorable: readonly string[],
): KitFieldDiff[] {
  const pick = (f: Record<string, unknown>) => Object.fromEntries(restorable.map(k => [k, f[k]]));
  return diffVersions(pick(current.fields), pick(target.fields));
}
