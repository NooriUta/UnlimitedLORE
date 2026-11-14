// Вкладка «Задачи» паспорта спринта: дерево или таблица
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TREE-NESTED).
//
// По умолчанию — ДЕРЕВО с однородными колонками (решение владелицы 10.11.2026:
// спринт → фаза → задача, фазы необязательны) на элементе kit `TreeTable`.
// Данные — тот же ответ /lore/record, что у всего паспорта: второго чтения нет.
//
// Прежняя таблица задач (группировка, правка в строке, массовый статус, выбор
// колонок) НЕ удалена — она вторым видом, выбор в адресе (`?tview=table`):
// функцию без «да» владелицы не убираем, а в дереве правки в строке пока нет.
//
// S4-SPRINT-TASKS-CONTROLS («и а и б» владелицы 11.11.2026): у дерева и таблицы —
// стандартная полоса списка (поиск, фасеты статус / исполнитель / фаза,
// группировка, порядок); третий вид «Список» (?tview=list) — kit NestedList.
// Правило фильтра в дереве — в kit (treeControls): условие судит задачи; фаза
// видна, если под ней есть подходящая задача, иначе скрыта.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  NestedList, pushUrlState, readUrlState, TaskCounters, TreeTable, treeRowRecord, useKitLang,
  type KitConfig, type KitCtx, type KitHooks, type TaskRowData, type TreeControls, type TreeFlatRow, type UrlWindow,
} from '@seidr/kit';
import { MartProse } from '@seidr/kit/content';
import { loreFetch } from '../auth/session';
import { appT, useAppT } from '../i18n';
import { recordHref } from '../nav/loreRoutes';
import { baseConfig } from '../record/passportAdapters';
import type { LoreRecord1 } from '../record/loreRecordContract';
import { fetchTypeStatuses } from '../record/passportStatuses';
import { saveRecordStatus, statusEntity } from '../record/statusSave';
import { SPRINT_TREE_COLUMNS, SPRINT_TREE_LEVELS, sprintTreeOf } from '../record/sprintTree';
import { SprintBurnLine } from './SprintBurnLine';
import { SprintTasksTab } from './SprintTasksTab';
import { loadTaskDicts, type TaskDicts } from './taskDicts';
import { sliceFetcher } from '../api/loreSlice';

export const TASK_VIEW_PARAM = 'tview';
export type TaskView = 'tree' | 'table' | 'list';
const VIEWS: readonly TaskView[] = ['tree', 'table', 'list'];
const VIEW_KEY = { tree: 'sprintTasks.view.tree', table: 'sprintTasks.view.table', list: 'sprintTasks.view.list' } as const;

/** Оси полосы дерева. Фазы в группировке дерева нет — фаза и есть его уровень. */
const TREE_CONTROLS: TreeControls = {
  filters: ['status', 'fields.executor', 'fields.phase'],
  groupings: ['status', 'fields.executor'],
  sorts: ['title', 'fields.code', 'status', 'fields.executor', 'fields.effort'],
};
/** Оси вида «Список» сверх статуса (умолчание NestedList). */
const LIST_AXES = ['fields.executor', 'fields.phase'] as const;
const LIST_COLUMNS = ['status', 'fields.code', 'title', 'fields.author', 'fields.executor', 'fields.reviewer', 'fields.phase', 'fields.effort'];

const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * PU-16 (D13 владелицы, «возвращаем всё»): строки задач дерева → вход счётчиков kit.
 * Те же строки, что рисует дерево и список: шапка и строки не расходятся.
 */
export function counterTasksOf(rows: readonly TreeFlatRow[]): TaskRowData[] {
  return rows.filter(r => r.kind === 'task').map((r, i) => ({
    uid: r.key, id: strOrNull(r.code) ?? r.key, title: strOrNull(r.title), status: strOrNull(r.status),
    phase: null, effortDays: numOrNull(r.effort), author: strOrNull(r.author), executor: strOrNull(r.executor),
    reviewer: strOrNull(r.reviewer), taskType: strOrNull(r.taskType), workClass: null, order: i,
  }));
}

function viewFromUrl(win: UrlWindow | undefined): TaskView {
  const raw = (win ? readUrlState(win) : typeof window === 'undefined' ? new URLSearchParams() : readUrlState()).get(TASK_VIEW_PARAM);
  return (VIEWS as readonly string[]).includes(raw ?? '') ? (raw as TaskView) : 'tree';
}

type SaveArg = Parameters<NonNullable<KitHooks['onSave']>>[0];

/**
 * Запись из строки дерева. Правится только статус (StatusSlot → hooks.onSave);
 * прочее в дереве — чтение, и молча «сохранить» его нельзя.
 */
export async function saveTreeStatus(c: SaveArg, fetchImpl: typeof fetch = loreFetch): Promise<void> {
  if (c.field !== 'status') throw new Error(`в дереве правится только статус, не «${c.field}»`);
  await saveRecordStatus({
    type: statusEntity(c.type),
    id: c.id,
    to: String(c.to),
    was: typeof c.from === 'string' && c.from ? c.from : null,
  }, fetchImpl);
}

export interface SprintTasksPanelProps {
  contract: LoreRecord1;
  /** Статус задачи сменился — паспорт перечитывает запись (показываем записанное). */
  onStatusSaved: () => void;
  fetchImpl?: typeof fetch;
  win?: UrlWindow;
}

const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const md = (s: string) => <MartProse text={s} />;

