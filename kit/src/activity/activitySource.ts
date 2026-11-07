// Источник данных вкладки «Активность» (SPRINT_UXR_S7A_NEWS/S7A-06).
// Сервер новостей v2 подготовлен (feature/s7a-news-server-prep, f525c294), но
// ещё не на стенде (решение владелицы: сборка/PR сервера — после S2). Пока —
// фикстура по контракту за адаптером; переключение на живой API — флаг
// ACTIVITY_LIVE_API (одна строка).
import { NEWS_V2_FIXTURE } from './newsV2.fixture';
import { NewsV2HttpError, type NewsV2Response, type NewsV2Row } from './newsV2';

/** Загрузка ленты по строке запроса (activityParams). */
export type ActivitySource = (query: string, signal?: AbortSignal) => Promise<NewsV2Response>;

/** Живой API вместо фикстуры. Переключать здесь, когда /lore/news/v2 выйдет на стенд. */
export const ACTIVITY_LIVE_API = false;

export interface HttpActivitySourceOptions {
  /** База эндпоинта (по умолчанию /lore/news/v2). */
  base?: string;
  /** fetch приложения — с его авторизацией (токен, X-Seer-Role). */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Доп. заголовки. */
  headers?: Record<string, string>;
}

function errorMessage(status: number, text: string): { message: string; code?: string } {
  try {
    const j = JSON.parse(text) as { message?: unknown; code?: unknown; error?: unknown };
    const message = [j.code, j.message ?? j.error].filter(x => typeof x === 'string' && x).join(': ');
    return { message: message || `HTTP ${status}`, code: typeof j.code === 'string' ? j.code : undefined };
  } catch {
    return { message: text.trim().slice(0, 200) || `HTTP ${status}` };
  }
}

/** GET {base}?{query}; не-2xx — NewsV2HttpError со статусом (403 → «нет прав»). */
export function httpActivitySource(o: HttpActivitySourceOptions = {}): ActivitySource {
  const base = o.base ?? '/lore/news/v2';
  return async (query, signal) => {
    const f = o.fetchImpl ?? ((i: string, init?: RequestInit) => fetch(i, init));
    const res = await f(`${base}?${query}`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...(o.headers ?? {}) },
      signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const e = errorMessage(res.status, text);
      throw new NewsV2HttpError(res.status, e.message, e.code);
    }
    return JSON.parse(text) as NewsV2Response;
  };
}

const AXIS_OF: Record<string, (r: NewsV2Row) => string[]> = {
  project: r => r.projects ?? [],
  sprint: r => (r.sprint ? [r.sprint] : []),
  milestone: r => r.milestones ?? [],
  component: r => r.components ?? [],
  type: r => [r.type],
  kind: r => [r.kind],
};

/**
 * Фикстура как источник: только сужает строки фильтрами записи, как сервер
 * (matches). Метрики фикстуры статичны — это витрина контракта, не расчёт.
 */
export function fixtureActivitySource(fx: NewsV2Response): ActivitySource {
  return async query => {
    const q = new URLSearchParams(query);
    const events = fx.events.filter(r => Object.entries(AXIS_OF).every(([ax, get]) => {
      const want = q.get(ax);
      if (!want) return true;
      const set = new Set(want.split(',').map(s => s.trim()).filter(Boolean));
      return get(r).some(v => set.has(v));
    }));
    // Как сервер: ноль строк без ошибок источников — empty; partial не снимается.
    const state = events.length === 0 && fx.meta.state !== 'partial' ? 'empty' : fx.meta.state;
    return { ...fx, events, meta: { ...fx.meta, state } };
  };
}

/** Источник по умолчанию: живой API или фикстура — по ACTIVITY_LIVE_API. */
export function defaultActivitySource(): ActivitySource {
  return ACTIVITY_LIVE_API ? httpActivitySource() : fixtureActivitySource(NEWS_V2_FIXTURE);
}
