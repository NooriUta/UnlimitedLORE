import { describe, it, expect } from 'vitest';
import { nextInsightId, insightEvidence, insightsOfRow } from './bragiInsight';

// V2-05 (ТЗ: SPRINT_BRAGI_ARCHIVE_IMPL/ANA-03): вывод из ретро фиксируется в два
// клика — id и обоснование подставляются сами, чип виден в строке.

describe('nextInsightId', () => {
  it('следующий после наибольшего, с ведущим нулём', () => {
    expect(nextInsightId(['INS-01', 'INS-03', 'INS-02'])).toBe('INS-04');
  });
  it('пустой корпус — INS-01', () => {
    expect(nextInsightId([])).toBe('INS-01');
  });
  it('чужие форматы не сбивают счёт и не занимают номер', () => {
    expect(nextInsightId(['INS-09', 'insight-x', 'INS-7a'])).toBe('INS-10');
  });
  it('за 99 — три цифры, без коллизии', () => {
    expect(nextInsightId(['INS-99'])).toBe('INS-100');
  });
});

describe('insightEvidence', () => {
  it('объект, метрики и окно — тем, что видно в строке', () => {
    expect(insightEvidence({ variant_id: 'VAR-12', views: 340, clicks: 17, demo: 2 }, 72))
      .toBe('VAR-12 · views 340 · clicks 17 · demo_conv 2 · окно 72 ч от публикации');
  });
  it('нет замера в окне — «нет замера», а не 0', () => {
    expect(insightEvidence({ variant_id: 'VAR-1', views: null, clicks: 3, demo: null }, null))
      .toBe('VAR-1 · views нет замера · clicks 3 · demo_conv нет замера · за всё время');
  });
});

describe('insightsOfRow', () => {
  const ins = [
    { insight_id: 'INS-01', subject_id: 'VAR-1' },
    { insight_id: 'INS-02', subject_id: 'PUB-1' },
    { insight_id: 'INS-03', subject_id: null },
    { insight_id: 'INS-04', subject_id: 'VAR-10' },
  ];
  it('строке принадлежат инсайты её вариации и её публикации — по точному id', () => {
    expect(insightsOfRow(ins, 'VAR-1', 'PUB-1')).toEqual(['INS-01', 'INS-02']);
  });
  it('префикс id не совпадение (VAR-1 ≠ VAR-10)', () => {
    expect(insightsOfRow(ins, 'VAR-10', null)).toEqual(['INS-04']);
  });
});
