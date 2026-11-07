// Честные состояния загрузки (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00c).
//
// Шесть исходов, и ни один не выдаёт себя за другой:
//   loading   — данных ещё нет;
//   empty     — запрос выполнен, ноль строк, выдача полная (проверенный ноль);
//   error     — данные не получены (сеть, 5xx, 401…);
//   forbidden — нет прав (403) или запись есть, но вне ваших проектов;
//   partial   — данные есть, но не все: страница, потолок сервера, полноту
//               проверить нечем, или 0 строк при непроверенных полях;
//   ok        — данные есть и выдача полная.
//
// Полноту читаем из метаданных, которые бэкенд уже отдаёт (S1):
//   SlicePage.apply → page { limit, offset, total, has_more, fields_checked, warning }
//   AidaLoreResource.sliceBody → truncated: true | "unknown", limit, hint
//   AidaLoreResource (slice) → outside_scope { id, verdict, reason }

export type LoadState = 'loading' | 'empty' | 'error' | 'forbidden' | 'partial' | 'ok';

/** Метаданные полноты в теле ответа слайса (все поля необязательны). */
export interface SliceCompletenessMeta {
  truncated?: boolean | 'unknown';
  limit?: number;
  hint?: string;
  page?: {
    limit?: number | null;
    offset?: number;
    total?: number;
    has_more?: boolean;
    fields?: string[];
    fields_checked?: boolean;
    warning?: string;
  };
  outside_scope?: { id?: string; verdict?: string; reason?: string } | null;
}

export type Completeness =
  | { kind: 'complete'; shown: number }
  | { kind: 'paged'; shown: number; offset: number; total: number }
  | { kind: 'capped'; shown: number; limit?: number; hint?: string }
  | { kind: 'unknown'; shown: number; hint?: string }
  | { kind: 'unverified'; shown: number; hint?: string };

function withHint<T extends object>(base: T, hint: string | undefined): T & { hint?: string } {
  return hint ? { ...base, hint } : base;
}

/**
 * Полнота выдачи. Потолок сервера важнее страницы: при truncated:true page.total
 * — это число уже обрезанных строк, и «из N» на его основе соврало бы.
 */
export function completeness(meta: SliceCompletenessMeta | null | undefined, shown: number): Completeness {
  const m = meta ?? {};
  if (m.truncated === true) {
    const c: Completeness = { kind: 'capped', shown };
    if (typeof m.limit === 'number') c.limit = m.limit;
    return withHint(c, m.hint);
  }
  if (m.truncated === 'unknown') return withHint({ kind: 'unknown' as const, shown }, m.hint);
  const p = m.page;
  if (p?.has_more) {
    return { kind: 'paged', shown, offset: p.offset ?? 0, total: p.total ?? shown };
  }
  if (p && p.fields_checked === false) return withHint({ kind: 'unverified' as const, shown }, p.warning);
  return { kind: 'complete', shown };
}

function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: unknown; response?: { status?: unknown } };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.response?.status === 'number') return e.response.status;
  return undefined;
}

/**
 * Нет прав — отдельно от сбоя. 401 («не вошли / сессия истекла») — это сбой
 * входа, а не отказ в правах на данные, поэтому error.
 */
export function classifyError(err: unknown): 'forbidden' | 'error' {
  if (statusOf(err) === 403) return 'forbidden';
  if (err && typeof err === 'object' && (err as { code?: unknown }).code === 'FORBIDDEN') return 'forbidden';
  return 'error';
}

export interface LoadInput {
  loading?: boolean;
  error?: unknown;
  rows?: readonly unknown[] | null;
  meta?: SliceCompletenessMeta | null;
}

/**
 * Ошибка важнее всего (и при перезагрузке). Нет строк — loading (в том числе
 * «ещё не начинали»: шести исходов достаточно, «пусто» тут было бы враньём).
 * Перезагрузка поверх уже полученных строк показывает строки, а не скелет —
 * поэтому флаг loading решает только при отсутствии данных.
 */
export function deriveLoadState({ error, rows, meta }: LoadInput): LoadState {
  if (error !== undefined && error !== null) return classifyError(error);
  if (rows === undefined || rows === null) return 'loading';
  const c = completeness(meta, rows.length);
  if (rows.length === 0) {
    if (meta?.outside_scope) return 'forbidden';
    return c.kind === 'complete' ? 'empty' : 'partial';
  }
  return c.kind === 'complete' ? 'ok' : 'partial';
}

/** Строки из ответа: сам массив или поле rows тела слайса. */
export function rowsOf(data: unknown): unknown[] | undefined {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows)) {
    return (data as { rows: unknown[] }).rows;
  }
  return undefined;
}

/** Метаданные полноты из ответа (у голого массива их нет). */
export function metaOf(data: unknown): SliceCompletenessMeta | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return data as SliceCompletenessMeta;
}

/** Текст ошибки для показа: HTTP-статус и сообщение, без «[object Object]». */
export function errorDetail(err: unknown): string {
  const status = statusOf(err);
  let msg = '';
  if (typeof err === 'string') msg = err;
  else if (err && typeof err === 'object') {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') msg = m;
  }
  return [status ? `HTTP ${status}` : '', msg].filter(Boolean).join(' · ');
}
