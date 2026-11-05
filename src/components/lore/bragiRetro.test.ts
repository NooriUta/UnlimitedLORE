import { describe, it, expect } from 'vitest';
import { inPeriod, groupRetro, sparkSeries } from './bragiRetro';

// V2-06 (ТЗ: SPRINT_BRAGI_ARCHIVE_IMPL/ANA-04): ретро-вью — период, группировка
// канал/рубрика с подытогами, спарклайны из TIMESERIES.

describe('inPeriod', () => {
  it('границы включительно; пустая граница — без ограничения', () => {
    expect(inPeriod('2026-10-01', '2026-10-01', '2026-10-31')).toBe(true);
    expect(inPeriod('2026-10-31T18:00:00Z', '2026-10-01', '2026-10-31')).toBe(true);
    expect(inPeriod('2026-11-01', '2026-10-01', '2026-10-31')).toBe(false);
    expect(inPeriod('2026-09-30', '2026-10-01', '')).toBe(false);
    expect(inPeriod('2020-01-01', '', '')).toBe(true);
  });
});

describe('groupRetro', () => {
  const rows = [
    { key: 'tg', views: 100, clicks: 10, demo: 1 },
    { key: 'tg', views: 50, clicks: null, demo: null },
    { key: null, views: 10, clicks: 1, demo: 0 },
    { key: 'vc', views: null, clicks: null, demo: null },
  ];
  it('подытог — сумма известных; CTR — из сумм, а не среднее долей', () => {
    const g = groupRetro(rows, r => r.key);
    const tg = g.find(x => x.key === 'tg')!;
    expect(tg.count).toBe(2);
    expect(tg.views).toBe(150);
    expect(tg.clicks).toBe(10);
    expect(tg.ctr).toBeCloseTo((10 / 100) * 100);   // CTR по строкам, где известны обе цифры
  });
  it('группа без единого замера — null, а не 0', () => {
    const vc = groupRetro(rows, r => r.key).find(x => x.key === 'vc')!;
    expect(vc.views).toBeNull();
    expect(vc.ctr).toBeNull();
  });
  it('строки без ключа — своя группа «—» (ключ null), не теряются', () => {
    const g = groupRetro(rows, r => r.key);
    expect(g.find(x => x.key === null)?.count).toBe(1);
    expect(g.reduce((s, x) => s + x.count, 0)).toBe(rows.length);
  });
});

describe('sparkSeries', () => {
  it('накопительные снимки двух объектов: в каждой точке сумма последних известных', () => {
    const variant = [{ metric: 'views', value: 10, ts: '2026-10-01T00:00:00Z' }, { metric: 'views', value: 30, ts: '2026-10-03T00:00:00Z' }];
    const pub = [{ metric: 'views', value: 5, ts: '2026-10-02T00:00:00Z' }, { metric: 'clicks', value: 9, ts: '2026-10-02T00:00:00Z' }];
    expect(sparkSeries([variant, pub], 'views')).toEqual([10, 15, 35]);
  });
  it('нет точек — пустой ряд (спарклайн не рисуется)', () => {
    expect(sparkSeries([[], []], 'views')).toEqual([]);
  });
});
