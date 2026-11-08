// Клиент слайсов LORE для web-next (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03).
// Те же эндпоинты, что у v1 (GET /lore/slice/{id}), но свой код: v1 (src/api)
// заморожен и отсюда не импортируется (D-2026-UXR-V2-FOLDER-V1-FROZEN).
//
// Отличие от v1 fetchLoreSlice: тело отдаётся ЦЕЛИКОМ — строки вместе с
// метаданными полноты S1 (truncated/limit/hint, page{…}, outside_scope), иначе
// kit (useLoadState → Truncated) не отличит полную выдачу от обрезанной.
import type { SliceCompletenessMeta } from '@seidr/kit';

const LORE_BASE = '/lore';

export type SliceBody<T> = SliceCompletenessMeta & { rows: T[] };

/** HTTP-ошибка со статусом: kit classifyError читает status (403 → «нет прав»). */
export class LoreHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  constructor(status: number, code: string, detail: string) {
    super([code || `HTTP ${status}`, detail].filter(Boolean).join(': '));
    this.name = 'LoreHttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export interface SliceRequestOptions {
  signal?: AbortSignal;
  /** Заголовки входа (Authorization) — даёт оболочка, когда вход подключён. */
  headers?: Record<string, string>;
  /** Подмена fetch (тесты). */
  fetchImpl?: typeof fetch;
}

function isJson(res: Response): boolean {
  return (res.headers.get('Content-Type') ?? '').includes('json');
}

export async function fetchSlice<T>(
  slice: string,
  params: Record<string, string> = {},
  opts: SliceRequestOptions = {},
): Promise<SliceBody<T>> {
  const qs = new URLSearchParams(params).toString();
  const url = `${LORE_BASE}/slice/${encodeURIComponent(slice)}${qs ? `?${qs}` : ''}`;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url, { signal: opts.signal, headers: { Accept: 'application/json', ...opts.headers } });
  if (!isJson(res)) {
    // Страница прокси/SPA вместо JSON — это сбой, а не «пусто».
    throw new LoreHttpError(res.status, 'NON_JSON', res.statusText);
  }
  if (!res.ok) {
    let code = '';
    let detail = '';
    try {
      const b = (await res.json()) as { error?: string; detail?: string };
      code = b.error ?? '';
      detail = b.detail ?? '';
    } catch { /* тело не разобрали — хватит статуса */ }
    throw new LoreHttpError(res.status, code, detail);
  }
  const body = (await res.json()) as Partial<SliceBody<T>>;
  return { ...body, rows: Array.isArray(body.rows) ? body.rows : [] } as SliceBody<T>;
}

/** Сигнатура загрузчика — экраны получают её параметром (подмена в тестах). */
export type SliceFetcher = <T>(slice: string, params: Record<string, string>, signal?: AbortSignal) => Promise<SliceBody<T>>;

export function sliceFetcher(base: Omit<SliceRequestOptions, 'signal'> = {}): SliceFetcher {
  return (slice, params, signal) => fetchSlice(slice, params, { ...base, signal });
}
