// Прогресс спринта «задачи x/y» (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09).
//
// Готового слайса «прогресс по спринтам» на бэкенде нет, поэтому считаем на
// клиенте по tasks_of_sprints_batch — тем же слайсом, что веха и доска
// релизов v1: по 20 спринтов на запрос (sprint_ids в URL, длиннее нельзя).
//   x — готовые задачи, y — все, кроме отменённых (отменённая задача не
//   «недоделана»: с ней спринт никогда не стал бы 100%).
// Честность: упавшая пачка → {error} у каждого её спринта («не посчитано»,
// не 0/0); обрезанная сервером пачка → partial у каждого её спринта.
import type { KitProgressInput } from '@seidr/kit';
import type { LoreClient } from './loreClient';
import { isDone, isWithdrawn, planStatusOf } from './taskStatus';

export const PROGRESS_CHUNK = 20;
/** Сколько пачек одновременно: 500 спринтов = 25 пачек, не 25 запросов разом. */
const PARALLEL = 4;

interface TaskStatusRow { status_raw?: string | null; sprint_id?: string | null }

export function countProgress(tasks: readonly TaskStatusRow[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    const s = planStatusOf(t.status_raw);
    if (isWithdrawn(s)) continue;
    total += 1;
    if (isDone(s)) done += 1;
  }
  return { done, total };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function loadSprintProgress(
  client: LoreClient,
  sprintIds: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, KitProgressInput>> {
  const out = new Map<string, KitProgressInput>();
  const chunks: string[][] = [];
  for (let i = 0; i < sprintIds.length; i += PROGRESS_CHUNK) chunks.push(sprintIds.slice(i, i + PROGRESS_CHUNK));

  const runChunk = async (ids: string[]) => {
    try {
      const body = await client.slice<TaskStatusRow>('tasks_of_sprints_batch', { sprint_ids: ids.join(',') }, signal);
      const partial = body.truncated === true || body.truncated === 'unknown' || body.page?.has_more === true;
      const by = new Map<string, TaskStatusRow[]>(ids.map(id => [id, []]));
      for (const r of body.rows) if (r.sprint_id && by.has(r.sprint_id)) by.get(r.sprint_id)!.push(r);
      for (const [id, rows] of by) out.set(id, partial ? { ...countProgress(rows), partial: true } : countProgress(rows));
    } catch (e) {
      if (signal?.aborted) throw e;
      for (const id of ids) out.set(id, { error: errText(e) });
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      await runChunk(chunks[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
  return out;
}
