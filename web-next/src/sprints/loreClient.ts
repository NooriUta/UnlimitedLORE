// Клиент v2 к /lore/* (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09). v1 (src/api) не
// импортируется — заморожен (D-2026-UXR-V2-FOLDER-V1-FROZEN); те же эндпоинты,
// те же правила честности, что у src/api/loreSliceMeta.ts (S1-02):
//   - слайс отдаётся ЦЕЛЫМ телом ({rows, page, truncated, limit, hint,
//     outside_scope}), чтобы useLoadState kit различал полный ответ и обрезанный;
//   - ошибка несёт HTTP-статус и код бэкенда: 403 → «нет прав», 5xx → «сбой»,
//     ни одна не превращается в пустой список.
// Узкий модуль под экран спринтов; когда у v2 появится общий клиент (каркас S4),
// этот переедет в него без смены интерфейса.

import { loreFetch } from '../auth/session';

export interface SliceBody<T> {
  rows: T[];
  truncated?: boolean | 'unknown';
  limit?: number;
  hint?: string;
  page?: { limit?: number | null; offset?: number; total?: number; has_more?: boolean; fields_checked?: boolean; warning?: string };
  outside_scope?: { id?: string; verdict?: string; reason?: string } | null;
}

/** Ошибка ответа LORE: status — HTTP, code — поле error бэкенда (FORBIDDEN, LORE_UPSTREAM…). */
export class LoreError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, detail: string) {
    super([`HTTP ${status}`, code, detail].filter(Boolean).join(' · '));
    this.name = 'LoreError';
    this.status = status;
    this.code = code;
  }
}

export interface LoreClient {
  slice<T>(slice: string, params?: Record<string, string>, signal?: AbortSignal): Promise<SliceBody<T>>;
  /** POST /lore/status — смена статуса записи плана (SCD2 на бэкенде). */
  setStatus(entityType: 'task' | 'sprint', id: string, status: string): Promise<void>;
}

export interface LoreClientOptions {
  fetch?: typeof fetch;
  /** База адреса; по умолчанию — origin страницы (прокси /lore/ того же nginx). */
  origin?: string;
  /** Заголовки входа (Bearer) — от оболочки v2; без них запросы идут как есть. */
  headers?: () => Record<string, string>;
}

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('application/json');
}

async function toError(res: Response): Promise<LoreError> {
  let code = '';
  let detail = '';
  if (isJson(res)) {
    try {
      const b = (await res.json()) as { error?: string; detail?: string };
      code = b.error ?? '';
      detail = b.detail ?? '';
    } catch { /* тело не разобрали — остаётся статус */ }
  }
  return new LoreError(res.status, code || res.statusText, detail);
}

export function createLoreClient(opts: LoreClientOptions = {}): LoreClient {
  const doFetch = opts.fetch ?? loreFetch;
  const origin = opts.origin ?? (typeof location === 'undefined' ? 'http://localhost' : location.origin);
  const headers = () => opts.headers?.() ?? {};
  return {
    async slice<T>(slice: string, params?: Record<string, string>, signal?: AbortSignal) {
      const url = new URL(`/lore/slice/${encodeURIComponent(slice)}`, origin);
      for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
      const res = await doFetch(url.toString(), { signal, headers: headers() });
      if (!res.ok) throw await toError(res);
      if (!isJson(res)) throw new LoreError(res.status, 'NON_JSON', 'ответ не JSON');
      const body = (await res.json()) as Partial<SliceBody<T>>;
      return { ...body, rows: Array.isArray(body.rows) ? body.rows : [] } as SliceBody<T>;
    },
    async setStatus(entityType, id, status) {
      const res = await doFetch(new URL('/lore/status', origin).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ entity_type: entityType, id, status }),
      });
      if (!res.ok) throw await toError(res);
    },
  };
}

export const defaultLoreClient: LoreClient = createLoreClient();
