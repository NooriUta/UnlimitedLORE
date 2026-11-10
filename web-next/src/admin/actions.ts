// Журнал действий админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-02, пачка — S7B-13).
//
// Источник один: GET /lore/admin/actions — тот же ряд AO-01 (metric='lore.action'),
// что у среза admin_actions, только админские семейства. Второго журнала нет,
// поэтому и клиент читает ровно этот эндпоинт: срез периодом не фильтруется
// (ts — LONG, параметры среза строковые) и о полноте выдачи не рассказывает.
//
// Главное здесь — РАЗЛИЧЕНИЕ исходов, которые легко выдать друг за друга:
//   • total_state=unknown (total=null) — «сколько всего, мы не знаем». Это НЕ
//     ноль и НЕ «показано всё»: цифре, которой сервер не верит, не верим и мы,
//     даже если она пришла (count под нехваткой heap недосчитывает — AO-01);
//   • truncated=true — выдача обрезана пределом: записей больше, чем видно;
//   • status ≥ 400 в строке — зафиксированный ОТКАЗ действия, не успех;
//     status не пришёл — исход не записан, тоже не успех;
//   • 403 — нет прав, а не пустой журнал;
//   • 0 строк под фильтром — «по фильтру ничего», а не «журнал пуст»;
//   • 400 — сервер назвал, что не так, и перечислил допустимые значения:
//     его слова и показываем (свой список устареет первым);
//   • batch_id null — одиночное действие; id есть — пачка; раскрытие ответило
//     404 — «раскрыть нечем» (пачка до выкатки S7B-13, dry_run или «всё уже
//     так»), и это снова не «пусто».
import { loreFetch } from '../auth/session';
import { LoreHttpError } from '../api/loreSlice';

const ACTIONS_PATH = '/lore/admin/actions';

/** Семейства журнала — закрытый список сервера (LoreSlices.ADMIN_FAMILIES). */
export const ACTION_FAMILIES = ['dict', 'kc', 'admin', 'user', 'project', 'project-actor'] as const;
/** Ось вызывающего (LoreAdminActions.AXES); unauth — «не опознан», не «человек». */
export const ACTION_AXES = ['human', 'agent', 'unauth'] as const;
/** Пределы выдачи: сервер принимает 1..1000, по умолчанию 200. */
export const ACTION_LIMITS = [50, 100, 200, 500, 1000] as const;

export interface ActionRow {
  /** epoch millis или null — отметки нет (показывать 1970 нельзя). */
  ts: number | null;
  family: string | null;
  entity_id: string | null;
  caller: string | null;
  axis: string | null;
  /** Код ответа или null — исход не записан. */
  status: number | null;
  /** id пачки массовых правок или null — одиночное действие. */
  batch_id: string | null;
}

export type TotalState = 'exact' | 'unknown';

export interface ActionsData {
  rows: ActionRow[];
  /** Сколько строк показано — столько, сколько пришло. */
  shown: number;
  /** Сколько всего под фильтром; null при totalState=unknown. */
  total: number | null;
  totalState: TotalState;
  /** Выдача обрезана пределом: записей больше, чем показано. */
  truncated: boolean;
  /** Предел, которым сервер обрезал; null — он его не назвал. */
  limit: number | null;
}

export interface ActionsQuery {
  caller: string;
  axis: string;
  family: string;
  batch_id: string;
  from: string;
  to: string;
  /** Предел строкой — он приходит из <select>/URL. Пусто = умолчание сервера. */
  limit: string;
}

export const EMPTY_ACTIONS_QUERY: ActionsQuery = {
  caller: '', axis: '', family: '', batch_id: '', from: '', to: '', limit: '',
};

/** Порядок — он же порядок параметров в запросе (читаемый адрес и журнал прокси). */
const QUERY_KEYS = ['caller', 'axis', 'family', 'batch_id', 'from', 'to', 'limit'] as const;
/** Отбор — это caller/axis/family/batch_id/from/to; limit НЕ отбирает, он режет. */
const FILTER_KEYS = ['caller', 'axis', 'family', 'batch_id', 'from', 'to'] as const;

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** id пачки: rb-<13 цифр>-<8 hex> (LoreRoleBatch.BATCH_ID). */
export function isBatchId(s: string | null | undefined): boolean {
  return typeof s === 'string' && /^rb-[0-9]{13}-[0-9a-f]{8}$/.test(s);
}

/** Исход действия по коду ответа: нет кода — «не записан», а не успех. */
export type Outcome = 'ok' | 'refused' | 'unknown';
export function outcomeOf(status: number | null): Outcome {
  if (status === null) return 'unknown';
  return status >= 400 ? 'refused' : 'ok';
}

/** Что рисовать в клетке «Пачка»: одиночное действие, пачка, пачка без событий. */
export type BatchState = 'single' | 'batch' | 'unexpandable';

export function parseActions(body: unknown): ActionsData {
  const b = (body ?? {}) as Record<string, unknown>;
  const rows = (Array.isArray(b.rows) ? b.rows : []).map(r => {
    const o = (r ?? {}) as Record<string, unknown>;
    const batch = str(o.batch_id);
    return {
      ts: num(o.ts),
      family: str(o.family),
      entity_id: str(o.entity_id),
      caller: str(o.caller),
      axis: str(o.axis),
      status: num(o.status),
      // Поля нет (сборка сервера старше S7B-13) — null; угадывать пачку по
      // entity_id здесь нельзя: это решение сервера, и он его уже принял.
      batch_id: isBatchId(batch) ? batch : null,
    };
  });
  // Точным счёт считается, только если сервер САМ назвал его точным И прислал
  // число: «exact» без цифры — это тоже «не знаем», а не «показано всё».
  const total = num(b.total);
  const exact = b.total_state === 'exact' && total !== null;
  return {
    rows,
    shown: rows.length,
    total: exact ? total : null,
    totalState: exact ? 'exact' : 'unknown',
    truncated: b.truncated === true,
    limit: num(b.limit),
  };
}

