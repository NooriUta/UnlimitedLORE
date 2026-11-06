import { describe, expect, it } from 'vitest';
import { reengLoadOf } from './reengLoad';

// SPRINT_LORE_PRODUCT_BACKLOG/AN-06 · срез I: возврат к выпущенному сценарию =
// uc-задача, заведённая ПОСЛЕ shipped_at. Длительность — от заведения до закрытия,
// для открытых — возраст на сегодня.
describe('reengLoadOf', () => {
  const today = '2026-11-06';
  const row = (o: Partial<Parameters<typeof reengLoadOf>[0][number]>) => ({
    task_uid: 'S/T', uc_id: 'UC-A', uc_title: 'A', uc_status: 'shipped', shipped_at: '2026-08-04',
    state_dates: ['2026-08-10 10:00:00.000'], status_raw: '📋 PLANNED', status_since: '2026-08-10 10:00:00.000',
    ...o,
  });

  it('задачи до выпуска — не переделка', () => {
    const r = reengLoadOf([row({ state_dates: ['2026-07-02 17:35:05.316', '2026-07-02 17:37:15.370'], status_raw: '✅ DONE' })], today);
    expect(r.ucs).toHaveLength(0);
    expect(r.shippedSeen).toBe(1);
  });

  it('закрытая задача после выпуска — эпизод с длительностью в днях', () => {
    const r = reengLoadOf([row({
      state_dates: ['2026-08-20 09:00:00.000', '2026-08-10 10:00:00.000'],
      status_raw: '✅ DONE', status_since: '2026-08-20 09:00:00.000',
    })], today);
    expect(r.ucs).toHaveLength(1);
    expect(r.ucs[0]).toMatchObject({ uc_id: 'UC-A', tasks: 1, open: 0, closedDays: [10] });
    expect(r.medianClosedDays).toBe(10);
  });

  it('открытая задача после выпуска — возраст на сегодня', () => {
    const r = reengLoadOf([row({})], today);
    expect(r.ucs[0]).toMatchObject({ tasks: 1, open: 1, oldestOpenDays: 88 });
  });

  it('сводка: сколько выпущенных ушло в переделку из виденных', () => {
    const r = reengLoadOf([
      row({}),
      row({ task_uid: 'S/T2', uc_id: 'UC-B', state_dates: ['2026-07-01 00:00:00.000'] }),
    ], today);
    expect(r.shippedSeen).toBe(2);
    expect(r.ucs.map(u => u.uc_id)).toEqual(['UC-A']);
  });

  it('отменённая задача — не переделка и не открытая работа', () => {
    const r = reengLoadOf([row({ status_raw: '🚫 CANCELLED', status_since: '2026-08-12 10:00:00.000' })], today);
    expect(r.ucs).toHaveLength(0);
    expect(r.cancelled).toBe(1);
  });

  it('статус in_rework без открытой переделки называется расхождением, а не прячется', () => {
    const r = reengLoadOf([
      row({ uc_status: 'in_rework', status_raw: '🚫 CANCELLED' }),
      row({ task_uid: 'S/T2', uc_id: 'UC-B', uc_status: 'in_rework' }),
    ], today);
    expect(r.reworkWithoutOpen).toEqual(['UC-A']);
  });

  it('строка без дат — не теряется молча, а считается непроверяемой', () => {
    const r = reengLoadOf([row({ state_dates: null })], today);
    expect(r.ucs).toHaveLength(0);
    expect(r.undated).toBe(1);
  });
});
