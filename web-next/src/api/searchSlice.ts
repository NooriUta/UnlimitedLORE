// Клиент v2 к существующему слайсу search (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-14):
// GET /lore/slice/search?pattern=… → rows {type, ref_id, title}. v1 (src/api)
// не импортируется (D-2026-UXR-V2-FOLDER-V1-FROZEN) — это свой тонкий клиент
// к тому же эндпоинту.
//
// Честность выдачи (метаданные полноты S1): слайс собирается из веток по типам
// с потолком LIMIT 10…15 на ветку, и сам об этом не сообщает. Поэтому partial =
// сервер сказал truncated ИЛИ какой-то тип упёрся в потолок ветки — тогда
// «больше нет» не доказано, и палитра говорит «мог отдать не всё».
//
// Отказы — словами и с кодом: 403 SCOPE_EMPTY («нет прав») не должен выглядеть
// как пустая выдача, 502 — как «ничего не нашлось».
import type { KitLang } from '@seidr/kit';
import { appT } from '../i18n';

export interface SearchSliceRow {
  type: string;
  ref_id: string;
  title: string | null;
}

export interface SearchSliceResult {
  rows: SearchSliceRow[];
  /** true — выдача могла быть неполной (см. шапку файла). */
  partial: boolean;
}

/** Наименьший потолок ветки слайса search (LoreSlices: LIMIT 10 у части веток, 15 у остальных). */
export const SEARCH_TYPE_CAP = 10;

export interface SearchSliceOptions {
  signal?: AbortSignal;
  /** Заголовки авторизации; в v2 их даст общий клиент /lore/* (пока — пусто). */
  headers?: () => Record<string, string>;
  fetchImpl?: typeof fetch;
  lang?: KitLang;
}

export class SearchSliceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'SearchSliceError';
  }
}

const UNREACHABLE = new Set([502, 503, 504]);

function isJson(res: Response): boolean {
  return (res.headers.get('Content-Type') ?? '').includes('json');
}

async function failure(res: Response, lang: KitLang): Promise<never> {
  let code = '';
  let detail = '';
  if (isJson(res)) {
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      code = body.error ?? '';
      detail = body.detail ?? '';
    } catch { /* тело не разобрали — причина по коду ответа */ }
  }
  const s = res.status;
  const reason = s === 401 ? appT(lang, 'search.err.unauthenticated')
    : s === 403 ? appT(lang, 'search.err.forbidden')
      : UNREACHABLE.has(s) ? appT(lang, 'search.err.unreachable')
        : detail || code || res.statusText || appT(lang, 'search.err.http');
  throw new SearchSliceError(s, code, `${s}: ${reason}`);
}

export async function fetchSearchSlice(pattern: string, opts: SearchSliceOptions = {}): Promise<SearchSliceResult> {
  const lang = opts.lang ?? 'ru';
  const doFetch = opts.fetchImpl ?? fetch;
  const qs = new URLSearchParams({ pattern });
  const res = await doFetch(`/lore/slice/search?${qs}`, {
    signal: opts.signal,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(opts.headers?.() ?? {}) },
  });
  if (!res.ok) return failure(res, lang);
  if (!isJson(res)) throw new SearchSliceError(res.status, 'NON_JSON', `${res.status}: ${appT(lang, 'search.err.nonJson')}`);
  const body = (await res.json()) as { rows?: Partial<SearchSliceRow>[]; truncated?: boolean | 'unknown' };
  const rows = (body.rows ?? [])
    .filter((r): r is SearchSliceRow => typeof r.ref_id === 'string' && r.ref_id !== '' && typeof r.type === 'string')
    .map(r => ({ type: r.type, ref_id: r.ref_id, title: r.title ?? null }));
  const perType = new Map<string, number>();
  for (const r of rows) perType.set(r.type, (perType.get(r.type) ?? 0) + 1);
  const capped = [...perType.values()].some(n => n >= SEARCH_TYPE_CAP);
  const partial = body.truncated === true || body.truncated === 'unknown' || capped;
  return { rows, partial };
}
