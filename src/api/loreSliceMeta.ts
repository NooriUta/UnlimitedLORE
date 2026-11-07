// ── SPRINT_UXR_S1_HONEST_API/S1-02: слайс с метаданными полноты ─────────────
// fetchLoreSlice (lore.ts) отдаёт только body.rows и выбрасывает всё, что бэкенд
// сообщает о полноте выдачи: truncated/limit/hint (AidaLoreResource.sliceBody),
// scope и outside_scope (проектный скоуп), page.warning (SlicePage.apply).
// Без этого экран рисует «всё» там, где пришли «первые 500», и «пусто» там,
// где запись есть, но вне скоупа.
//
// Здесь — новый вызов рядом со старым: fetchLoreSlice и MCP не трогаются,
// переезд экранов — по одному, без поломки старого формата.

import { authHeaders, sessionExpired } from '../auth/session';
import {
  LoreConflictError, LoreDisabledError, LoreHttpError, LoreNotFoundError, LoreUpstreamError,
} from './lore';

/** true — сервер обрезал; 'unknown' — строк ровно потолок, а база об усечении молчит. */
export type SliceTruncation = boolean | 'unknown';

export interface SliceScope {
  applied: boolean;
  projects: number;
  note?: string;
}

export interface SliceOutsideScope {
  id: string;
  verdict: string;
  reason?: string;
}

export interface SlicePageMeta {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
  fields?: string[];
  fields_checked?: boolean;
  warning?: string;
}

export interface LoreSliceMeta<T> {
  rows: T[];
  /** ISO-время получения ответа клиентом — для «данные на HH:MM». */
  fetchedAt: string;
  /** null — скоуп не применялся (выдача не сужена). */
  scope: SliceScope | null;
  truncated: SliceTruncation;
  limit: number | null;
  page: SlicePageMeta | null;
  outsideScope: SliceOutsideScope | null;
  /** Человекочитаемые предупреждения сервера о неполноте, в порядке важности. */
  warnings: string[];
}

interface RawSliceBody<T> {
  rows?: T[];
  truncated?: unknown;
  limit?: unknown;
  hint?: unknown;
  scope?: SliceScope | null;
  outside_scope?: SliceOutsideScope | null;
  page?: SlicePageMeta | null;
}

function nonEmpty(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0;
}

/** Чистая нормализация тела ответа /lore/slice/{id}. */
export function parseSliceMeta<T>(body: RawSliceBody<T>, now: Date = new Date()): LoreSliceMeta<T> {
  const truncated: SliceTruncation =
    body.truncated === true ? true : body.truncated === 'unknown' ? 'unknown' : false;
  const warnings: string[] = [];
  if (truncated !== false && nonEmpty(body.hint)) warnings.push(body.hint);
  if (nonEmpty(body.outside_scope?.reason)) warnings.push(body.outside_scope.reason);
  if (nonEmpty(body.page?.warning)) warnings.push(body.page.warning);
  return {
    rows: Array.isArray(body.rows) ? body.rows : [],
    fetchedAt: now.toISOString(),
    scope: body.scope ?? null,
    truncated,
    limit: typeof body.limit === 'number' ? body.limit : null,
    page: body.page ?? null,
    outsideScope: body.outside_scope ?? null,
    warnings,
  };
}

const UNREACHABLE = new Set([502, 503, 504]);

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('application/json');
}

// Повторяет parseError из lore.ts (там он не экспортирован, а lore.ts — общий
// файл): те же классы ошибок для тех же ответов, иначе 403/502 здесь выглядели
// бы иначе, чем на старом пути. Когда parseError станет экспортом — заменить.
async function throwSliceError(res: Response): Promise<never> {
  if (res.status === 401) {
    sessionExpired();
    throw new Error('401 unauthenticated');
  }
  if (!isJson(res)) {
    if (UNREACHABLE.has(res.status)) throw new LoreUpstreamError(`backend returned ${res.status} non-JSON`);
    throw new LoreHttpError(res.status, res.statusText || 'NON_JSON', '');
  }
  let code = '';
  let detail = '';
  try {
    const body = (await res.json()) as { error?: string; detail?: string };
    code = body.error ?? '';
    detail = body.detail ?? '';
  } catch { /* fall through */ }
  if (code === 'LORE_DISABLED') throw new LoreDisabledError();
  if (code === 'LORE_UPSTREAM') throw new LoreUpstreamError(detail);
  if (code === 'NOT_FOUND')     throw new LoreNotFoundError(detail);
  if (res.status === 409)       throw new LoreConflictError(detail);
  throw new LoreHttpError(res.status, code || res.statusText, detail);
}

/** Как fetchLoreSlice, но с метаданными полноты: {rows, fetchedAt, scope, truncated, warnings, …}. */
export async function fetchLoreSliceMeta<T>(
  slice: string,
  params?: Record<string, string>,
  signal?: AbortSignal,
): Promise<LoreSliceMeta<T>> {
  const url = new URL(`/lore/slice/${slice}`, location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { signal, headers: { ...authHeaders() } });
  if (!res.ok) return throwSliceError(res);
  if (!isJson(res)) throw new LoreUpstreamError(`backend returned ${res.status} non-JSON`);
  const body = (await res.json()) as RawSliceBody<T>;
  return parseSliceMeta(body);
}
