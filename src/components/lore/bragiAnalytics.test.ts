import { describe, it, expect } from 'vitest';
import { ratioPct, median, channelCtrMedians, benchmarkArrow, snapshotValue } from './bragiAnalytics';

// V2-04: точка MetricSnapshot для views/clicks/demo_conv — НАКОПИТЕЛЬНЫЙ снимок
// («всего к моменту ts»): так пишут оба живых источника (скриншот счётчика,
// отчёт Метрики). Значит «за всё время» = последний снимок, окно 72 ч / 7 д =
// последний снимок не позже published_at + окна. Сумма точек — ошибка: второй
// замер того же объекта задваивал цифру.
describe('snapshotValue', () => {
  const pts = [
    { metric: 'views', value: 10, ts: '2026-07-01T12:00:00Z' },
    { metric: 'views', value: 40, ts: '2026-07-03T10:00:00Z' },
    { metric: 'views', value: 90, ts: '2026-07-20T09:00:00Z' },
    { metric: 'clicks', value: 3, ts: '2026-07-02T09:00:00Z' },
  ];
  const pub = '2026-07-01T09:00:00Z';

  it('за всё время — последний снимок, а не сумма', () => {
    expect(snapshotValue(pts, 'views', pub, null)).toEqual({ value: 90, points: 3 });
  });

  it('окно 72 ч — последний снимок не позже published_at + 72 ч', () => {
    expect(snapshotValue(pts, 'views', pub, 72)).toEqual({ value: 40, points: 2 });
  });

  it('окно 7 д', () => {
    expect(snapshotValue(pts, 'views', pub, 24 * 7)).toEqual({ value: 40, points: 2 });
  });

  it('в окне нет ни одного снимка — null («мало точек»), а не 0', () => {
    expect(snapshotValue([{ metric: 'views', value: 5, ts: '2026-07-10T00:00:00Z' }], 'views', pub, 72))
      .toEqual({ value: null, points: 0 });
  });

  it('метрики нет вовсе — null, не 0', () => {
    expect(snapshotValue(pts, 'demo_conv', pub, null)).toEqual({ value: null, points: 0 });
  });

  it('порядок точек на входе не важен', () => {
    expect(snapshotValue([...pts].reverse(), 'views', pub, null).value).toBe(90);
  });

  it('дата публикации без времени — окно от начала дня (UTC)', () => {
    expect(snapshotValue(pts, 'views', '2026-07-01', 72).value).toBe(40);
  });

  it('у окна нет даты публикации — честное «не посчитать», а не lifetime', () => {
    expect(snapshotValue(pts, 'views', null, 72)).toEqual({ value: null, points: 0 });
  });
});

// V2-03: CTR/демо-rate + медиана канала. Негативные кейсы (деление на ноль,
// пустой массив, единственный замер) несут основную нагрузку — вычислить
// правильное число легко, не сломать его при нуле знаменателя — вот проверка.
describe('ratioPct', () => {
  it('считает долю в процентах', () => {
    expect(ratioPct(41, 320)).toBeCloseTo(12.8125, 4);
  });

  it('ноль знаменателя — null, не Infinity/NaN', () => {
    expect(ratioPct(5, 0)).toBeNull();
  });

  it('ноль числителя при живом знаменателе — честный 0, не null', () => {
    expect(ratioPct(0, 100)).toBe(0);
  });
});

describe('median', () => {
  it('нечётное количество — средний элемент', () => {
    expect(median([1, 3, 2])).toBe(2);
  });

  it('чётное количество — среднее двух центральных', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('пустой массив — null, не 0', () => {
    expect(median([])).toBeNull();
  });

  it('один элемент — он и есть медиана', () => {
    expect(median([7])).toBe(7);
  });
});

describe('channelCtrMedians', () => {
  it('считает медиану CTR отдельно по каждому каналу', () => {
    const m = channelCtrMedians([
      { channel: 'CH-TG', ctr: 10 },
      { channel: 'CH-TG', ctr: 20 },
      { channel: 'CH-VC', ctr: 5 },
    ]);
    expect(m.get('CH-TG')).toBe(15);
    expect(m.get('CH-VC')).toBe(5);
  });

  it('строки без канала или без CTR (views=0) не искажают медиану', () => {
    const m = channelCtrMedians([
      { channel: 'CH-TG', ctr: 10 },
      { channel: null, ctr: 999 },
      { channel: 'CH-TG', ctr: null },
    ]);
    expect(m.get('CH-TG')).toBe(10);
    expect(m.size).toBe(1);
  });
});

describe('benchmarkArrow', () => {
  it('выше медианы — ▲', () => {
    expect(benchmarkArrow(15, 10)).toBe('▲');
  });

  it('ниже медианы — ▼', () => {
    expect(benchmarkArrow(5, 10)).toBe('▼');
  });

  it('равно медиане — без стрелки', () => {
    expect(benchmarkArrow(10, 10)).toBeNull();
  });

  it('нет значения или нет медианы канала — без стрелки, не ложная ▼', () => {
    expect(benchmarkArrow(null, 10)).toBeNull();
    expect(benchmarkArrow(10, undefined)).toBeNull();
  });
});
