// Графики личной страницы человека (SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE, прототип ap-people-page.html,
// согласован владелицей 21.11.2026): его задачи сейчас по статусам и где он работает — по проектам. Данные — строки
// среза user_tasks (задачи, где у него открытая роль: автор, исполнитель, приёмщик).
import { planStatusOf } from '../sprints/taskStatus';
import { cycleTimes, taskTimelines, type CyclePoint, type StatusVersionRow } from './flowModel';
import { firstDates, lastWeeks, type TaskRow } from '../analytics/analyticsModel';

/** Корзины жизненного цикла: столбиков столько, сколько различает человек, а не словарь статусов. */
export const USER_BUCKETS = ['todo', 'work', 'waiting', 'review', 'done', 'closed'] as const;
export type UserBucket = (typeof USER_BUCKETS)[number];

const BUCKET_OF: Record<string, UserBucket> = {
  backlog: 'todo', todo: 'todo', planned: 'todo', design: 'todo', deferred: 'todo',
  active: 'work', partial: 'work',
  waiting: 'waiting', blocked: 'waiting',
  review: 'review', ready_for_deploy: 'review', uat: 'review',
  done: 'done',
  failed: 'closed', cancelled: 'closed',
};

export interface UserTaskRow { task_uid?: unknown; status_raw?: unknown; project?: unknown; sprint_id?: unknown }
export interface Bars { category: string; values: { t: number } }

/** Задачи по корзинам статуса; статус не распознан — не выдумываем корзину, строка не считается. */
export function userStatusBars(rows: readonly UserTaskRow[]): Bars[] {
  const n = new Map<UserBucket, number>();
  for (const r of rows) {
    const b = BUCKET_OF[planStatusOf(typeof r.status_raw === 'string' ? r.status_raw : null)];
    if (b) n.set(b, (n.get(b) ?? 0) + 1);
  }
  return USER_BUCKETS.filter(b => n.has(b)).map(b => ({ category: b, values: { t: n.get(b)! } }));
}

/** Задачи по проектам: {@code top} крупных, остальное и задачи без проекта — «other». */
export function userProjectBars(rows: readonly UserTaskRow[], top = 5): Bars[] {
  const n = new Map<string, number>();
  let other = 0;
  for (const r of rows) {
    const p = typeof r.project === 'string' && r.project.trim() ? r.project.trim() : null;
    if (p) n.set(p, (n.get(p) ?? 0) + 1); else other += 1;
  }
  const sorted = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [, v] of sorted.slice(top)) other += v;
  const out: Bars[] = sorted.slice(0, top).map(([category, t]) => ({ category, values: { t } }));
  if (other > 0) out.push({ category: 'other', values: { t: other } });
  return out;
}

// ── Решение владельца 25.11.2026 (3а): цифры шапки и время цикла по истории статусов человека/агента ──────────
const DAY = 864e5;

/** Чья страница: человек (ключ kc_sub) или агент (actor_id; решение 25.11, 2а — те же вкладки, что у человека). */
export interface PersonSubject { kind: 'user' | 'agent'; id: string }

/** Срезы страницы: задачи с открытой ролью и история их статусов (3а) — свои у человека и у агента. */
export function personSources(s: PersonSubject) {
  const param: Record<string, string> = s.kind === 'user' ? { kc_sub: s.id } : { id: s.id };
  return {
    tasks: { slice: s.kind === 'user' ? 'user_tasks' : 'agent_tasks', params: param },
    history: { slice: s.kind === 'user' ? 'user_task_status_versions' : 'agent_task_status_versions', params: param },
  };
}

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
};

export interface PersonStatsInput { tasks: readonly UserTaskRow[]; done: readonly TaskRow[]; history: readonly StatusVersionRow[]; today: number }
export interface PersonStatsOut { work: number; review: number; closed30: number; medianCycleDays: number | null }

const mineOf = (tasks: readonly UserTaskRow[]) => new Set(tasks.map(r => (typeof r.task_uid === 'string' ? r.task_uid : '')).filter(Boolean));

/** Шапка: в работе и на приёмке — сейчас; закрыто и медиана цикла — за 30 дней, только по его задачам. */
export function personStats({ tasks, done, history, today }: PersonStatsInput): PersonStatsOut {
  const st = Object.fromEntries(userStatusBars(tasks).map(b => [b.category, b.values.t])) as Record<string, number>;
  const mine = mineOf(tasks);
  const since = today - 30 * DAY;
  let closed30 = 0;
  for (const [uid, at] of firstDates(done)) if (mine.has(uid) && at >= since && at <= today) closed30 += 1;
  const cyc = personCycle(tasks, history, since).filter(p => p.x <= today);
  return { work: st.work ?? 0, review: st.review ?? 0, closed30, medianCycleDays: median(cyc.map(p => p.y)) };
}

/** Точки времени цикла его задач (от первого «в работе» до готовности), закрытых не раньше {@code from}. */
export function personCycle(tasks: readonly UserTaskRow[], history: readonly StatusVersionRow[], from = -Infinity): CyclePoint[] {
  const mine = mineOf(tasks);
  return cycleTimes(taskTimelines(history, uid => mine.has(uid)), from).points;
}

/** Время цикла — медиана по неделям закрытия (понедельник недели); неделя без закрытых — пропуск, а не ноль. */
export function weeklyMedianCycle(points: readonly CyclePoint[], today: number, weeks = 12): { x: number; y: number }[] {
  const ws = lastWeeks(weeks, today);
  const out: { x: number; y: number }[] = [];
  ws.forEach((w, i) => {
    const end = i + 1 < ws.length ? ws[i + 1] : w + 7 * DAY;
    const m = median(points.filter(p => p.x >= w && p.x < end).map(p => p.y));
    if (m !== null) out.push({ x: w, y: m });
  });
  return out;
}
