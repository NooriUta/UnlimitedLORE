// Чтение задачи целиком (SPRINT_UXR_S5_RECORD_TASKS/S5-04): текст задачи,
// «‹ x из y ›» по задачам её спринта (в порядке спринта), свойства — в ушке.
// Всё из kit: RecordReader = каркас записи K-04 + листалка + ушко.
// Данные — реальный API LORE: /lore/slice/tasks_of_sprint (задачи спринта
// целиком, метаданные полноты S1) и /lore/slice/history_task (журнал).
// Состояние — в URL: ?section=tasks&passport=SPRINT/CODE&tab=…&props=1.
import { useMemo } from 'react';
import {
  EmptyState, Forbidden, LoadError, RecordCrumbs, RecordPager, RecordReader, Skeleton,
  useKitLang, useLoadState, useUrlParam, type KitCtx,
} from '@seidr/kit';
import { MartProse } from '@seidr/kit/content';
import { fetchSlice, type FetchLike, type SliceBody } from './loreSlice';
import {
  buildTaskData, historyToJournal, parseTaskPassport, sortSprintTasks, taskConfig, taskPassport,
  type JournalPart, type SprintTaskRow, type TaskHistRow,
} from './taskRecord';
import { useTaskT } from './taskRead.i18n';
import { TaskProps } from './TaskProps';
import './TaskReadPage.css';

export interface TaskReadPageProps {
  fetchImpl?: FetchLike;
  /** Авторизация от оболочки v2 (Bearer). */
  headers?: () => Record<string, string>;
}

/** Ссылка на любую запись — паспортом в URL, раздел по виду id. */
export function passportHref(id: string): string {
  const section = id.includes('/') ? 'tasks' : id.startsWith('SPRINT') ? 'sprints' : id.startsWith('UC-') ? 'uc' : 'components';
  return `?section=${section}&passport=${encodeURIComponent(id)}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const md = (s: string) => <MartProse text={s} />;

export function TaskReadPage({ fetchImpl, headers }: TaskReadPageProps) {
  const lang = useKitLang();
  const tt = useTaskT();
  const [passport, setPassport] = useUrlParam('passport');
  const [tabParam, setTab] = useUrlParam('tab');
  const [propsParam, setProps] = useUrlParam('props');
  const p = parseTaskPassport(passport);
  const sprintId = p?.sprintId ?? null;

  const sprint = useLoadState<SliceBody<SprintTaskRow> | null>(
    signal => (sprintId ? fetchSlice<SprintTaskRow>('tasks_of_sprint', { sprint_id: sprintId }, { signal, fetchImpl, headers }) : Promise.resolve(null)),
    [sprintId],
  );
  const rows = useMemo(() => sortSprintTasks(sprint.data?.rows ?? []), [sprint.data]);
  const row = p ? rows.find(r => r.task_id === p.taskId) : undefined;
  const uid = row?.task_uid ?? null;

  const hist = useLoadState<SliceBody<TaskHistRow> | null>(
    signal => (uid ? fetchSlice<TaskHistRow>('history_task', { id: uid }, { signal, fetchImpl, headers }) : Promise.resolve(null)),
    [uid],
  );

  const config = useMemo(() => taskConfig(lang), [lang]);
  const ctx = useMemo<KitCtx | null>(() => {
    if (!p || !row) return null;
    const id = taskPassport(p.sprintId, row.task_id);
    const journal: JournalPart = hist.error !== undefined
      ? { journalError: hist.error instanceof Error ? hist.error.message : String(hist.error) }
      : hist.data ? { journal: historyToJournal(id, hist.data.rows) } : { journalPending: true };
    return { config, data: buildTaskData(p.sprintId, rows, journal), role: 'reader', href: passportHref, esc, md };
  }, [p?.sprintId, row, rows, hist.data, hist.error, config]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) {
    return <main className="task-read"><EmptyState title={tt('task.badPassport.title')} hint={tt('task.badPassport.hint')} /></main>;
  }
  if (sprint.state === 'forbidden') {
    return <main className="task-read"><Forbidden title={tt('task.forbidden.title')} /></main>;
  }
  if (sprint.state === 'error') {
    return (
      <main className="task-read">
        <LoadError title={tt('task.error.title')} hint={tt('task.error.hint')} error={sprint.error} onRetry={sprint.reload} />
      </main>
    );
  }
  if (sprint.state === 'loading' || !sprint.data) {
    return <main className="task-read" data-testid="task-read-loading"><Skeleton lines={6} label={tt('task.loading')} /></main>;
  }
  if (!row || !ctx) {
    const id = taskPassport(p.sprintId, p.taskId);
    // «Нет в спринте — проверено» только при полной выдаче; иначе честно «не проверить».
    const checked = sprint.completeness.kind === 'complete';
    return (
      <main className="task-read">
        <EmptyState title={tt('task.notFound.title', { id })} hint={checked ? tt('task.notFound.hint') : tt('task.notFound.unverified')} />
      </main>
    );
  }

  const record = ctx.data.records.find(r => r.id === taskPassport(p.sprintId, row.task_id))!;
  const ids = ctx.data.records.map(r => r.id);
  return (
    <main className="task-read" data-testid="task-read">
      <RecordReader
        record={record}
        ctx={ctx}
        tab={tabParam ?? 'overview'}
        onTab={t => setTab(t === 'overview' ? null : t)}
        // S4-28: паспорт — продолжение списка: крошки к спринту в одной строке с листалкой.
        crumbs={<RecordCrumbs back={{ label: tt('task.crumbs.sprint', { id: p.sprintId }), href: passportHref(p.sprintId) }} current={row.task_id} />}
        pager={<RecordPager ids={ids} current={record.id} hotkeys onGo={id => setPassport(id)} />}
        aside={<TaskProps record={record} ctx={ctx} />}
        asideOpen={propsParam === '1'}
        onAside={open => setProps(open ? '1' : null, { replace: true })}
      />
    </main>
  );
}

export default TaskReadPage;
