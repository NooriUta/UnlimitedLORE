import { describe, it, expect } from 'vitest';
import { ratioPct, median, channelCtrMedians, benchmarkArrow } from './bragiAnalytics';

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
