// Свойства задачи в ушке (SPRINT_UXR_S5_RECORD_TASKS/S5-04). Полноценный
// компонент свойств (правка, статус в 2 касания) — задача S5-05; здесь —
// только чтение тех же полей, чтобы ушко не было пустым. S5-05 заменяет этот
// компонент, не трогая экран: RecordReader принимает свойства слотом aside.
import type { ReactNode } from 'react';
import { StatusChip, type KitCtx, type KitRecord } from '@seidr/kit';
import { useTaskT, type TaskReadKey } from './taskRead.i18n';
import { recordHref } from '../nav/loreRoutes';

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
}

export function TaskProps({ record, ctx }: { record: KitRecord; ctx: KitCtx }) {
  const tt = useTaskT();
  const f = record.fields;
  const none = <span className="task-props__none">{tt('task.prop.none')}</span>;
  const text = (v: unknown): ReactNode => (v === null || v === undefined || v === '' ? none : <span>{String(v)}</span>);
  const refs = (ids: string[]): ReactNode => (ids.length === 0 ? none : (
    <span className="task-props__refs">{ids.map(id => <span key={id} className="sk-pill sk-pill--id">{id}</span>)}</span>
  ));
  const rows: [TaskReadKey, ReactNode][] = [
    ['task.prop.status', <StatusChip key="s" record={record} config={ctx.config} role={ctx.role} />],
    ['task.prop.sprint', <a key="sp" className="sk-rec-ref" href={recordHref('sprint', String(f.sprint_id)) ?? undefined}>{String(f.sprint_id)}</a>],
    ['task.prop.type', text(f.task_type)],
    ['task.prop.workClass', text(f.work_class)],
    ['task.prop.effort', typeof f.effort_days === 'number' ? <span className="task-props__mono">{f.effort_days}</span> : none],
    ['task.prop.executor', text(f.executor_agent)],
    ['task.prop.reviewer', text(f.reviewer_agent)],
    ['task.prop.author', text(f.author_agent)],
    ['task.prop.components', refs(list(f.component_ids))],
    ['task.prop.uc', refs(list(f.realizes_uc))],
  ];
  return (
    <dl className="task-props" data-testid="task-props">
      {rows.map(([k, v]) => (
        <div key={k} className="task-props__row">
          <dt>{tt(k)}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
