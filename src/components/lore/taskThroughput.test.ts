import { describe, expect, it } from 'vitest';
import { taskThroughputOf, TASK_THROUGHPUT_CUTOFF } from './taskThroughput';

// SPRINT_LORE_MEASURE_TRUTH/MT-CAL-BOOKKEEPING: записи задним числом (флаг
// bookkeeping) не считаются закрытием за неделю — их done_date есть дата
// простановки статуса, а не работы. Исключённое называется числом.
describe('taskThroughputOf', () => {
  const day = '2026-11-04T10:00:00Z';

  it('считает реальные закрытия по неделям', () => {
    const r = taskThroughputOf([
      { valid_from: day, states: 3 },
      { valid_from: day, states: [2] },
    ]);
    expect(r.counted).toBe(2);
    expect(r.weeks).toHaveLength(1);
    expect(r.bookkeepingExcluded).toBe(0);
  });

  it('исключает записи задним числом и говорит, сколько исключено', () => {
    const r = taskThroughputOf([
      { valid_from: day, states: 3 },
      { valid_from: day, states: 3, bookkeeping: true },
      { valid_from: day, states: 3, bookkeeping: [true] },
      { valid_from: day, states: 3, bookkeeping: false },
    ]);
    expect(r.counted).toBe(2);
    expect(r.bookkeepingExcluded).toBe(2);
  });

  it('прежние отсечки на месте: эпоха импорта и «рождённые done»', () => {
    const r = taskThroughputOf([
      { valid_from: '2026-06-01T00:00:00Z', states: 3 },
      { valid_from: day, states: 1 },
      { valid_from: 'garbage', states: 3 },
    ]);
    expect(r.counted).toBe(0);
    expect(TASK_THROUGHPUT_CUTOFF).toBe('2026-06-12');
  });
});
