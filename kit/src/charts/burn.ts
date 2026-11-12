// Burnup/burndown спринта (SPRINT_UXR_S5_RECORD_TASKS/S5-03): ряд по дням из
// тех же сырых срезов, что у v1 (src/components/lore/sprintBurndown.ts):
// task_created_dates — строки SCD2-истории (создание = min valid_from по задаче),
// task_done_dates — текущее done-состояние. Принадлежность спринту — по префиксу
// task_uid «SPRINT_X/» с косой чертой: иначе SPRINT_X цеплял бы SPRINT_X2.
//
// Отличия от v1 (там остаток мог уйти в минус):
//   - закрытая задача без строки создания входит в объём днём закрытия;
//   - закрытие раньше создания (кривая история) считается днём создания.

export interface BurnRow { task_uid: string | null; valid_from: string | null }
export interface BurnPoint { date: string; scope: number; done: number; remaining: number }
export interface BurnSummary { scope: number; done: number; remaining: number; peak: number; from: string; to: string }
export type BurnMode = 'burnup' | 'burndown';

export function burnSeries(created: readonly BurnRow[], done: readonly BurnRow[], sprintId: string): BurnPoint[] {
  const prefix = `${sprintId}/`;
  const day = (v: string) => v.slice(0, 10);
  const born = new Map<string, string>();
  for (const r of created) {
    if (!r.task_uid?.startsWith(prefix) || !r.valid_from) continue;
    const d = day(r.valid_from);
    const cur = born.get(r.task_uid);
    if (!cur || d < cur) born.set(r.task_uid, d);
  }
  const closed = new Map<string, string>();
  for (const r of done) {
    if (!r.task_uid?.startsWith(prefix) || !r.valid_from) continue;
    closed.set(r.task_uid, day(r.valid_from));
  }

  const delta = new Map<string, { s: number; d: number }>();
  const bump = (d: string, key: 's' | 'd') => {
    const e = delta.get(d) ?? { s: 0, d: 0 };
    e[key]++;
    delta.set(d, e);
  };
  for (const [uid, d] of closed) {
    const b = born.get(uid);
    if (!b) born.set(uid, d);
    bump(b && d < b ? b : d, 'd');
  }
  for (const d of born.values()) bump(d, 's');

  let scope = 0, doneN = 0;
  return [...delta.keys()].sort().map(date => {
    scope += delta.get(date)!.s;
    doneN += delta.get(date)!.d;
    return { date, scope, done: doneN, remaining: scope - doneN };
  });
}

export function burnSummary(points: readonly BurnPoint[]): BurnSummary | null {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  return {
    scope: last.scope,
    done: last.done,
    remaining: last.remaining,
    peak: Math.max(...points.map(p => p.remaining)),
    from: points[0].date,
    to: last.date,
  };
}

/** Идеальная линия burndown: от остатка первого дня до нуля к последнему. */
export function burnIdeal(points: readonly BurnPoint[]): { date: string; value: number }[] {
  if (points.length === 0) return [];
  return [
    { date: points[0].date, value: points[0].remaining },
    { date: points[points.length - 1].date, value: 0 },
  ];
}

/** Точка прогноза приложения: сколько будет закрыто к дате (K2-VIEW-TARGET). */
export interface BurnForecastPoint { date: string; done: number }
/** Вердикт приложения словами и тоном: успеваем · под риском · не успеваем. */
export interface BurnVerdict { tone: 'ok' | 'risk' | 'late'; text: string }

/**
 * Ряд по родителю — сумма рядов частей (веха = её спринты, K2-VIEW-TARGET).
 * На каждую дату любой части берётся последнее известное значение КАЖДОЙ части:
 * часть, у которой в этот день событий не было, не «обнуляется».
 */
export function burnSum(series: readonly (readonly BurnPoint[])[]): BurnPoint[] {
  const dates = [...new Set(series.flatMap(s => s.map(p => p.date)))].sort();
  const idx = series.map(() => -1);
  return dates.map(date => {
    let scope = 0, done = 0;
    series.forEach((s, i) => {
      while (idx[i] + 1 < s.length && s[idx[i] + 1].date <= date) idx[i]++;
      if (idx[i] >= 0) { scope += s[idx[i]].scope; done += s[idx[i]].done; }
    });
    return { date, scope, done, remaining: scope - done };
  });
}