/** Строка запроса: пустые фильтры не уходят вовсе (фильтр «по пустому» — ложь). */
export function actionsSearch(q: ActionsQuery): string {
  const p = new URLSearchParams();
  for (const k of QUERY_KEYS) {
    const v = (q[k] ?? '').trim();
    if (v !== '') p.set(k, v);
  }
  return p.toString();
}

/** Стоит ли хоть один отбор — от этого зависит, «журнал пуст» или «по фильтру ничего». */
export function hasActionFilters(q: ActionsQuery): boolean {
  return FILTER_KEYS.some(k => (q[k] ?? '').trim() !== '');
}

export interface FetchOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

async function getJson(url: string, opts: FetchOptions): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? loreFetch;
  const res = await doFetch(url, { signal: opts.signal, headers: { Accept: 'application/json' } });
  if (!(res.headers.get('Content-Type') ?? '').includes('json')) {
    // Страница прокси/SPA вместо JSON — сбой, а не «пусто».
    throw new LoreHttpError(res.status, 'NON_JSON', res.statusText);
  }
  const body = (await res.json()) as { error?: string; detail?: string };
  if (!res.ok) throw new LoreHttpError(res.status, body?.error ?? '', body?.detail ?? '');
  return body;
}

export async function fetchActions(q: ActionsQuery, opts: FetchOptions = {}): Promise<ActionsData> {
  const qs = actionsSearch(q);
  return parseActions(await getJson(ACTIONS_PATH + (qs ? `?${qs}` : ''), opts));
}

export interface BadParams {
  /** Слова сервера как есть — он знает, что именно не принял. */
  detail: string;
  /** Допустимые значения, перечисленные сервером (пусто — он их не перечислял). */
  allowed: string[];
}

/**
 * 400 от сервера — это НЕ сбой загрузки: неизвестное family/axis, не-id пачки,
 * from позже to, предел вне 1..1000. Список допустимых значений сервер пишет
 * в сообщении как [a, b, c] — оттуда и берём, своего списка не подставляя.
 */
export function badParamsOf(err: unknown): BadParams | null {
  if (!(err instanceof LoreHttpError) || err.status !== 400) return null;
  const detail = err.detail || err.message;
  const m = /\[([^\]]*)\]/.exec(detail);
  const allowed = m ? m[1].split(',').map(s => s.trim()).filter(s => s !== '') : [];
  return { detail, allowed };
}

export interface BatchItem {
  kc_sub: string | null;
  project: string | null;
  /** grant | update | remove — как назвал сервер. */
  action: string | null;
  role: string | null;
  /** Роль до правки; null — роли не было (откат снимет). */
  role_before: string | null;
  at: string | null;
  by_role: string | null;
}

export interface BatchData {
  batch_id: string;
  kc_sub: string | null;
  count: number;
  items: BatchItem[];
  /** Обратный пакет, как его собрал сервер (показываем, не применяем). */
  undo: Array<Record<string, unknown>>;
  /** До какого момента открыто окно отката; null — сервер срок не назвал. */
  undoUntil: string | null;
  undoOpen: boolean;
  rollback: { method: string; path: string } | null;
}

export function parseBatch(body: unknown): BatchData {
  const b = (body ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(b.items) ? b.items : []).map(r => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      kc_sub: str(o.kc_sub), project: str(o.project), action: str(o.action),
      role: str(o.role), role_before: str(o.role_before), at: str(o.at), by_role: str(o.by_role),
    };
  });
  // undo_until приходит как String.valueOf(Instant) — у неразобранного id это
  // литерал "null". Срок неизвестен — окно считаем закрытым: обещать откат,
  // которого сервер может не дать, нельзя.
  const until = str(b.undo_until);
  const undoUntil = until === null || until === 'null' ? null : until;
  const rb = (b.rollback ?? null) as { method?: unknown; path?: unknown } | null;
  return {
    batch_id: str(b.batch_id) ?? '',
    kc_sub: str(b.kc_sub),
    count: num(b.count) ?? items.length,
    items,
    undo: (Array.isArray(b.undo) ? b.undo : []) as Array<Record<string, unknown>>,
    undoUntil,
    undoOpen: b.undo_open === true && undoUntil !== null,
    rollback: rb && str(rb.path) ? { method: str(rb.method) ?? 'POST', path: str(rb.path)! } : null,
  };
}

export async function fetchBatch(batchId: string, opts: FetchOptions = {}): Promise<BatchData> {
  const url = `${ACTIONS_PATH}/batch/${encodeURIComponent(batchId)}`;
  return parseBatch(await getJson(url, opts));
}

/**
 * Отметка времени журнала для показа: «2026-11-10 09:31» (UTC — ts хранится в
 * epoch millis, и подсказка несёт момент целиком). Нет отметки — null, чтобы
 * экран сказал «время не записано», а не нарисовал начало эпохи.
 *
 * Правило написания — kit (kitMinute, одно правило на даты, ревью 10.11.2026);
 * здесь только перевод millis → ISO.
 */
export function actionTime(ts: number | null): { iso: string } | null {
  if (ts === null) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return { iso: d.toISOString() };
}
