// V2-06 (ТЗ: SPRINT_BRAGI_ARCHIVE_IMPL/ANA-04): ретро-вью — период, группировка
// канал/рубрика с подытогами, спарклайны из TIMESERIES. Чистые функции; UI их
// только рисует.

import { ratioPct } from './bragiAnalytics';

const day = (s: string) => s.slice(0, 10);

/** Дата публикации внутри [from, to] (дни, включительно). Пустая граница — без ограничения. */
export function inPeriod(publishedAt: string, from: string, to: string): boolean {
  const d = day(publishedAt);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

type Nums = { views: number | null; clicks: number | null; demo: number | null };

export interface RetroGroup {
  key: string | null;
  count: number;
  views: number | null;
  clicks: number | null;
  demo: number | null;
  /** CTR группы — из сумм по строкам, где известны И просмотры, И переходы; не среднее долей. */
  ctr: number | null;
}

const sumKnown = (vals: (number | null)[]) => {
  const k = vals.filter((v): v is number => v !== null);
  return k.length === 0 ? null : k.reduce((s, v) => s + v, 0);
};

/**
 * Подытоги по группам. Сумма — только известных значений; ни одного замера в
 * группе — null, не 0 (тот же принцип, что «мало точек» у строки). Порядок групп —
 * по первому появлению, строки без ключа — своя группа (key null), не теряются.
 */
export function groupRetro<R extends Nums>(rows: readonly R[], keyOf: (r: R) => string | null): RetroGroup[] {
  const order: (string | null)[] = [];
  const by = new Map<string | null, R[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!by.has(k)) { by.set(k, []); order.push(k); }
    by.get(k)!.push(r);
  }
  return order.map(k => {
    const g = by.get(k)!;
    const both = g.filter(r => r.views !== null && r.clicks !== null);
    const v = sumKnown(both.map(r => r.views)), c = sumKnown(both.map(r => r.clicks));
    return {
      key: k, count: g.length,
      views: sumKnown(g.map(r => r.views)),
      clicks: sumKnown(g.map(r => r.clicks)),
      demo: sumKnown(g.map(r => r.demo)),
      ctr: v === null || c === null ? null : ratioPct(c, v),
    };
  });
}

/**
 * Ряд для спарклайна: снимки метрики нескольких объектов (вариация, публикация)
 * накопительные, поэтому в каждой точке времени — сумма ПОСЛЕДНИХ известных
 * значений каждого объекта, а не сумма точек.
 */
export function sparkSeries(
  objects: readonly (readonly { metric: string; value: number; ts: string }[])[],
  metric: string,
): number[] {
  const events = objects.flatMap((pts, obj) => pts
    .filter(p => p.metric === metric)
    .map(p => ({ obj, v: p.value, t: Date.parse(p.ts) }))
    .filter(p => !Number.isNaN(p.t)));
  events.sort((a, b) => a.t - b.t);
  const last = new Map<number, number>();
  return events.map(e => {
    last.set(e.obj, e.v);
    let s = 0;
    for (const v of last.values()) s += v;
    return s;
  });
}
