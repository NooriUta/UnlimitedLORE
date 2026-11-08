// Строка-вердикт шапки записи (SPRINT_UXR_S5_RECORD_TASKS/S5-01):
// «статус · задачи x/y · просрочено · свежесть». Чистая функция над X_DATA
// (запись + рёбра + meta), без сервера и без контракта ядра: настраивается
// параметром RecordFactsSpec у RecordView, конфиг K-01 не меняется.
//
// Честность: задачи, которые не загрузились (meta.errors с блоком errorBlock),
// — это «не смогли проверить», а не 0/0; задач нет — проверенный ноль; срока
// нет — «не задан»; даты обновления нет — «свежесть неизвестна».
// Детерминирована: дни — календарные по UTC, порядок рёбер на входе не влияет.
import type { KitCtx, KitRecord } from '../core/contract';

export interface RecordFactsSpec {
  /** Тип ребра «запись → задача» (напр. HAS_TASK); не задан — факта «задачи» нет. */
  childEdge?: string;
  /** Направление ребра от записи: out (по умолчанию) — запись в from. */
  childDir?: 'out' | 'in';
  /** Ключ record.fields со сроком (ISO-дата); не задан — факта «срок» нет. */
  dueField?: string;
  /** Имя блока в meta.errors, чья ошибка означает «задачи не загрузились». По умолчанию tasks. */
  errorBlock?: string;
  /** До скольких дней включительно запись свежая (suc). По умолчанию 7. */
  freshDays?: number;
  /** До скольких дней включительно — «подустарела» (wrn), дальше — dng. По умолчанию 30. */
  staleDays?: number;
  /** «Сейчас» для расчёта (тесты, снимки); по умолчанию — часы браузера. */
  now?: string | number | Date;
  /** Вкладка вида, куда ведёт «задачи x/y» (одно касание до таблицы задач). */
  tasksTab?: string;
}

export type FactTone = 'suc' | 'wrn' | 'dng' | 'inf' | 't2' | 't3';

export type TasksFact =
  | { state: 'ok'; done: number; total: number; open: number; cancelled: number }
  | { state: 'none' }
  | { state: 'error'; reason: string };

export type DueFact =
  | { state: 'overdue'; days: number }
  | { state: 'today' }
  | { state: 'onTime'; days: number }
  | { state: 'closed' }
  | { state: 'none' };

export type FreshFact = { state: 'ok'; days: number; tone: FactTone } | { state: 'unknown' };

export interface RecordFactsResult {
  tasks: TasksFact | null;
  due: DueFact | null;
  fresh: FreshFact;
}

const DAY = 86_400_000;

/** Номер календарного дня по UTC; не дата — null. Дата без времени — тот же день. */
export function utcDay(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : Math.floor(v.getTime() / DAY);
  if (typeof v === 'number') return Number.isFinite(v) ? Math.floor(v / DAY) : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.floor(t / DAY);
}

function category(code: string, ctx: KitCtx) {
  return ctx.config.statuses.items.find(s => s.code === code)?.category;
}

function isClosed(code: string, ctx: KitCtx): boolean {
  const c = category(code, ctx);
  return c === 'done' || c === 'cancelled';
}

function tasksFact(record: KitRecord, ctx: KitCtx, spec: RecordFactsSpec): TasksFact | null {
  if (!spec.childEdge) return null;
  const err = ctx.data.meta.errors?.find(e => e.block === (spec.errorBlock ?? 'tasks'));
  if (err) return { state: 'error', reason: err.reason };
  const out = (spec.childDir ?? 'out') === 'out';
  const ids = new Set<string>();
  for (const e of ctx.data.edges) {
    if (e.type !== spec.childEdge) continue;
    if (out && e.from === record.id) ids.add(e.to);
    else if (!out && e.to === record.id) ids.add(e.from);
  }
  if (ids.size === 0) return { state: 'none' };
  const byId = new Map(ctx.data.records.map(r => [r.id, r] as const));
  let done = 0;
  let cancelled = 0;
  for (const id of ids) {
    // Задачи нет в выборке или её статус не описан — считаем открытой:
    // «готово» без доказательства не засчитываем.
    const c = category(byId.get(id)?.status ?? '', ctx);
    if (c === 'done') done++;
    else if (c === 'cancelled') cancelled++;
  }
  const total = ids.size - cancelled;
  return { state: 'ok', done, total, open: total - done, cancelled };
}

function dueFact(record: KitRecord, ctx: KitCtx, spec: RecordFactsSpec, today: number): DueFact | null {
  if (!spec.dueField) return null;
  if (isClosed(record.status, ctx)) return { state: 'closed' };
  const due = utcDay(record.fields[spec.dueField]);
  if (due === null) return { state: 'none' };
  if (today > due) return { state: 'overdue', days: today - due };
  if (today === due) return { state: 'today' };
  return { state: 'onTime', days: due - today };
}

function freshFact(record: KitRecord, spec: RecordFactsSpec, today: number): FreshFact {
  const upd = utcDay(record.updated_at);
  if (upd === null) return { state: 'unknown' };
  const days = Math.max(0, today - upd);
  const tone: FactTone = days <= (spec.freshDays ?? 7) ? 'suc' : days <= (spec.staleDays ?? 30) ? 'wrn' : 'dng';
  return { state: 'ok', days, tone };
}

export function recordFacts(record: KitRecord, ctx: KitCtx, spec: RecordFactsSpec): RecordFactsResult {
  const today = utcDay(spec.now ?? Date.now()) ?? Math.floor(Date.now() / DAY);
  return {
    tasks: tasksFact(record, ctx, spec),
    due: dueFact(record, ctx, spec, today),
    fresh: freshFact(record, spec, today),
  };
}

export function tasksTone(t: TasksFact): FactTone {
  if (t.state === 'error') return 'dng';
  if (t.state === 'none') return 't3';
  return t.total > 0 && t.done === t.total ? 'suc' : 't2';
}

export function dueTone(d: DueFact): FactTone {
  return d.state === 'overdue' ? 'dng' : d.state === 'today' ? 'wrn' : d.state === 'onTime' ? 'suc' : 't3';
}
