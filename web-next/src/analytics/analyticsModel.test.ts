// K4-CHARTS, первая поставка: расчёты вкладок «Прогресс» и «Поток» (перенос v1 LoreAnalytics).
import { describe, expect, it } from 'vitest';
import { burnup, firstDates, lastWeeks, leadTime, perWeek, throughput, velocity, weekLabel, weekStart } from './analyticsModel';

const TODAY = Date.parse('2026-11-16T12:00:00Z'); // понедельник
const W = lastWeeks(3, TODAY); // 02.11, 09.11, 16.11

describe('недели', () => {
  it('неделя — с понедельника (UTC); окно — последние N недель по возрастанию', () => {
    expect(new Date(weekStart(Date.parse('2026-11-15T23:00:00Z'))).toISOString().slice(0, 10)).toBe('2026-11-09');
    expect(W.map(weekLabel)).toEqual(['02.11', '09.11', '16.11']);
  });
  it('неделя без событий — честный 0; события вне окна не считаются', () => {
    expect(perWeek([Date.parse('2026-11-03'), Date.parse('2026-11-04'), Date.parse('2026-10-01')], W)).toEqual([2, 0, 0]);
  });
});

describe('Velocity и Throughput', () => {
  it('velocity — спринтов закрыто за неделю', () => {
    const v = velocity([{ done_date: '2026-11-03' }, { done_date: '2026-11-10T08:00:00Z' }, { done_date: null }], W);
    expect(v.map(b => b.values.v)).toEqual([1, 1, 0]);
  });
  it('throughput — задача считается один раз, по первому закрытию', () => {
    const t = throughput([{ task_uid: 'S/1', valid_from: '2026-11-10' }, { task_uid: 'S/1', valid_from: '2026-11-17' }, { task_uid: 'S/2', valid_from: '2026-11-17' }, { valid_from: '2026-11-17' }], W);
    expect(t.map(b => b.values.t)).toEqual([0, 1, 1]);
  });
});

describe('Burnup и Lead time', () => {
  const created = [{ task_uid: 'S/1', valid_from: '2026-10-20' }, { task_uid: 'S/2', valid_from: '2026-11-04' }, { task_uid: 'S/3', valid_from: '2026-11-12' }];
  const done = [{ task_uid: 'S/1', valid_from: '2026-11-05' }, { task_uid: 'S/2', valid_from: '2026-11-13' }];
  it('burnup — накопленно на конец недели: объём и сделано', () => {
    const b = burnup(created, done, W);
    expect(b.scope.map(p => p.y)).toEqual([2, 3, 3]);
    expect(b.done.map(p => p.y)).toEqual([1, 2, 2]);
  });
  it('lead time — дней от появления до закрытия; без даты появления точки нет', () => {
    const l = leadTime(created, [...done, { task_uid: 'S/9', valid_from: '2026-11-10' }], W);
    expect(l.map(p => [p.id, p.y])).toEqual([['S/1', 16], ['S/2', 9]]);
  });
  it('первое появление — самая ранняя дата задачи', () => {
    expect(firstDates([{ task_uid: 'A', valid_from: '2026-11-10' }, { task_uid: 'A', valid_from: '2026-11-01' }]).get('A')).toBe(Date.parse('2026-11-01T00:00:00Z'));
  });
});
