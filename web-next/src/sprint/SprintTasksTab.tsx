// Вкладка «Задачи» паспорта спринта (SPRINT_UXR_S5_RECORD_TASKS/S5-02).
// Главное от владелицы: задачи, их статусы и атрибуты видны за 2 клика —
// таблица сразу сверху, статус меняется в 2 касания, правка — в строке.
// Таблица — TaskTable из Seiðr-kit; здесь только данные, URL и запись.
//
// Состояние группировки — в URL (?group=phase|status|none, replace: не
// засоряет историю «назад»). Запись подтверждённая: строка меняется после
// ответа сервера, отказ рисуется в строке (это делает TaskTable).
import { useCallback, useEffect, useState } from 'react';
import { loreFetch } from '../auth/session';
import {
  LoadStateView, pushUrlState, readUrlState, TaskCounters, TaskTable, TASK_COLUMN_KEYS, TASK_GROUP_BYS,
  columnsFromUrl, columnsToUrlValue, useLoadState,
  type TaskGroupBy, type TaskPatch, type TaskRowData, type TaskStatus, type UrlWindow,
} from '@seidr/kit';
import { useKitLang } from '@seidr/kit';
import { useAppT } from '../i18n';
import { sliceFetcher } from '../api/loreSlice';
import { loadTaskDicts, type TaskDicts } from './taskDicts';
import { editTask, loadSprintTasks, setTaskStatus, type SprintTasksData } from './sprintTasksApi';

export const GROUP_PARAM = 'group';
/** Набор колонок задач — в адресе, как у списков (S4-35): ссылкой делятся. */
export const TASK_COLS_PARAM = 'tcols';
const DEFAULT_GROUP: TaskGroupBy = 'phase';

function groupFromUrl(win: UrlWindow | undefined): TaskGroupBy {
  const raw = (win ? readUrlState(win) : typeof window === 'undefined' ? new URLSearchParams() : readUrlState()).get(GROUP_PARAM);
  return (TASK_GROUP_BYS as readonly string[]).includes(raw ?? '') ? (raw as TaskGroupBy) : DEFAULT_GROUP;
}

/** Адрес паспорта задачи: задача всегда пишется парой «спринт/код». */
export function taskPassportHref(sprintId: string, taskId: string): string {
  return `?section=tasks&passport=${encodeURIComponent(`${sprintId}/${taskId}`)}`;
}

export interface SprintTasksTabProps {
  sprintId: string;
  /** Для тестов; по умолчанию глобальный fetch. */
  fetchImpl?: typeof fetch;
  /** Для тестов; по умолчанию window. */
  win?: UrlWindow;
}

export function SprintTasksTab({ sprintId, fetchImpl, win }: SprintTasksTabProps) {
  const t = useAppT();
  const f = fetchImpl ?? loreFetch;
  const [groupBy, setGroupBy] = useState<TaskGroupBy>(() => groupFromUrl(win));
  // Подтверждённые сервером правки поверх загруженных строк — без перезагрузки
  // всей вкладки (перезагрузка мигала бы скелетом на каждое касание).
  const [patches, setPatches] = useState<Record<string, Partial<TaskRowData>>>({});
  useEffect(() => { setPatches({}); }, [sprintId]);

  const result = useLoadState<SprintTasksData>(signal => loadSprintTasks(sprintId, signal, f), [sprintId]);

  // Справочники — украшение строки, а не её условие: грузим отдельно и молча.
  // Не пришли — kit покажет исходные коды и ничего о них не утверждает.
  const lang = useKitLang();
  const [dicts, setDicts] = useState<TaskDicts>({});
  useEffect(() => {
    let live = true;
    const slice = sliceFetcher();
    void loadTaskDicts(lang, (s, p) => slice(s, p)).then(d => { if (live) setDicts(d); });
    return () => { live = false; };
  }, [lang]);

  // Набор колонок живёт в адресе: им делятся ссылкой, как видом списка.
  // Чужой или устаревший ключ отбрасывает сам kit — пустой столбец хуже
  // отсутствующего.
  const [cols, setCols] = useState<string[] | undefined>(
    () => columnsFromUrl(win ? win.location.search : (typeof window === 'undefined' ? '' : window.location.search), TASK_COLUMN_KEYS, 'title', TASK_COLS_PARAM),
  );
  const onColumnsChange = useCallback((next: string[]) => {
    setCols(next);
    pushUrlState({ [TASK_COLS_PARAM]: columnsToUrlValue(next) }, { replace: true, win });
  }, [win]);

  const onGroupByChange = useCallback((by: TaskGroupBy) => {
    setGroupBy(by);
    pushUrlState({ [GROUP_PARAM]: by }, { replace: true, win });
  }, [win]);

  const patch = (uid: string, p: Partial<TaskRowData>) => setPatches(m => ({ ...m, [uid]: { ...m[uid], ...p } }));

  async function onStatusChange(task: TaskRowData, status: TaskStatus) {
    await setTaskStatus(task.uid, status, f);
    patch(task.uid, { status });
  }

  async function onSave(task: TaskRowData, p: TaskPatch) {
    await editTask(task, p, f);
    const next: Partial<TaskRowData> = {};
    if (p.title !== undefined) next.title = p.title;
    if (p.effortDays !== undefined) next.effortDays = p.effortDays;
    if (p.executor !== undefined) next.executor = p.executor;
    if (p.reviewer !== undefined) next.reviewer = p.reviewer;
    patch(task.uid, next);
  }

  return (
    <section className="sprint-tasks" aria-label={t('sprintTasks.title')}>
      <LoadStateView result={result}>
        {data => (
          <>
            {/* S4-36: счётчики по тем же строкам, что и таблица — иначе шапка
                и таблица могут показать разное. */}
            <TaskCounters tasks={data.rows.map(r => (patches[r.uid] ? { ...r, ...patches[r.uid] } : r))} />
            <TaskTable
            tasks={data.rows.map(r => (patches[r.uid] ? { ...r, ...patches[r.uid] } : r))}
            phases={data.phases}
            groupBy={groupBy}
            onGroupByChange={onGroupByChange}
            onStatusChange={onStatusChange}
            onSave={onSave}
            dict={dicts}
            columns={cols}
            onColumnsChange={onColumnsChange}
            hrefFor={task => taskPassportHref(sprintId, task.id)}
            label={t('sprintTasks.caption', { id: sprintId })}
            />
          </>
        )}
      </LoadStateView>
    </section>
  );
}
