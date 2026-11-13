// Модель чтения задачи (SPRINT_UXR_S5_RECORD_TASKS/S5-04): строка слайса
// tasks_of_sprint → запись kit (KitRecord), история history_task → журнал,
// поля задачи → рёбра. Паспорт задачи в URL — всегда пара «спринт/код»:
// одинокий код принадлежит многим спринтам сразу.
import { statusMeta, type KitConfig, type KitData, type KitEdge, type KitJournalEntry, type KitLang, type KitRecord } from '@seidr/kit';
import { taskT, type TaskReadKey } from './taskRead.i18n';
import { appliedGraphView } from '../settings/applied';

/** Строка /lore/slice/tasks_of_sprint (поля — как в LoreSlices.java). */
export interface SprintTaskRow {
  task_uid: string;
  task_id: string;
  title: string | null;
  order_index: number | null;
  status_raw: string | null;
  effort_days: number | null;
  note_md: string | null;
  component_ids: string[] | null;
  realizes_uc?: string[] | null;
  author_agent?: string | null;
  executor_agent?: string | null;
  reviewer_agent?: string | null;
  task_type?: string | null;
  work_class?: string | null;
  phase_uid?: string | null;
}

/** Строка /lore/slice/history_task (состояние SCD2). */
export interface TaskHistRow {
  valid_from: string | null;
  status_raw?: string | null;
  effort_days?: number | null;
  note_md?: string | null;
  source_commit?: string | null;
}

export interface TaskPassport { sprintId: string; taskId: string }

export function parseTaskPassport(p: string | null | undefined): TaskPassport | null {
  if (!p) return null;
  const i = p.indexOf('/');
  if (i <= 0 || i === p.length - 1) return null;
  return { sprintId: p.slice(0, i), taskId: p.slice(i + 1) };
}

export function taskPassport(sprintId: string, taskId: string): string {
  return `${sprintId}/${taskId}`;
}

/** Коды статусов задачи в порядке жизненного цикла. */
export const TASK_STATUS_CODES = [
  'backlog', 'todo', 'planned', 'design', 'in_progress', 'partial', 'ready_for_deploy', 'uat', 'blocked', 'deferred', 'done', 'cancelled',
] as const;

// Слова «закрыто» — как taskTick v1 / LoreStatusVocabulary на бэкенде (QG-13).
const RULES: [RegExp, string][] = [
  [/^(✅|DONE|CLOSED|MERGED|ЗАВЕРШ|ЗАКРЫТ)/i, 'done'],
  [/^(🔄|IN.?PROGRESS|WIP|ACTIVE)/i, 'in_progress'],
  [/^(🟡|PARTIAL|ЧАСТИЧ)/i, 'partial'],
  [/^(🚀|READY.?FOR.?DEPLOY|RFD|К.?ДЕПЛОЮ)/i, 'ready_for_deploy'],
  [/^(🧪|UAT|ПРИЁМК|ПРИЕМК)/i, 'uat'],
  [/^(🔴|BLOCK|ЗАБЛОК)/i, 'blocked'],
  [/^(🚫|CANCEL|ОТМЕН)/i, 'cancelled'],
  [/^(🔬|DESIGN|ДИЗАЙН|ПРОЕКТ)/i, 'design'],
  [/^(🟣|BACKLOG|БЭКЛ)/i, 'backlog'],
  [/^(📋|PLANNED|ЗАПЛАН|ПЛАН)/i, 'planned'],
  [/^(⏸|CONDITION|HOLD|PAUSE|ON.?HOLD|DEFER|ОТЛОЖЕН|УСЛОВН|ПАУ)/i, 'deferred'],
  [/^(⬜|TODO|TO.?DO|НЕ.?НАЧАТ)/i, 'todo'],
];

/**
 * Код статуса из status_raw. Пусто — todo (статус ещё не ставили).
 * Нераспознанное — как есть (строчными): шапка kit честно покажет «статус не
 * описан в конфиге», а не выдумает «к работе».
 */
export function taskStatusCode(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return 'todo';
  const plain = s.toLowerCase();
  if ((TASK_STATUS_CODES as readonly string[]).includes(plain)) return plain;
  for (const [re, code] of RULES) if (re.test(s)) return code;
  return plain;
}

export function sortSprintTasks(rows: readonly SprintTaskRow[]): SprintTaskRow[] {
  return [...rows].sort((a, b) => ((a.order_index ?? Infinity) - (b.order_index ?? Infinity))
    || (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0));
}

