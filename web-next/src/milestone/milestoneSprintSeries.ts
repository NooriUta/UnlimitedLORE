// Графики вехи по её спринтам (SPRINT_UXR_S13_KIT4/K4-CHARTS, вопрос 11 владелицы 19.11.2026: «графики по вехам
// были в v1» — перенести в v2 на графики kit).
// Что было в v1: src/components/lore/LoreAnalytics.tsx, вкладка «Прогресс», фильтр «Веха» — спринты вехи
// (milestones.direct_sprint_ids) сужали графики Velocity (спринтов закрыто за ISO-неделю, по done_date) и
// Burnup (scope — спринт появился, done — спринт закрыт; накопленно по неделям). Здесь те же ряды, но
// окно ограничено последними 26 неделями (накопленное считает и то, что раньше окна), неделя — с понедельника UTC.
// Дата появления спринта — created_date (в v1 бралась valid_from; она — запасной вариант).
// kit только рисует (K-14): ряды собираются здесь.
import { lastWeeks, perWeek, weekLabel, weekStart, type LinePoint, type WeekBars } from '../analytics/analyticsModel';

export interface MilestoneSprintRow { sprint_id?: string | null; created_date?: string | null; valid_from?: string | null; done_date?: string | null }

export const MILESTONE_WEEKS_MAX = 26;
const DAY = 864e5;

const parse = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v.length <= 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? t : null;
};

export interface MilestoneSprintSeries {
  velocity: WeekBars[];
  burnup: { scope: LinePoint[]; done: LinePoint[] };
  /** Спринтов вехи с известной датой появления — из всех спринтов вехи. */
  shown: number;
  total: number;
}

export function milestoneSprintSeries(ids: readonly string[], rows: readonly MilestoneSprintRow[], today: number, maxWeeks = MILESTONE_WEEKS_MAX): MilestoneSprintSeries {
  const want = new Set(ids);
  const seen = new Set<string>();
  const born: number[] = [];
  const done: number[] = [];
  for (const r of rows) {
    if (!r.sprint_id || !want.has(r.sprint_id) || seen.has(r.sprint_id)) continue;
    seen.add(r.sprint_id);
    const b = parse(r.created_date) ?? parse(r.valid_from);
    if (b === null) continue;
    born.push(b);
    const d = parse(r.done_date);
    if (d !== null) done.push(d);
  }
  const total = want.size, shown = born.length;
  if (!born.length) return { velocity: [], burnup: { scope: [], done: [] }, shown, total };
  const first = weekStart(Math.min(...born, ...done));
  const span = Math.floor((weekStart(today) - first) / (7 * DAY)) + 1;
  const weeks = lastWeeks(Math.max(1, Math.min(maxWeeks, span)), today);
  const upTo = (ts: number[], end: number) => ts.filter(t => t < end).length;
  return {
    velocity: perWeek(done, weeks).map((v, i) => ({ category: weekLabel(weeks[i]), values: { v } })),
    burnup: {
      scope: weeks.map(w => ({ x: w, y: upTo(born, w + 7 * DAY) })),
      done: weeks.map(w => ({ x: w, y: upTo(done, w + 7 * DAY) })),
    },
    shown, total,
  };
}
