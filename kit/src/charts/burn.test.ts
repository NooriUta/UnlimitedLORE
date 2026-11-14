// SPRINT_UXR_S5_RECORD_TASKS/S5-03 — ряд burnup/burndown спринта: чистая
// функция над сырыми срезами task_created_dates / task_done_dates.
import { describe, expect, it } from 'vitest';
import { burnIdeal, burnSeries, burnSummary } from './burn';
/** Принадлежность группе задаёт приложение (K-14); здесь — «спринт S» в формате LORE. */
const inS = (uid: string) => uid.startsWith('S/');

const C = (task_uid: string | null, valid_from: string | null) => ({ task_uid, valid_from });

describe('burnSeries — остаток/объём/закрыто по дням', () => {
  it('накопительно по дням, сортировка по дате', () => {
    const pts = burnSeries(
      [C('S/A', '2026-11-01T10:00'), C('S/B', '2026-11-01T11:00'), C('S/C', '2026-11-03')],
      [C('S/A', '2026-11-02T09:00')],
      inS,
    );
    expect(pts).toEqual([
      { date: '2026-11-01', scope: 2, done: 0, remaining: 2 },
      { date: '2026-11-02', scope: 2, done: 1, remaining: 1 },
      { date: '2026-11-03', scope: 3, done: 1, remaining: 2 },
    ]);
  });

  it('создание = самая ранняя строка истории задачи (SCD2), повторы не множат объём', () => {
    const pts = burnSeries([C('S/A', '2026-11-05'), C('S/A', '2026-11-01'), C('S/A', '2026-11-03')], [], inS);
    expect(pts).toEqual([{ date: '2026-11-01', scope: 1, done: 0, remaining: 1 }]);
  });

  it('принадлежность спринту — по префиксу с косой чертой: S не цепляет S2', () => {
    const pts = burnSeries(
      [C('S/A', '2026-11-01'), C('S2/B', '2026-11-01'), C(null, '2026-11-01'), C('S/X', null)],
      [C('S2/B', '2026-11-02')],
      inS,
    );
    expect(pts).toEqual([{ date: '2026-11-01', scope: 1, done: 0, remaining: 1 }]);
  });

  it('закрытая задача без строки создания всё равно входит в объём — остаток не уходит в минус', () => {
    const pts = burnSeries([C('S/A', '2026-11-01')], [C('S/B', '2026-11-02')], inS);
    expect(pts[pts.length - 1]).toEqual({ date: '2026-11-02', scope: 2, done: 1, remaining: 1 });
    expect(pts.every(p => p.remaining >= 0)).toBe(true);
  });

  it('закрытие раньше создания (кривая история) — считается днём создания', () => {
    const pts = burnSeries([C('S/A', '2026-11-03')], [C('S/A', '2026-11-01')], inS);
    expect(pts).toEqual([{ date: '2026-11-03', scope: 1, done: 1, remaining: 0 }]);
  });

  it('пустые срезы — пустой ряд', () => {
    expect(burnSeries([], [], inS)).toEqual([]);
  });
});

describe('burnSummary / burnIdeal', () => {
  const pts = burnSeries(
    [C('S/A', '2026-11-01'), C('S/B', '2026-11-01'), C('S/C', '2026-11-02'), C('S/D', '2026-11-02')],
    [C('S/A', '2026-11-03'), C('S/B', '2026-11-05')],
    inS,
  );

  it('итог: последний день + пик остатка', () => {
    expect(burnSummary(pts)).toEqual({ scope: 4, done: 2, remaining: 2, peak: 4, from: '2026-11-01', to: '2026-11-05' });
    expect(burnSummary([])).toBeNull();
  });

  it('идеальная линия burndown: от первого остатка до нуля к последнему дню', () => {
    expect(burnIdeal(pts)).toEqual([{ date: '2026-11-01', value: 2 }, { date: '2026-11-05', value: 0 }]);
    expect(burnIdeal([])).toEqual([]);
  });
});
