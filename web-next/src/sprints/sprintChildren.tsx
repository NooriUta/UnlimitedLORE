// PU-23 (владелица 14.11.2026): задачи раскрытого спринта — строками той же таблицы списка, в тех
// же колонках, что сам спринт. Загрузчик отдаёт записи вида task; ячейки, которые у задачи свои
// (короткий код, ссылка на паспорт задачи, статус со сменой за два касания), подменяются здесь,
// остальное kit рисует общей отрисовкой. Оценка и факт задачи кладутся в те же поля, что итоги
// спринта (effort_total / actual_total), поэтому встают в его колонки «Оценка» и «Факт».
import type { ReactNode } from 'react';
import { StatusChip, type KitRecord } from '@seidr/kit';
import { recordHref } from '../nav/loreRoutes';
import { planStatusOf } from './taskStatus';
import { useTaskConfig, type SprintTaskRow } from './SprintTasks';
import type { LoreClient } from './loreClient';

interface TaskRowFull extends SprintTaskRow {
  effort_days?: number | null;
  actual_days?: number | null;
}

/** Одно число — в форме суммы итогов (значение и охват), чтобы встать в колонку спринта. */
function one(v: number | null | undefined): { value: number | null; known: number; of: number } {
  return typeof v === 'number' ? { value: v, known: 1, of: 1 } : { value: null, known: 0, of: 1 };
}

export async function loadSprintChildren(client: LoreClient, sprintId: string, signal: AbortSignal): Promise<KitRecord[]> {
  const body = await client.slice<TaskRowFull>('tasks_of_sprint', { sprint_id: sprintId }, signal);
  return body.rows.map(r => ({
    id: r.task_uid,
    kind: 'task',
    title: r.title ?? r.task_id,
    status: planStatusOf(r.status_raw),
    fields: { code: r.task_id, effort_total: one(r.effort_days), actual_total: one(r.actual_days) },
  }));
}

function TaskStatusCell({ record, client }: { record: KitRecord; client: LoreClient }) {
  const config = useTaskConfig();
  return (
    <StatusChip record={record} config={config} compact
      save={c => client.setStatus('task', c.id, String(c.to))} />
  );
}

/** Ячейки задачи, которые не берутся из общей отрисовки списка. */
export function sprintChildCell(col: string, child: KitRecord, client: LoreClient): ReactNode | undefined {
  switch (col) {
    case 'id': return <span className="sk-pill sk-pill--id">{String(child.fields.code ?? child.id)}</span>;
    case 'title': {
      const href = recordHref('task', child.id);
      return href ? <a className="sk-list__title" href={href}>{child.title}</a> : child.title;
    }
    case 'title+id': return <span>{child.title} <span className="sk-pill sk-pill--id">{String(child.fields.code ?? child.id)}</span></span>;
    case 'status': return <TaskStatusCell record={child} client={client} />;
    default: return undefined;
  }
}
