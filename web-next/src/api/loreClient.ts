// Клиент LORE v2 к /lore/slice/* (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Свой, а не src/api/lore.ts v1: v1 заморожен (D-2026-UXR-V2-FOLDER-V1-FROZEN)
// и тянет за собой oidc-client-ts и половину приложения. Эндпоинты — те же.
//
// Честность (S1): тело слайса отдаётся как есть — rows вместе с метаданными
// полноты (truncated / limit / hint / page / scope / outside_scope / warnings),
// разбирает их экран. Ошибка несёт HTTP-статус и код: kit (classifyError)
// отличает «нет прав» (403) от «сбоя» (401, 5xx, сеть), а 200 с не-JSON телом
// — ошибка, а не «пусто».
import type { AuthSession } from '@seidr/kit/auth';
import { v2Auth } from '../auth/session';

/** Сырое тело GET /lore/slice/{id} (форма — контракт 1 S1, SPEC-LORE-UXR-S1-CONTRACTS). */
export interface SliceBody<T = Record<string, unknown>> {
  rows: T[];
  truncated?: boolean | 'unknown';
  limit?: number;
  hint?: string;
  scope?: { applied: boolean; projects?: number; note?: string };
  /**
   * Сужение по выбранным в шапке проектам (S4-03, серверный PR #1053).
   *
   * `requested` — что просили, `applied` — применилось ли вообще (срез может
   * быть не привязан к проектам), `dropped` — какие проекты отброшены правами.
   * Если ни один выбранный проект недоступен, сервер отвечает 200 и пустыми
   * строками, а не 403 — поэтому «пусто» здесь обязано сопровождаться словами,
   * иначе его не отличить от «данных нет в системе».
   *
   * Объяснение приходит то в `note` (проекты вне прав отброшены), то в
   * `reason` (срез не привязан к проектам) — смысл тот же, читаем оба (B11).
   */
  scope_projects?: { requested: string[]; applied: boolean; dropped?: string[]; note?: string; reason?: string };
  outside_scope?: { id: string; verdict: string; reason: string } | null;
  page?: {
    limit: number | null; offset: number; total: number; has_more: boolean;
    fields?: string[]; fields_checked?: boolean; warning?: string;
  };
  warnings?: string[];
  /**
   * «Сейчас» источника — заголовок Date ответа, ISO (K2-DATE-RANGE). От него, а
   * не от часов браузера считаются «сегодня» ленты и быстрые периоды фильтра
   * по дате. Нет заголовка — поля нет, и экран берёт часы браузера.
   */
  served_at?: string;
}

export class LoreApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail: string) {
    super(`HTTP ${status} ${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'LoreApiError';
  }
}

export interface FetchOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Origin API; по умолчанию — текущий (прокси /lore/ на том же хосте). */
  base?: string;
  /**
   * Сессия входа (S3-18); по умолчанию — своя сессия v2 (auth/session.ts).
   * Вход выключен — dev-роль X-Seer-Role, как у v1; включён — Bearer своего
   * токена, без токена запрос не уходит (ведёт на вход), 401 → «сессия истекла».
   */
  session?: AuthSession;
}

const UNREACHABLE = new Set([502, 503, 504]);

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('application/json');
}

async function toError(res: Response): Promise<LoreApiError> {
  if (!isJson(res)) {
    const code = res.status === 401 ? 'UNAUTHENTICATED' : UNREACHABLE.has(res.status) ? 'UNREACHABLE' : 'NON_JSON';
    return new LoreApiError(res.status, code, '');
  }
  let code = '';
  let detail = '';
  try {
    const b = (await res.json()) as { error?: string; detail?: string };
    code = b.error ?? '';
    detail = b.detail ?? '';
  } catch { /* тело не разобрали — остаётся статус */ }
  return new LoreApiError(res.status, code || res.statusText || 'HTTP', detail);
}

/** GET /lore/slice/{id}: тело с метаданными полноты; ошибка — LoreApiError со статусом. */
export async function fetchSlice<T = Record<string, unknown>>(
  slice: string,
  params?: Record<string, string>,
  opts: FetchOptions = {},
): Promise<SliceBody<T>> {
  const base = opts.base ?? (typeof location === 'undefined' ? 'http://localhost' : location.origin);
  const url = new URL(`/lore/slice/${encodeURIComponent(slice)}`, base);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const doFetch = (opts.session ?? v2Auth).wrapFetch(opts.fetchImpl);
  const res = await doFetch(url.toString(), { signal: opts.signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw await toError(res);
  if (!isJson(res)) throw new LoreApiError(res.status, 'NON_JSON', 'ответ не JSON');
  const body = (await res.json()) as Partial<SliceBody<T>> | null;
  const date = res.headers.get('date');
  const ms = date ? Date.parse(date) : NaN;
  return {
    ...(body ?? {}),
    rows: Array.isArray(body?.rows) ? body!.rows : [],
    ...(Number.isNaN(ms) ? {} : { served_at: new Date(ms).toISOString() }),
  };
}
