// Клиент LORE v2 к /lore/slice/* (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Свой, а не src/api/lore.ts v1: v1 заморожен (D-2026-UXR-V2-FOLDER-V1-FROZEN)
// и тянет за собой oidc-client-ts и половину приложения. Эндпоинты — те же.
//
// Честность (S1): тело слайса отдаётся как есть — rows вместе с метаданными
// полноты (truncated / limit / hint / page / scope / outside_scope / warnings),
// разбирает их экран. Ошибка несёт HTTP-статус и код: kit (classifyError)
// отличает «нет прав» (403) от «сбоя» (401, 5xx, сеть), а 200 с не-JSON телом
// — ошибка, а не «пусто».
import { oidcSessionStorage, type StorageLike } from '../storage/oidcSession';

/** Сырое тело GET /lore/slice/{id} (форма — контракт 1 S1, SPEC-LORE-UXR-S1-CONTRACTS). */
export interface SliceBody<T = Record<string, unknown>> {
  rows: T[];
  truncated?: boolean | 'unknown';
  limit?: number;
  hint?: string;
  scope?: { applied: boolean; projects?: number; note?: string };
  outside_scope?: { id: string; verdict: string; reason: string } | null;
  page?: {
    limit: number | null; offset: number; total: number; has_more: boolean;
    fields?: string[]; fields_checked?: boolean; warning?: string;
  };
  warnings?: string[];
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
  /** Вход включён (VITE_LORE_AUTH_ENABLED, как у v1 и бэкенда). */
  authEnabled?: boolean;
  storage?: StorageLike | null;
  now?: () => number;
}

const UNREACHABLE = new Set([502, 503, 504]);

function envAuthEnabled(): boolean {
  return import.meta.env.VITE_LORE_AUTH_ENABLED === 'true';
}

/**
 * Заголовки входа. Вход выключен — та же роль, что шлёт v1 (бэкенд с выключенным
 * OIDC иначе не пустит запись). Включён — Bearer из сохранённой OIDC-сессии
 * (ключ `oidc.user:<issuer>:<client>`, его пишет вход v1 на том же origin);
 * протухшей или отсутствующей — ничего: бэкенд ответит 401, экран покажет ошибку
 * входа, а не пустой список.
 */
export function authHeaders(opts: Pick<FetchOptions, 'authEnabled' | 'storage' | 'now'> = {}): Record<string, string> {
  const enabled = opts.authEnabled ?? envAuthEnabled();
  if (!enabled) return { 'X-Seer-Role': 'admin' };
  const st = opts.storage === undefined ? oidcSessionStorage() : opts.storage;
  if (!st) return {};
  const nowSec = (opts.now ?? Date.now)() / 1000;
  for (let i = 0; i < st.length; i++) {
    const k = st.key(i);
    if (!k || !k.startsWith('oidc.user:')) continue;
    try {
      const u = JSON.parse(st.getItem(k) ?? 'null') as { access_token?: string; expires_at?: number } | null;
      if (u?.access_token && (typeof u.expires_at !== 'number' || u.expires_at > nowSec)) {
        return { Authorization: `Bearer ${u.access_token}` };
      }
    } catch { /* битая запись — как нет сессии */ }
  }
  return {};
}

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
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url.toString(), { signal: opts.signal, headers: { Accept: 'application/json', ...authHeaders(opts) } });
  if (!res.ok) throw await toError(res);
  if (!isJson(res)) throw new LoreApiError(res.status, 'NON_JSON', 'ответ не JSON');
  const body = (await res.json()) as Partial<SliceBody<T>> | null;
  return { ...(body ?? {}), rows: Array.isArray(body?.rows) ? body!.rows : [] };
}
