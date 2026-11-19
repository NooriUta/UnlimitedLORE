// Поток задач по версиям статуса SCD2 (предложение 19.11.2026, «добавляй графики»):
//   №2 — накопительный поток (CFD): сколько задач в каждой полосе статуса на конец дня/недели;
//   №1 — время цикла: дней от первого входа в работу до первого «к выкатке» или «сделано».
// Источник — срез task_status_versions: все версии статуса задачи с началом и концом.
// Статус версии читается тем же planStatusOf, что у списков (словарь statusMatch, якорем).
// Конец версии — её valid_to, а если он пуст у не последней версии (сбой данных) — начало следующей.
// kit только рисует (K-14): ряды собираются здесь.
import { planStatusOf, type ReadStatus } from '../sprints/taskStatus';
import { weekStart } from '../analytics/analyticsModel';

export interface StatusVersionRow {
  task_uid?: string | null;
  sprint_id?: string | null;
  status_raw?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  version_kind?: string | null;
}

/** Полосы потока. Отменённое, проваленное и нераспознанное в поток не входят. */
export type FlowBand = 'todo' | 'active' | 'blocked' | 'rfd' | 'done';
/** Порядок сложения снизу вверх: верхняя линия — весь объём. */
export const FLOW_STACK: readonly FlowBand[] = ['done', 'rfd', 'blocked', 'active', 'todo'];

const BAND: Partial<Record<ReadStatus, FlowBand>> = {
  backlog: 'todo', todo: 'todo', planned: 'todo', design: 'todo', deferred: 'todo',
  active: 'active', partial: 'active', waiting: 'active', review: 'active',
  blocked: 'blocked',
  ready_for_deploy: 'rfd', uat: 'rfd',
  done: 'done',
};

export const bandOf = (s: ReadStatus): FlowBand | null => BAND[s] ?? null;

export interface Seg { from: number; to: number | null; status: ReadStatus; band: FlowBand | null }

export interface Timelines {
  tasks: Map<string, Seg[]>;
  /** Строк охвата без даты начала — в счёт не вошли (график говорит «показана часть»). */
  undated: number;
}

const DAY = 864e5;

export const parseTs = (v: unknown): number | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v.length <= 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? t : null;
};

/** Версии по задачам охвата, по времени; конец версии — valid_to или начало следующей. */
export function taskTimelines(rows: readonly StatusVersionRow[], inScope: (uid: string) => boolean = () => true): Timelines {
  const raw = new Map<string, { from: number; to: number | null; status: ReadStatus }[]>();
  const undatedUids = new Set<string>();
  for (const r of rows) {
    const uid = typeof r.task_uid === 'string' ? r.task_uid : '';
    if (!uid || !inScope(uid)) continue;
    const from = parseTs(r.valid_from);
    if (from === null) { undatedUids.add(uid); continue; }
    const list = raw.get(uid) ?? [];
    list.push({ from, to: parseTs(r.valid_to), status: planStatusOf(r.status_raw) });
    raw.set(uid, list);
  }
  const tasks = new Map<string, Seg[]>();
  for (const [uid, list] of raw) {
    list.sort((a, b) => a.from - b.from);
    tasks.set(uid, list.map((v, i) => {
      const next = list[i + 1]?.from;
      const to = next === undefined ? v.to : v.to === null ? next : Math.min(v.to, next);
      return { from: v.from, to, status: v.status, band: bandOf(v.status) };
    }));
  }
  let undated = 0;
  for (const uid of undatedUids) if (!tasks.has(uid)) undated += 1;
  return { tasks, undated };
}

/** Полоса задачи в момент t; null — задачи ещё нет или она вне потока. */
export function bandAt(segs: readonly Seg[], t: number): FlowBand | null {
  for (const s of segs) if (s.from <= t && (s.to === null || t < s.to)) return s.band;
  return null;
}

