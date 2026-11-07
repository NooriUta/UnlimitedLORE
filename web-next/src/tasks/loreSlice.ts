// Чтение слайса LORE для экрана задачи (SPRINT_UXR_S5_RECORD_TASKS/S5-04):
// GET /lore/slice/{id}?… → rows. v1-клиент (src/api/lore.ts) v2 не
// импортирует (v1 заморожен); общего клиента v2 пока нет — когда S4 его
// заведёт, этот файл заменяется им. Ошибка — с HTTP-статусом: экран рисует
// 403 как «нет доступа», прочее — как сбой с повтором, и никогда — как «пусто».
import type { SliceCompletenessMeta } from '@seidr/kit';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class LoreSliceError extends Error {
  constructor(readonly status: number, readonly code: string, readonly slice: string) {
    super(`${slice}: ${status}${code ? ` ${code}` : ''}`);
    this.name = 'LoreSliceError';
  }
}

export interface SliceOptions {
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  /** Заголовки авторизации (Bearer) — от оболочки v2; без них бэкенд ответит 401/403. */
  headers?: () => Record<string, string>;
}

/** Тело слайса целиком: rows + метаданные полноты S1 (page/truncated/outside_scope). */
export type SliceBody<T> = { rows: T[] } & SliceCompletenessMeta;

export async function fetchSlice<T>(slice: string, params: Record<string, string>, opts: SliceOptions = {}): Promise<SliceBody<T>> {
  const q = new URLSearchParams(params).toString();
  const url = `/lore/slice/${encodeURIComponent(slice)}${q ? `?${q}` : ''}`;
  const f = opts.fetchImpl ?? ((i: string, init?: RequestInit) => fetch(i, init));
  const res = await f(url, { signal: opts.signal, headers: { Accept: 'application/json', ...(opts.headers?.() ?? {}) } });
  if (!res.ok) {
    let code = '';
    try { code = ((await res.json()) as { error?: string }).error ?? ''; } catch { /* не JSON */ }
    throw new LoreSliceError(res.status, code, slice);
  }
  const body = (await res.json()) as Partial<SliceBody<T>>;
  if (!Array.isArray(body.rows)) throw new LoreSliceError(res.status, 'NO_ROWS', slice);
  return body as SliceBody<T>;
}
