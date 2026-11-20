// Графики второй пачки (предложение 19.11.2026, «добавляй графики»): 3, 4, 5, 6, 8, 9, 11, 16 —
// подготовка данных. kit только рисует (K-14). Неделя — с понедельника UTC (как во всей «Аналитике»).
// Честно: то, что нельзя поставить точкой (нет даты, PR не довязаны, статус положен бэкфиллом), не
// рисуется нулём, а считается и говорится словами.
import { firstDates, lastWeeks, perWeek, weekLabel, type LinePoint, type TaskRow, type WeekBars } from '../analytics/analyticsModel';
import { decisionStatusOf } from '../lists/axisStatus';
import { planStatusOf } from '../sprints/taskStatus';
import { bandOf, parseTs, type Timelines } from './flowModel';

const DAY = 864e5;
const WEEK = 7 * DAY;
const r1 = (v: number) => Math.round(v * 10) / 10;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return r1(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

// ── №3 WIP по исполнителям ────────────────────────────────────────────────────
/** Исполнителей на графике не больше — остальные «прочие» (одной строкой таблицы). */
export const WIP_MAX = 12;
export interface WipRow { task_uid?: unknown; status_raw?: unknown; executor_agent?: unknown }

/** В работе (в работе, частично, ждёт, ревью) и заблокировано — по исполнителю задачи (роль executor). */
export function wipByExecutor(rows: readonly WipRow[], noneLabel: string, restLabel = '…') {
  const m = new Map<string, { active: number; blocked: number }>();
  let total = 0;
  for (const r of rows) {
    const b = bandOf(planStatusOf(typeof r.status_raw === 'string' ? r.status_raw : null));
    if (b !== 'active' && b !== 'blocked') continue;
    const who = str(r.executor_agent) ?? noneLabel;
    const c = m.get(who) ?? { active: 0, blocked: 0 };
    c[b] += 1;
    m.set(who, c);
    total += 1;
  }
  const sorted = [...m.entries()].sort((a, z) => (z[1].active + z[1].blocked) - (a[1].active + a[1].blocked) || a[0].localeCompare(z[0]));
  const top = sorted.slice(0, WIP_MAX);
  const rest = sorted.slice(WIP_MAX);
  const data = top.map(([category, v]) => ({ category, values: { active: v.active, blocked: v.blocked } as Record<string, number> }));
  if (rest.length) data.push({ category: restLabel, values: { active: rest.reduce((s, [, v]) => s + v.active, 0), blocked: rest.reduce((s, [, v]) => s + v.blocked, 0) } });
  return { data, total, people: m.size };
}

// ── №4 возраст открытых задач ─────────────────────────────────────────────────
export const AGE_BUCKETS = ['lt1w', 'w1_2', 'w2_4', 'm1_2', 'm2_3', 'gt3m'] as const;
const AGE_EDGES = [7, 14, 30, 60, 90];

/** Открытая — последняя версия в полосе потока, кроме «сделано». Возраст — от первой версии. */
export function openAgeHistogram(tl: Timelines, today: number) {
  const counts = AGE_BUCKETS.map(() => 0);
  let open = 0, olderThanMonth = 0;
  for (const segs of tl.tasks.values()) {
    const last = segs[segs.length - 1];
    if (!last || last.band === null || last.band === 'done') continue;
    const age = (today - segs[0].from) / DAY;
    const i = AGE_EDGES.findIndex(e => age < e);
    counts[i < 0 ? AGE_EDGES.length : i] += 1;
    open += 1;
    if (age >= 30) olderThanMonth += 1;
  }
  return { data: AGE_BUCKETS.map((k, i) => ({ category: k as string, values: { n: counts[i] } as Record<string, number> })), open, olderThanMonth };
}

// ── №5 блокировки во времени ──────────────────────────────────────────────────
/** На конец каждой недели: задач в блоке и сколько дней в среднем длится их текущий блок. */
export function blockedWeekly(tl: Timelines, today: number, weeks = 12) {
  const ws = lastWeeks(weeks, today);
  const count: LinePoint[] = [];
  const meanDays: LinePoint[] = [];
  for (const w of ws) {
    const at = Math.min(w + WEEK - 1, today);
    const stints: number[] = [];
    for (const segs of tl.tasks.values()) {
      const i = segs.findIndex(s => s.from <= at && (s.to === null || at < s.to));
      if (i < 0 || segs[i].band !== 'blocked') continue;
      let k = i;
      while (k > 0 && segs[k - 1].band === 'blocked') k -= 1;
      stints.push((at - segs[k].from) / DAY);
    }
    count.push({ x: w, y: stints.length });
    meanDays.push({ x: w, y: stints.length ? r1(stints.reduce((s, v) => s + v, 0) / stints.length) : null });
  }
  return { count, meanDays };
}

// ── №6 velocity по задачам ────────────────────────────────────────────────────
export function tasksClosedWeekly(done: readonly TaskRow[], inScope: (uid: string) => boolean, today: number, weeks = 12): WeekBars[] {
  const ws = lastWeeks(weeks, today);
  const mine = done.filter(r => typeof r.task_uid === 'string' && inScope(r.task_uid));
  return perWeek(firstDates(mine).values(), ws).map((t, i) => ({ category: weekLabel(ws[i]), values: { t } }));
}

// ── №8 ритм релизов ───────────────────────────────────────────────────────────
export interface ReleaseRow { release_uid?: unknown; git_tag?: unknown; release_id?: unknown; release_date?: unknown; released_at?: unknown; pr_count?: unknown }

export function releaseRhythm(rows: readonly ReleaseRow[]) {
  const dated: { x: number; y: number; label: string }[] = [];
  let undated = 0, noPrs = 0;
  for (const r of rows) {
    const x = parseTs(r.released_at) ?? parseTs(r.release_date);
    if (x === null) { undated += 1; continue; }
    const n = typeof r.pr_count === 'number' ? r.pr_count : Number(r.pr_count ?? NaN);
    dated.push({ x, y: Number.isFinite(n) ? n : 0, label: str(r.git_tag) ?? str(r.release_id) ?? str(r.release_uid) ?? '?' });
  }
  dated.sort((a, b) => a.x - b.x);
  const gaps = dated.slice(1).map((d, i) => (d.x - dated[i].x) / DAY);
  const points = dated.filter(d => { if (d.y > 0) return true; noPrs += 1; return false; });
  return { points, undated, noPrs, medianGapDays: median(gaps) };
}

// ── №9 от мержа до прода ─────────────────────────────────────────────────────
export interface ShipRow { pr_uid?: unknown; pr_number?: unknown; merged_at?: unknown; release_date?: unknown; released_at?: unknown; release_id?: unknown }

export function mergeToProd(rows: readonly ShipRow[]) {
  const points: { x: number; y: number; label: string }[] = [];
  const raw: number[] = [];
  let noMerge = 0, mergedAfter = 0, noRelease = 0;
  for (const r of rows) {
    const m = parseTs(r.merged_at);
    const rel = parseTs(r.released_at) ?? parseTs(r.release_date);
    if (rel === null) { noRelease += 1; continue; }
    if (m === null) { noMerge += 1; continue; }
    if (m > rel + DAY) { mergedAfter += 1; continue; }
    const d = Math.max(0, (rel - m) / DAY);
    raw.push(d);
    points.push({ x: rel, y: r1(d), label: str(r.pr_uid) ?? String(r.pr_number ?? '?') });
  }
  return { points: points.sort((a, b) => a.x - b.x || a.label.localeCompare(b.label)), noMerge, mergedAfter, noRelease, median: median(raw) };
}

// ── №11 поток решений ─────────────────────────────────────────────────────────
export const DECISION_FLOW = ['proposed', 'accepted', 'deferred', 'superseded'] as const;
export interface DecisionVersionRow { decision_id?: unknown; status_raw?: unknown; valid_from?: unknown; status_backfilled?: unknown }

/** Переход — версия, чей статус отличается от прежней версии решения (первая версия — всегда). Бэкфилл — не переход. */
export function decisionFlow(rows: readonly DecisionVersionRow[], today: number, weeks = 12) {
  const ws = lastWeeks(weeks, today);
  const by = new Map<string, { t: number; s: string; bf: boolean }[]>();
  let undated = 0;
  for (const r of rows) {
    const id = str(r.decision_id);
    const t = parseTs(r.valid_from);
    if (!id) continue;
    if (t === null) { undated += 1; continue; }
    const list = by.get(id) ?? [];
    list.push({ t, s: decisionStatusOf(r.status_raw), bf: r.status_backfilled === true });
    by.set(id, list);
  }
  const times: Record<string, number[]> = Object.fromEntries(DECISION_FLOW.map(k => [k, [] as number[]]));
  let backfilled = 0;
  for (const list of by.values()) {
    list.sort((a, b) => a.t - b.t);
    list.forEach((v, i) => {
      if (i > 0 && list[i - 1].s === v.s) return;
      if (v.bf) { backfilled += 1; return; }
      if (v.s in times) times[v.s].push(v.t);
    });
  }
  const per = Object.fromEntries(DECISION_FLOW.map(k => [k, perWeek(times[k], ws)]));
  return {
    data: ws.map((w, i) => ({ category: weekLabel(w), values: Object.fromEntries(DECISION_FLOW.map(k => [k, per[k][i]])) as Record<string, number> })),
    backfilled, undated,
  };
}

// ── №16 гейты ─────────────────────────────────────────────────────────────────
export interface GateRunRow { routine_name?: unknown; run_date?: unknown; started_at?: unknown; status?: unknown }
const runTime = (r: GateRunRow) => parseTs(r.started_at) ?? parseTs(r.run_date);
const isPass = (r: GateRunRow) => typeof r.status === 'string' && r.status.trim().toUpperCase() === 'PASS';

function shareByWeek(runs: readonly GateRunRow[], ws: number[]): (number | null)[] {
  const pass = perWeek(runs.filter(isPass).map(runTime).filter((t): t is number => t !== null), ws);
  const all = perWeek(runs.map(runTime).filter((t): t is number => t !== null), ws);
  return all.map((n, i) => (n ? Math.round((pass[i] / n) * 100) : null));
}

/** Доля прогонов PASS по неделям у одного гейта (имя рутины), %; неделя без прогонов — пропуск. */
export function gatePassShare(rows: readonly GateRunRow[], routine: string, today: number, weeks = 12) {
  const ws = lastWeeks(weeks, today);
  const mine = rows.filter(r => r.routine_name === routine);
  const share = shareByWeek(mine, ws);
  const end = ws[ws.length - 1] + WEEK;
  const runs = mine.filter(r => { const t = runTime(r); return t !== null && t >= ws[0] && t < end; }).length;
  return { points: ws.map((x, i) => ({ x, y: share[i] })), runs };
}

/** Матрица гейт × неделя: доля PASS, %. */
export function gatesHeat(rows: readonly GateRunRow[], today: number, weeks = 12) {
  const ws = lastWeeks(weeks, today);
  const names = [...new Set(rows.map(r => str(r.routine_name)).filter((x): x is string => x !== null))].sort();
  const undated = rows.filter(r => runTime(r) === null).length;
  return {
    rows: names,
    cols: ws.map(weekLabel),
    values: names.map(n => shareByWeek(rows.filter(r => r.routine_name === n), ws)),
    undated,
  };
}
