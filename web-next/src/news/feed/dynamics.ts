// Блок «Динамика» новостей v2 (SPRINT_UXR_S7A_NEWS/S7A-11, слово владелицы 14.11.2026:
// «объёмные метрики по динамике… показатель неделя к неделе, месяц к месяцу»).
// Контракт GET /lore/news/v2/dynamics (сервер — NewsDynamics.compute): ряды 12 ISO-недель
// или 6 месяцев UTC, у каждой метрики — value, previous, delta, pct (null при прошлом 0).
// Все числа считает сервер (S7A-09) — клиент только рисует.
import type { NewsQuery, NewsScope } from './model';
import { NEWS_FILTER_AXES } from './types';

export type NewsDynamicsPeriod = 'week' | 'month';

/** Метрики в порядке владелицы. */
export const NEWS_DYNAMICS_METRICS = ['tasks_closed', 'tasks_created', 'sprints_closed', 'releases', 'accepted'] as const;
export type NewsDynamicsMetricId = typeof NEWS_DYNAMICS_METRICS[number];

export interface NewsDynamicsBucket {
  key: string;
  label: string;
  from: string;
  to: string;
  current: boolean;
  /** Период ещё идёт — сравнение с полным прошлым. */
  partial: boolean;
}

export interface NewsDynamicsMetric {
  id: string;
  /** ok — посчитано; unavailable — не смогли (источник); filtered_out — тип снят фильтром. */
  state: 'ok' | 'unavailable' | 'filtered_out' | string;
  value: number | null;
  previous?: number;
  delta?: number;
  /** Δ % к прошлому периоду; null — прошлый период 0 (процента нет). */
  pct?: number | null;
  series: number[] | null;
  /** «Принято»: раскладка ряда по типу (adr / decision). */
  by_type?: Record<string, number[]>;
  /** Исключённое в окне ряда — по причине (bookkeeping, born_done, moment_unknown). */
  excluded?: Record<string, number>;
  reason?: string;
  forbidden?: boolean;
}

export interface NewsDynamicsResponse {
  buckets: NewsDynamicsBucket[];
  metrics: NewsDynamicsMetric[];
  meta: {
    form_version?: string;
    generated_at?: string;
    period?: NewsDynamicsPeriod;
    compare?: 'week_over_week' | 'month_over_month' | string;
    tz?: string;
    state?: string;
    errors?: Array<{ source: string; error: string; critical?: boolean; forbidden?: boolean }>;
    /** Фильтры события (author, who, kind, els) — к объёму не применимы, сервер их называет. */
    ignored_filters?: string[];
    [k: string]: unknown;
  };
}

/** Проверка формы: без метрик или периодов ответ — ошибка, а не «пустая динамика». */
export function parseDynamicsResponse(raw: unknown): NewsDynamicsResponse {
  const r = raw as Partial<NewsDynamicsResponse> | null;
  if (!r || !Array.isArray(r.metrics) || !Array.isArray(r.buckets) || typeof r.meta !== 'object' || r.meta === null) {
    throw new Error('news/v2/dynamics: неожиданная форма ответа (нет metrics/buckets/meta)');
  }
  return r as NewsDynamicsResponse;
}

/** Параметры запроса: период и фильтры ленты (тот же разрез, что у ленты, плюс фиксированный скоуп). */
export function dynamicsParams(q: NewsQuery, period: NewsDynamicsPeriod, scope?: NewsScope): URLSearchParams {
  const p = new URLSearchParams();
  p.set('period', period);
  const filters: Partial<Record<string, string[]>> = { ...q.filters };
  for (const [k, v] of Object.entries(scope ?? {})) {
    if (k !== 'release' && v) filters[k] = [v];
  }
  for (const ax of NEWS_FILTER_AXES) {
    const vs = filters[ax];
    if (vs && vs.length) p.set(ax, vs.join(','));
  }
  const els = scope?.release ? [`release:${scope.release}`] : q.els;
  if (els.length) p.set('els', els.join(','));
  return p;
}

// ── фикстура по контракту (локальные прогоны без сервера и тесты) ──

const WEEKS = ['W35', 'W36', 'W37', 'W38', 'W39', 'W40', 'W41', 'W42', 'W43', 'W44', 'W45', 'W46'];

function weekBuckets(): NewsDynamicsBucket[] {
  const start = Date.UTC(2026, 7, 24); // пн 24.08.2026 — W35
  return WEEKS.map((label, i) => ({
    key: `2026-${label}`,
    label,
    from: new Date(start + i * 7 * 86400000).toISOString().replace('.000', ''),
    to: new Date(start + (i + 1) * 7 * 86400000).toISOString().replace('.000', ''),
    current: i === WEEKS.length - 1,
    partial: i === WEEKS.length - 1,
  }));
}

function ok(id: string, series: number[], extra: Partial<NewsDynamicsMetric> = {}): NewsDynamicsMetric {
  const value = series[series.length - 1], previous = series[series.length - 2];
  return {
    id, state: 'ok', value, previous, delta: value - previous,
    pct: previous === 0 ? null : Math.round(((value - previous) * 1000) / previous) / 10,
    series, excluded: {}, ...extra,
  };
}

export const NEWS_DYNAMICS_FIXTURE: NewsDynamicsResponse = {
  buckets: weekBuckets(),
  metrics: [
    ok('tasks_closed', [5, 7, 4, 9, 11, 6, 10, 14, 9, 13, 8, 12], { excluded: { bookkeeping: 3, born_done: 1 } }),
    ok('tasks_created', [9, 6, 8, 12, 10, 7, 15, 11, 9, 10, 12, 9]),
    ok('sprints_closed', [1, 0, 2, 1, 0, 3, 1, 2, 0, 1, 2, 1]),
    ok('releases', [0, 1, 0, 0, 2, 0, 1, 0, 1, 1, 0, 2]),
    ok('accepted', [2, 1, 3, 0, 4, 2, 1, 5, 2, 3, 3, 4], {
      by_type: { adr: [1, 0, 1, 0, 1, 1, 0, 2, 1, 1, 1, 1], decision: [1, 1, 2, 0, 3, 1, 1, 3, 1, 2, 2, 3] },
      excluded: { moment_unknown: 2 },
    }),
  ],
  meta: {
    form_version: 'news-dynamics/1.0', generated_at: '2026-11-12T10:00:00Z', period: 'week',
    compare: 'week_over_week', tz: 'UTC', state: 'ok', errors: [], ignored_filters: [],
  },
};
