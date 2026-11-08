// Данные вкладки «Задачи» спринта (SPRINT_UXR_S5_RECORD_TASKS/S5-02).
// Чтение — слайсы tasks_of_sprint и phases_of_sprint (те же, что у v1),
// запись — существующие эндпоинты задачи: POST /lore/status (статус) и
// POST /lore/task/edit (заголовок, оценка, роли). Новых серверных ручек нет.
//
// v1 (src/api/lore.ts) не импортируется — он заморожен
// (D-2026-UXR-V2-FOLDER-V1-FROZEN). Общий API-клиент v2 строит S4; когда он
// появится, этот модуль переезжает на него, контракт функций не меняется.
//
// Ошибки не глотаются: LoreHttpError несёт HTTP-статус, kit по нему отличает
// «нет прав» (403) от сбоя, а errorDetail показывает «HTTP 409 · текст».
import type { TaskPatch, TaskPhase, TaskRowData, TaskStatus, SliceCompletenessMeta } from '@seidr/kit';
import { loreFetch } from '../auth/session';

const LORE = '/lore';

export class LoreHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  constructor(status: number, code: string, detail: string) {
    super(detail || code || `HTTP ${status}`);
    this.name = 'LoreHttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Заголовки входа. Своего входа у v2 пока нет (его заводит S4/S3): по умолчанию
 * — dev-роль только при выключенной аутентификации (как v1), иначе пусто —
 * и запись честно получает 401, а не «молча ничего». Экран входа подставит
 * Bearer через setLoreAuthHeaders.
 */
const devHeaders = (): Record<string, string> =>
  import.meta.env?.VITE_LORE_AUTH_ENABLED === 'false' ? { 'X-Seer-Role': 'admin' } : {};
let authHeaders: () => Record<string, string> = devHeaders;

export function setLoreAuthHeaders(fn: () => Record<string, string>): void {
  authHeaders = fn;
}

async function parse<T>(res: Response): Promise<T> {
  const json = (res.headers.get('Content-Type') ?? '').includes('application/json');
  if (!json) throw new LoreHttpError(res.status, 'NON_JSON', `ответ не JSON (HTTP ${res.status})`);
  const body = (await res.json().catch(() => null)) as (T & { error?: string; detail?: string }) | null;
  if (!res.ok) throw new LoreHttpError(res.status, body?.error ?? res.statusText, body?.detail ?? '');
  if (body === null) throw new LoreHttpError(res.status, 'BAD_JSON', 'тело ответа не разобрано');
  return body;
}

async function get<T>(path: string, params: Record<string, string>, signal: AbortSignal | undefined, f: typeof fetch): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await f(`${LORE}${path}${qs ? `?${qs}` : ''}`, { signal, headers: { ...authHeaders() } });
  return parse<T>(res);
}

async function post<T>(path: string, body: unknown, f: typeof fetch): Promise<T> {
  const res = await f(`${LORE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  return parse<T>(res);
}

/** Строка слайса tasks_of_sprint (поля, которые читает вкладка). */
export interface SprintTaskApiRow {
  task_uid: string;
  task_id: string;
  title: string | null;
  order_index: number | null;
  phase_uid: string | null;
  status_raw: string | null;
  effort_days: number | null;
  executor_agent?: string | null;
  reviewer_agent?: string | null;
  task_type?: string | null;
  /** S4-36: класс работы; срез отдаёт его рядом с типом задачи. */
  work_class?: string | null;
  [k: string]: unknown;
}

export interface SprintPhaseApiRow {
  phase_uid: string;
  phase_id: string;
  order_index: number | null;
  title: string | null;
  [k: string]: unknown;
}

type SliceBody<R> = SliceCompletenessMeta & { rows?: R[] };

export function toTaskRow(r: SprintTaskApiRow): TaskRowData {
  return {
    uid: r.task_uid,
    id: r.task_id,
    title: r.title ?? null,
    status: r.status_raw ?? null,
    phase: r.phase_uid ?? null,
    effortDays: typeof r.effort_days === 'number' ? r.effort_days : null,
    executor: r.executor_agent ?? null,
    reviewer: r.reviewer_agent ?? null,
    taskType: r.task_type ?? null,
    workClass: r.work_class ?? null,
    order: r.order_index ?? 0,
  };
}

function toPhase(r: SprintPhaseApiRow): TaskPhase {
  return { uid: r.phase_uid, id: r.phase_id, title: r.title ?? null, order: r.order_index ?? 0 };
}

/** Ответ для useLoadState: rows — задачи, метаданные полноты — из слайса задач. */
export type SprintTasksData = SliceCompletenessMeta & { rows: TaskRowData[]; phases: TaskPhase[] };

export async function loadSprintTasks(sprintId: string, signal?: AbortSignal, f: typeof fetch = loreFetch): Promise<SprintTasksData> {
  const p = { sprint_id: sprintId };
  // Сбой любого из двух — сбой загрузки: «задачи без фаз» при упавшем слайсе
  // фаз было бы враньём о структуре спринта.
  const [t, ph] = await Promise.all([
    get<SliceBody<SprintTaskApiRow>>('/slice/tasks_of_sprint', p, signal, f),
    get<SliceBody<SprintPhaseApiRow>>('/slice/phases_of_sprint', p, signal, f),
  ]);
  const { rows: _rows, ...meta } = t;
  void _rows;
  return { ...meta, rows: (t.rows ?? []).map(toTaskRow), phases: (ph.rows ?? []).map(toPhase) };
}

export async function setTaskStatus(taskUid: string, status: TaskStatus, f: typeof fetch = loreFetch): Promise<void> {
  await post('/status', { entity_type: 'task', id: taskUid, status }, f);
}

/**
 * POST /lore/task/edit. title обязателен всегда (бэкенд отказывает без него) —
 * неизменённый уходит текущим; остальные поля null = «не трогать».
 */
export async function editTask(task: TaskRowData, patch: TaskPatch, f: typeof fetch = loreFetch): Promise<void> {
  await post('/task/edit', {
    task_uid: task.uid,
    title: patch.title ?? task.title ?? '',
    note_md: null,
    effort_days: patch.effortDays ?? null,
    executor_agent: patch.executor ?? null,
    reviewer_agent: patch.reviewer ?? null,
  }, f);
}