export function taskToRecord(row: SprintTaskRow, sprintId: string): KitRecord {
  return {
    id: taskPassport(sprintId, row.task_id),
    kind: 'task',
    title: row.title?.trim() || row.task_id,
    status: taskStatusCode(row.status_raw),
    body_md: row.note_md ?? undefined,
    fields: {
      sprint_id: sprintId,
      task_id: row.task_id,
      task_uid: row.task_uid,
      status_raw: row.status_raw,
      effort_days: row.effort_days,
      task_type: row.task_type ?? null,
      work_class: row.work_class ?? null,
      author_agent: row.author_agent ?? null,
      executor_agent: row.executor_agent ?? null,
      reviewer_agent: row.reviewer_agent ?? null,
      component_ids: row.component_ids ?? [],
      realizes_uc: row.realizes_uc ?? [],
    },
  };
}

/** Соседние состояния SCD2 → изменения полей (статус, оценка, текст). */
export function historyToJournal(recordId: string, hist: readonly TaskHistRow[]): KitJournalEntry[] {
  const out: KitJournalEntry[] = [];
  const rows = [...hist].filter(h => h.valid_from).sort((a, b) => (a.valid_from! < b.valid_from! ? -1 : a.valid_from! > b.valid_from! ? 1 : 0));
  let prev: TaskHistRow | null = null;
  for (const h of rows) {
    const base = { at: h.valid_from!, who: h.source_commit || '—', record_id: recordId };
    const status = taskStatusCode(h.status_raw);
    const prevStatus = prev ? taskStatusCode(prev.status_raw) : null;
    if (status !== prevStatus) out.push({ ...base, field: 'status', from: prevStatus, to: status });
    if (prev && (h.effort_days ?? null) !== (prev.effort_days ?? null)) {
      out.push({ ...base, field: 'effort_days', from: prev.effort_days ?? null, to: h.effort_days ?? null });
    }
    if (prev && (h.note_md ?? null) !== (prev.note_md ?? null)) {
      out.push({ ...base, field: 'note_md', from: prev.note_md ?? null, to: h.note_md ?? null });
    }
    prev = h;
  }
  return out;
}

export type JournalPart = { journal: KitJournalEntry[] } | { journalError: string } | { journalPending: true };

/** Данные для каркаса записи: задачи спринта, рёбра из полей, журнал текущей. */
export function buildTaskData(sprintId: string, rows: readonly SprintTaskRow[], journal: JournalPart): KitData {
  const records = sortSprintTasks(rows).map(r => taskToRecord(r, sprintId));
  const edges: KitEdge[] = [];
  for (const r of records) {
    edges.push({ from: r.id, to: sprintId, type: 'PART_OF' });
    for (const c of (r.fields.component_ids as string[])) edges.push({ from: r.id, to: c, type: 'TAGGED_WITH' });
    for (const u of (r.fields.realizes_uc as string[])) edges.push({ from: r.id, to: u, type: 'REALIZES' });
  }
  const errors = 'journalError' in journal ? [{ block: 'journal', reason: journal.journalError }] : [];
  return {
    records,
    edges,
    journal: 'journal' in journal ? journal.journal : [],
    meta: { generated_at: new Date(0).toISOString(), scope: sprintId, total: records.length, returned: records.length, errors },
  };
}

/** Конфиг kit для задачи: вид, рёбра и статусы (иконки и цвета — statusMeta kit). */
export function taskConfig(lang: KitLang): KitConfig {
  const t = (k: TaskReadKey) => taskT(lang, k);
  return {
    modules: [{ id: 'forseti', title: 'Forseti', icon: 'scales', status: 'active' }],
    menu: { groups: [] },
    kinds: { task: { title: t('task.kind'), icon: 'checkbox-tree' } },
    edges: {
      PART_OF: { label: t('task.edge.PART_OF'), color: 'var(--acc)' },
      TAGGED_WITH: { label: t('task.edge.TAGGED_WITH'), color: 'var(--inf)' },
      REALIZES: { label: t('task.edge.REALIZES'), color: 'var(--suc)' },
    },
    // Вид вкладки «Граф» по умолчанию — личная настройка человека (GC-03).
    graph: { depth: 1, limit: 60, colorBy: 'type', ...(appliedGraphView() ? { view: appliedGraphView() } : {}) },
    // Чтение (S5-04): статус не меняется, пока S5-05 не подключит сохранение.
    roles: { reader: { canEdit: false, canStatus: false } },
    statuses: {
      items: TASK_STATUS_CODES.map(code => {
        const m = statusMeta(code);
        const category = code === 'done' ? 'done' : code === 'cancelled' ? 'cancelled'
          : m.category === 'active' || m.category === 'blocked' || m.category === 'review' ? 'active' : 'todo';
        return { code, title: t(`task.status.${code}` as TaskReadKey), category, icon: m.icon, color: m.color };
      }),
      selfApprove: false,
    },
  };
}
