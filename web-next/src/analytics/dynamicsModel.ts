// Вкладка «Динамика» раздела «Аналитика» (SPRINT_UXR_S13_KIT4/K4-CHARTS). Решение владелицы 19.11.2026 «10 → а3»:
// мини-ряды в ленте «Новостей» остаются как есть (Spark в NewsFeed.tsx, мини-столбики NewsDynamics.tsx),
// а полные графики ТЕХ ЖЕ рядов показываются здесь на графиках kit.
// Источник — те же ответы, что у мини-рядов, ни одного числа клиент не пересчитывает:
//   • GET /lore/news/v2/dynamics → пять рядов «Динамики» (задач закрыто/заведено, спринтов, релизов, принято);
//   • GET /lore/news/v2 → tasks.days[].burn — сгорание по дням (мини-график Spark над лентой).
// Честно: ряд, который сервер не посчитал, — «не смогли посчитать» с причиной; период без значения — null, не 0.
import { NEWS_DYNAMICS_METRICS, type NewsDynamicsMetricId, type NewsDynamicsResponse } from '../news/feed/dynamics';
import type { NewsResponse } from '../news/feed/types';
import type { LinePoint, WeekBars } from './analyticsModel';

/** Блоки вкладки в порядке ленты. */
export const DYNAMICS_BLOCKS = NEWS_DYNAMICS_METRICS;

export interface DynamicsBlock {
  id: NewsDynamicsMetricId;
  state: 'ok' | 'unavailable';
  /** Группы столбиков: один ряд — `v`; «Принято» — по типу (adr, decision). */
  groups: { key: string }[];
  data: WeekBars[];
  /** Метка текущего (идущего) периода, если он есть. */
  current?: string;
  reason?: string;
  forbidden?: boolean;
}

const at = (s: readonly number[] | null | undefined, i: number): number | null => (s && typeof s[i] === 'number' ? s[i] : null);

/** Ряды «Динамики» → данные полных столбиков, по одному блоку на ряд мини-карточек. */
export function dynamicsBlocks(r: NewsDynamicsResponse): DynamicsBlock[] {
  const current = r.buckets.find(b => b.current)?.label;
  return DYNAMICS_BLOCKS.map(id => {
    const m = r.metrics.find(x => x.id === id);
    if (!m || m.state !== 'ok' || !m.series) {
      return { id, state: 'unavailable', groups: [], data: [], reason: m?.reason, forbidden: m?.forbidden };
    }
    if (m.by_type) {
      const bt = m.by_type;
      return {
        id, state: 'ok', current, groups: [{ key: 'adr' }, { key: 'decision' }],
        data: r.buckets.map((b, i) => ({ category: b.label, values: { adr: at(bt.adr, i), decision: at(bt.decision, i) } })),
      };
    }
    return { id, state: 'ok', current, groups: [{ key: 'v' }], data: r.buckets.map((b, i) => ({ category: b.label, values: { v: at(m.series, i) } })) };
  });
}

export type BurnDays = { state: 'ok'; points: LinePoint[] } | { state: 'unavailable'; reason: string; points: [] };

/** Сгорание по дням: те же дни, что у Spark (tasks.days ∪ дни матрицы); дня нет в tasks.days — null. */
export function burnByDay(data: NewsResponse): BurnDays {
  const tasks = data.metrics.tasks;
  if (!tasks.available) return { state: 'unavailable', reason: tasks.reason, points: [] };
  const byDay = new Map(tasks.days.map(d => [d.day_local, d.burn]));
  const days = [...new Set([...tasks.days.map(d => d.day_local), ...(data.matrix?.rows.map(r => r.day) ?? [])])].sort();
  return { state: 'ok', points: days.map(day => ({ x: Date.parse(`${day}T00:00:00Z`), y: byDay.has(day) ? byDay.get(day)! : null })) };
}
