// Графики личной страницы человека (SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE, прототип ap-people-page.html,
// согласован владелицей 21.11.2026): его задачи сейчас по статусам и где он работает — по проектам. Данные — строки
// среза user_tasks (задачи, где у него открытая роль: автор, исполнитель, приёмщик).
import { planStatusOf } from '../sprints/taskStatus';

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
