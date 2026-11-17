// Расчёты раздела «Аналитика» (SPRINT_UXR_S13_KIT4/K4-CHARTS, первая поставка — «Прогресс», «Поток»,
// «Моя сводка»; прототип analytics-my-summary.html, «ок по графикам» владелицы 16.11.2026).
// Перенос функций вкладок v1 (src/components/lore/LoreAnalytics.tsx) на данные тех же срезов:
//   sprint_done_dates  → Velocity (спринтов закрыто за неделю);
//   task_created_dates + task_done_dates → Burnup (объём и сделано), Throughput (задач за неделю),
//                                          Lead time (дней от появления задачи до закрытия).
// Неделя — с понедельника (UTC). Неделя без закрытий — честный 0: срез прочитан, закрытий не было.
// kit только рисует (K-14): ряды и точки собираем здесь.

export interface DoneRow { done_date?: string | null }
export interface TaskRow { task_uid?: string | null; valid_from?: string | null }

const DAY = 864e5;

/** Понедельник недели даты (UTC), полночь — в мс. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // пн = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}

/** Последние `n` недель по `today` включительно — начала недель по возрастанию. */
export function lastWeeks(n: number, today: number): number[] {
  const last = weekStart(today);
  return Array.from({ length: n }, (_, i) => last - (n - 1 - i) * 7 * DAY);
}

const parse = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v.length <= 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? t : null;
};

/** Подпись недели «дд.мм» — её понедельник. */
export const weekLabel = (ms: number) => new Date(ms).toISOString().slice(5, 10).split('-').reverse().join('.');

/** Первое появление каждой задачи (по task_uid) — строки без кода или даты не считаются. */
export function firstDates(rows: readonly TaskRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const t = parse(r.valid_from);
    if (!r.task_uid || t === null) continue;
    const cur = out.get(r.task_uid);
    if (cur === undefined || t < cur) out.set(r.task_uid, t);
  }
  return out;
}

/** Сколько событий пришлось на каждую неделю окна; вне окна — не считаются. */
export function perWeek(times: Iterable<number>, weeks: readonly number[]): number[] {
  const counts = weeks.map(() => 0);
  const end = weeks.length ? weeks[weeks.length - 1] + 7 * DAY : 0;
  for (const t of times) {
    if (!weeks.length || t < weeks[0] || t >= end) continue;
    counts[Math.floor((t - weeks[0]) / (7 * DAY))] += 1;
  }
  return counts;
}

export interface WeekBars { category: string; values: Record<string, number | null> }

/** Velocity: спринтов закрыто за неделю. */
export function velocity(rows: readonly DoneRow[], weeks: readonly number[]): WeekBars[] {
  const times = rows.map(r => parse(r.done_date)).filter((t): t is number => t !== null);
  return perWeek(times, weeks).map((v, i) => ({ category: weekLabel(weeks[i]), values: { v } }));
}

/** Throughput: задач закрыто за неделю (задача считается по первому закрытию). */
export function throughput(done: readonly TaskRow[], weeks: readonly number[]): WeekBars[] {
  return perWeek(firstDates(done).values(), weeks).map((t, i) => ({ category: weekLabel(weeks[i]), values: { t } }));
}

export interface LinePoint { x: number; y: number | null }

/** Burnup: накопленно на конец недели — объём (появилось задач) и сделано (закрыто). */
export function burnup(created: readonly TaskRow[], done: readonly TaskRow[], weeks: readonly number[]): { scope: LinePoint[]; done: LinePoint[] } {
  const c = [...firstDates(created).values()];
  const d = [...firstDates(done).values()];
  const upTo = (ts: number[], end: number) => ts.filter(t => t < end).length;
  return {
    scope: weeks.map(w => ({ x: w, y: upTo(c, w + 7 * DAY) })),
    done: weeks.map(w => ({ x: w, y: upTo(d, w + 7 * DAY) })),
  };
}

export interface LeadPoint { x: number; y: number; id: string }

/** Lead time: задачи, закрытые в окне, — дата закрытия × дней от появления. Без даты появления — не точка. */
export function leadTime(created: readonly TaskRow[], done: readonly TaskRow[], weeks: readonly number[]): LeadPoint[] {
  if (!weeks.length) return [];
  const born = firstDates(created);
  const from = weeks[0], to = weeks[weeks.length - 1] + 7 * DAY;
  const out: LeadPoint[] = [];
  for (const [id, t] of firstDates(done)) {
    const b = born.get(id);
    if (b === undefined || t < from || t >= to || t < b) continue;
    out.push({ x: t, y: Math.round(((t - b) / DAY) * 10) / 10, id });
  }
  return out.sort((a, b) => a.x - b.x);
}
