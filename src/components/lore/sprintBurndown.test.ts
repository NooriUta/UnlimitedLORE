import { describe, expect, it } from 'vitest';
import { sprintBurndown } from './sprintBurndown';

const S = 'SPRINT_X';
const row = (uid: string, valid_from: string) => ({ task_uid: uid, valid_from });

describe('sprintBurndown — остаток задач спринта по дням', () => {
  it('создание = min valid_from по задаче; остаток = заведено − закрыто', () => {
    const created = [
      row(`${S}/T-1`, '2026-09-01T10:00:00Z'), row(`${S}/T-1`, '2026-09-03T10:00:00Z'), // SCD2: берём min
      row(`${S}/T-2`, '2026-09-01T11:00:00Z'),
      row(`${S}/T-3`, '2026-09-02T09:00:00Z'),
      row('SPRINT_OTHER/T-1', '2026-09-01T09:00:00Z'), // чужой спринт — не считается
    ];
    const done = [row(`${S}/T-1`, '2026-09-02T12:00:00Z'), row(`${S}/T-2`, '2026-09-04T12:00:00Z')];
    expect(sprintBurndown(created, done, S)).toEqual([
      { date: '2026-09-01', scope: 2, done: 0, remaining: 2 },
      { date: '2026-09-02', scope: 3, done: 1, remaining: 2 },
      { date: '2026-09-04', scope: 3, done: 2, remaining: 1 },
    ]);
  });
  it('префикс спринта не цепляет спринт с похожим именем', () => {
    expect(sprintBurndown([row('SPRINT_X2/T-1', '2026-09-01')], [], S)).toEqual([]);
  });
  it('нет задач — пустой ряд, а не падение', () => {
    expect(sprintBurndown([], [], S)).toEqual([]);
  });
});
