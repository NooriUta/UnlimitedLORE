// PU-23 (правило владелицы 14.11.2026): задачи раскрытого спринта — объекты другого типа, поэтому
// под спринтом встаёт вложенная таблица экрана «Задачи» (lists/nestedExpand.tsx). Загрузчик отдаёт
// задачи ТЕМ ЖЕ маппингом, что список «Задачи» (taskListRecord), — колонки, фасеты и статусы
// совпадают с его собственным списком.
//
// Спринт срез tasks_of_sprint не несёт — это сама раскрытая строка, он берётся у родителя.
// Релиз у родителя НЕ берётся (PU-07, приёмка 0dccfe73): релиз задачи — релиз её PR, срез отдаёт
// его сам (release_ids, как open_tasks). Нет его — колонка пуста, а не «релиз спринта»: иначе
// запланированная или отменённая задача показывала релиз, в который она не уезжала.
import type { KitRecord } from '@seidr/kit';
import { taskListRecord } from '../lists/records';
import type { LoreClient } from './loreClient';

export async function loadSprintChildren(client: LoreClient, sprint: KitRecord, signal: AbortSignal): Promise<KitRecord[]> {
  const body = await client.slice<Record<string, unknown>>('tasks_of_sprint', { sprint_id: sprint.id }, signal);
  return body.rows.map(row => taskListRecord({
    ...row,
    sprint_id: row.sprint_id ?? sprint.id,
    release_ids: Array.isArray(row.release_ids) ? row.release_ids : [],
  }));
}
