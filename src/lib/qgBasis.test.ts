// SPRINT_QG_REBUILD/QG-07 — честный baseline. Метрика прогона несёт «базу» (отпечаток знаменателя:
// состав выборки, фильтр, LIMIT). Сравнивать значение с прошлым прогоном можно только при той же базе;
// база сменилась — ряд разрывается с пометкой «база пересчитана», а не рисует «падение».
// Повод: task_done_pct_avg «упала» 99.1% → 78.1% — была выборка LIMIT 15, стала из 357 групп.
import { describe, expect, it } from 'vitest';
import { normBasis, comparable, metricChange, currentBasisSegment } from './qgBasis';

describe('qgBasis', () => {
  it('пустая база — нет базы', () => {
    expect(normBasis(null)).toBeNull();
    expect(normBasis(undefined)).toBeNull();
    expect(normBasis('   ')).toBeNull();
    expect(normBasis(' groups=15 ')).toBe('groups=15');
  });

  it('сравнимо только при той же базе; две пустые — прежнее поведение', () => {
    expect(comparable('groups=15', 'groups=15')).toBe(true);
    expect(comparable(null, undefined)).toBe(true);
    expect(comparable('groups=15', 'groups=357')).toBe(false);
    // появилась или пропала база — это тоже смена выборки, а не «то же самое»
    expect(comparable(null, 'groups=357')).toBe(false);
    expect(comparable('groups=15', null)).toBe(false);
  });

  it('смена базы — разрыв, а не смена статуса (повод задачи)', () => {
    const prev = { status: 'PASS', value: 99.1, basis: 'groups=15' };
    const cur = { status: 'FAIL', value: 78.1, basis: 'groups=357' };
    expect(metricChange(prev, cur)).toEqual({ kind: 'rebased', prevBasis: 'groups=15', curBasis: 'groups=357' });
  });

  it('положительный контроль: при той же базе смена статуса видна как прежде', () => {
    expect(metricChange({ status: 'PASS', basis: 'b' }, { status: 'FAIL', basis: 'b' }))
      .toEqual({ kind: 'status', prev: 'PASS', cur: 'FAIL' });
    expect(metricChange({ status: 'PASS' }, { status: 'FAIL' }))
      .toEqual({ kind: 'status', prev: 'PASS', cur: 'FAIL' });
    expect(metricChange({ status: 'PASS', basis: 'b' }, { status: 'PASS', basis: 'b' })).toBeNull();
    expect(metricChange(undefined, { status: 'PASS' })).toBeNull();
  });

  it('ряд для динамики — только хвост на текущей базе', () => {
    const hist = [
      { v: 99, status: 'PASS', basis: 'groups=15' },
      { v: 99.1, status: 'PASS', basis: 'groups=15' },
      { v: 78.1, status: 'FAIL', basis: 'groups=357' },
      { v: 78.4, status: 'FAIL', basis: 'groups=357' },
    ];
    const seg = currentBasisSegment(hist);
    expect(seg.points.map(p => p.v)).toEqual([78.1, 78.4]);
    expect(seg.rebased).toBe(true);
    const same = currentBasisSegment(hist.slice(0, 2));
    expect(same.points).toHaveLength(2);
    expect(same.rebased).toBe(false);
    expect(currentBasisSegment([]).points).toEqual([]);
  });
});