export function SprintTasksPanel({ contract, onStatusSaved, fetchImpl, win }: SprintTasksPanelProps) {
  const t = useAppT();
  const lang = useKitLang();
  const f = fetchImpl ?? loreFetch;
  const sprintId = contract.record.id;
  const [view, setView] = useState<TaskView>(() => viewFromUrl(win));
  const onView = useCallback((v: TaskView) => {
    setView(v);
    pushUrlState({ [TASK_VIEW_PARAM]: v === 'tree' ? null : v }, { replace: true, win });
  }, [win]);

  // Меню статуса в строке — ЦИКЛ ЗАДАЧИ из модели (S4-STATUS-AXIS-CONFIG):
  // статус в дереве меняется только у задачи. Модель не ответила — умолчание
  // приложения (оговорка об этом уже стоит в шапке паспорта).
  const [taskStatuses, setTaskStatuses] = useState<KitConfig['statuses']['items']>([]);
  useEffect(() => {
    let alive = true;
    fetchTypeStatuses('task', { fetchImpl: f }).then(r => { if (alive) setTaskStatuses(r.items); }, () => { /* умолчание */ });
    return () => { alive = false; };
  }, [f]);

  const tree = useMemo(() => sprintTreeOf(contract), [contract]);
  const ctx: KitCtx = useMemo(() => {
    const fld = (key: string, title: string) => ({ key, title, type: 'text' as const });
    const fields = [
      fld('code', appT(lang, 'sprintTree.field.code')),
      fld('author', appT(lang, 'pp.field.author')),
      fld('executor', appT(lang, 'pp.field.executor')),
      // PU-16 (приёмка 14.11): «автор/ревьюер как в v1» — принимающий после исполнителя.
      fld('reviewer', appT(lang, 'pp.field.reviewer')),
      fld('effort', appT(lang, 'pp.field.effort')),
      fld('progress', appT(lang, 'sprintTree.field.progress')),
      fld('phase', appT(lang, 'sprintTree.kind.phase')),
    ];
    const base = baseConfig(lang, {
      sprint: { title: appT(lang, 'pp.kind.sprint'), icon: 'sprint', fields },
      phase: { title: appT(lang, 'sprintTree.kind.phase'), icon: 'phase', fields },
      task: { title: appT(lang, 'pp.kind.task'), icon: 'task', fields },
    });
    const config: KitConfig = {
      ...base,
      statuses: taskStatuses.length ? { ...base.statuses, items: taskStatuses } : base.statuses,
      // Право сменить статус — то, что сервер сказал про запись спринта; задачу
      // он проверит ещё раз и откажет словами, если права нет.
      roles: { reader: { canEdit: false, canStatus: contract.perms.can_status } },
      hooks: {
        onSave: async c => { await saveTreeStatus(c, f); onStatusSaved(); },
      },
    };
    const kinds = new Map(tree.rows.map(r => [r.key, r.kind]));
    return {
      config,
      data: { records: [], edges: [], journal: [], meta: { generated_at: contract.meta.loaded_at } },
      role: 'reader',
      // Фазы своего раздела в v2 нет — ссылка честно ведёт на якорь, раздел не выдумываем.
      href: (id: string) => recordHref(kinds.get(id) ?? '', id) ?? `#${encodeURIComponent(id)}`,
      esc, md,
    };
  }, [lang, taskStatuses, contract, tree, f, onStatusSaved]);
  const taskRecords = useMemo(() => tree.rows.filter(r => r.kind === 'task').map(treeRowRecord), [tree]);
  const counterTasks = useMemo(() => counterTasksOf(tree.rows), [tree]);
  // Словарь типов — украшение подписи счётчика, не его условие: не пришёл — подпись кодом.
  const [dicts, setDicts] = useState<TaskDicts>({});
  useEffect(() => {
    if (view === 'table') return undefined;
    let live = true;
    const slice = sliceFetcher();
    void loadTaskDicts(lang, (s, p) => slice(s, p)).then(d => { if (live) setDicts(d); }, () => { /* подпись кодом */ });
    return () => { live = false; };
  }, [lang, view]);

  return (
    <>
      <SprintBurnLine sprintId={sprintId} deadline={contract.facts ? (contract.facts.due ?? null) : undefined} />
      <div className="sprint-tasks__views" role="group" aria-label={t('sprintTasks.view.label')}>
        {VIEWS.map(v => (
          <button
            key={v}
            type="button"
            className={['sk-pill', 'sprint-tasks__view', view === v ? 'is-active' : ''].filter(Boolean).join(' ')}
            aria-pressed={view === v}
            onClick={() => onView(v)}
          >
            {t(VIEW_KEY[v])}
          </button>
        ))}
      </div>
      {/* PU-16: полоска счётчиков над деревом и списком; у «Таблицы» своя — по её строкам. */}
      {view !== 'table' && <TaskCounters tasks={counterTasks} types={dicts.taskType} />}
      {view === 'tree' && (
        <TreeTable levels={SPRINT_TREE_LEVELS} columns={SPRINT_TREE_COLUMNS} rows={tree.rows} levelState={tree.levelState} ctx={ctx} controls={TREE_CONTROLS} />
      )}
      {view === 'table' && <SprintTasksTab sprintId={sprintId} fetchImpl={fetchImpl} win={win} />}
      {view === 'list' && (
        // Тот же ответ /lore/record, что у дерева: второго чтения нет.
        <NestedList ctx={ctx} records={taskRecords} columns={LIST_COLUMNS} axes={LIST_AXES} testId="sprint-tasks-list" />
      )}
    </>
  );
}
