// PU-23 (правило владелицы 14.11.2026): задачи раскрытого спринта — объекты другого типа, поэтому
// под спринтом встаёт вложенная таблица экрана «Задачи» (lists/nestedExpand.tsx). Загрузчик отдаёт
// задачи ТЕМ ЖЕ маппингом, что список «Задачи» (taskListRecord), — колонки, фасеты и статусы
// совпадают с его собственным списком.
//
// Срез tasks_of_sprint не несёт спринт и релиз задачи: спринт — это сама раскрытая строка, а релиз
// задачи и есть релиз её спринта (S9-02, так же считает open_tasks), — оба берутся у родителя.
import type { KitRecord } from '@seidr/kit';
import { taskListRecord } from '../lists/records';
import type { LoreClient } from './loreClient';

export async function loadSprintChildren(client: LoreClient, sprint: KitRecord, signal: AbortSignal): Promise<KitRecord[]> {
  const body = await client.slice<Record<string, unknown>>('tasks_of_sprint', { sprint_id: sprint.id }, signal);
  const release = sprint.fields.release;
  return body.rows.map(row => taskListRecord({
    ...row,
    sprint_id: row.sprint_id ?? sprint.id,
    release_ids: row.release_ids ?? (Array.isArray(release) ? release : release ? [release] : []),
  }));
}