export interface CfdSeries {
  step: 'day' | 'week';
  /** Начала дней/недель. */
  x: number[];
  /** Сложенные полосы: stack.rfd = сделано + к выкатке, и т.д.; stack.todo — весь объём. */
  stack: Record<FlowBand, number[]>;
  /** Задач в потоке (с датой). */
  tasks: number;
}

/** До шести недель — по дням, дольше — по неделям (не больше 26 последних). */
export const CFD_DAYS_MAX = 42;
export const CFD_WEEKS_MAX = 26;

export function cfdSeries(tl: Timelines, today: number): CfdSeries {
  const empty = { step: 'day' as const, x: [], stack: { done: [], rfd: [], blocked: [], active: [], todo: [] }, tasks: tl.tasks.size };
  let first = Infinity;
  for (const segs of tl.tasks.values()) if (segs.length) first = Math.min(first, segs[0].from);
  if (!Number.isFinite(first)) return empty;
  const day0 = Math.floor(first / DAY) * DAY;
  const dayN = Math.floor(today / DAY) * DAY;
  const days = Math.floor((dayN - day0) / DAY) + 1;
  let step: 'day' | 'week';
  let x: number[];
  let len: number;
  if (days <= CFD_DAYS_MAX) {
    step = 'day'; len = DAY;
    x = Array.from({ length: days }, (_, i) => day0 + i * DAY);
  } else {
    step = 'week'; len = 7 * DAY;
    const w0 = weekStart(first), wN = weekStart(today);
    const n = Math.min(CFD_WEEKS_MAX, Math.floor((wN - w0) / len) + 1);
    x = Array.from({ length: n }, (_, i) => wN - (n - 1 - i) * len);
  }
  const counts: Record<FlowBand, number[]> = { done: [], rfd: [], blocked: [], active: [], todo: [] };
  for (const b of FLOW_STACK) counts[b] = x.map(() => 0);
  x.forEach((start, i) => {
    const at = Math.min(start + len - 1, today);
    for (const segs of tl.tasks.values()) {
      const b = bandAt(segs, at);
      if (b) counts[b][i] += 1;
    }
  });
  const stack: Record<FlowBand, number[]> = { done: [], rfd: [], blocked: [], active: [], todo: [] };
  let below = x.map(() => 0);
  for (const b of FLOW_STACK) {
    below = below.map((v, i) => v + counts[b][i]);
    stack[b] = below;
  }
  return { step, x, stack, tasks: tl.tasks.size };
}

export interface CyclePoint { id: string; x: number; y: number }

export interface CycleTimes {
  points: CyclePoint[];
  /** Дошли до «к выкатке»/«сделано», ни разу не побыв в работе (заведены закрытыми и т.п.) — без точки. */
  skippedWork: number;
  /** В работе и ещё не дошли до «к выкатке»/«сделано». */
  inWork: number;
}

const WORK: ReadonlySet<FlowBand> = new Set(['active', 'blocked']);
const FINISH: ReadonlySet<FlowBand> = new Set(['rfd', 'done']);

/** Время цикла; from — точки только с окончанием не раньше этого момента. */
export function cycleTimes(tl: Timelines, from = -Infinity): CycleTimes {
  const points: CyclePoint[] = [];
  let skippedWork = 0, inWork = 0;
  for (const [id, segs] of tl.tasks) {
    const start = segs.find(s => s.band !== null && WORK.has(s.band));
    const finishAny = segs.find(s => s.band !== null && FINISH.has(s.band));
    if (!start) { if (finishAny) skippedWork += 1; continue; }
    const end = segs.find(s => s.from >= start.from && s.band !== null && FINISH.has(s.band));
    if (!end) { inWork += 1; continue; }
    if (end.from < from) continue;
    points.push({ id, x: end.from, y: Math.round(((end.from - start.from) / DAY) * 10) / 10 });
  }
  return { points: points.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id)), skippedWork, inWork };
}
