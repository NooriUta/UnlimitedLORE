// Источник данных ленты новостей v2 (S7A-02). Экран не знает, откуда числа:
// живой GET /lore/news/v2 или фикстура по контракту, пока эндпоинт не на
// стенде. Переключение — выбором источника у экрана, одной строкой.
import { parseNewsResponse } from './model';
import type { NewsReadMark, NewsResponse } from './types';
import { loreFetch } from '../../auth/session';

export interface NewsSource {
  /** live — сервер; fixture — пример по контракту (экран помечает его явно). */
  kind: 'live' | 'fixture';
  load(params: URLSearchParams, signal?: AbortSignal): Promise<NewsResponse>;
  /** PUT /lore/news/v2/read-mark — черту двигает только человек (§8). */
  setReadMark(at: string): Promise<NewsReadMark>;
}

/** Ошибка HTTP с кодом — kit различает 403 («нет прав») и сбой по status. */
export class NewsHttpError extends Error {
  constructor(public status: number, public code: string | null, message: string) {
    super(message);
    this.name = 'NewsHttpError';
  }
}

export interface HttpNewsSourceOptions {
  /** Префикс API, по умолчанию /lore (прокси web-next). */
  base?: string;
  fetch?: typeof fetch;
  headers?: () => Record<string, string>;
}

async function fail(res: Response): Promise<never> {
  let code: string | null = null;
  let msg = `${res.status} ${res.statusText}`.trim();
  try {
    const body = await res.json() as { code?: string; error?: string; message?: string };
    code = body.code ?? body.error ?? null;
    const text = body.message ?? body.error;
    if (text) msg = `${res.status} ${code && code !== text ? `${code}: ` : ''}${text}`;
  } catch { /* тело не JSON — оставляем статус */ }
  throw new NewsHttpError(res.status, code, msg);
}

export function httpNewsSource(opts: HttpNewsSourceOptions = {}): NewsSource {
  const base = opts.base ?? '/lore';
  // В приложении запрос к /lore/* идёт через вход (S3-18): умолчание — loreFetch.
  const f = opts.fetch ?? loreFetch;
  const headers = () => ({ Accept: 'application/json', ...(opts.headers?.() ?? {}) });
  return {
    kind: 'live',
    async load(params, signal) {
      const res = await f(`${base}/news/v2?${params.toString()}`, { headers: headers(), signal });
      if (!res.ok) return fail(res);
      return parseNewsResponse(await res.json());
    },
    async setReadMark(at) {
      const res = await f(`${base}/news/v2/read-mark`, {
        method: 'PUT',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ at }),
      });
      // 503 — черта ещё не заведена (схема после S2): тело несёт state=unavailable.
      if (!res.ok && res.status !== 503) return fail(res);
      return await res.json() as NewsReadMark;
    },
  };
}

/** Источник-фикстура: тот же ответ на любой запрос; помечен kind=fixture. */
export function fixtureNewsSource(data: NewsResponse): NewsSource {
  let mark = data.meta.read_mark ?? { state: 'unavailable', at: null };
  return {
    kind: 'fixture',
    async load() {
      return parseNewsResponse({ ...data, meta: { ...data.meta, read_mark: mark } });
    },
    async setReadMark(at) {
      mark = { state: 'ok', at };
      return mark;
    },
  };
}
