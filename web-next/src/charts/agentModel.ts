// №13 «действия агентов по дням» и №14 «отказы MCP по кодам» (предложение 19.11.2026, «добавляй графики»).
// Источник — срез agent_action_points (ряд AgentActionLog, ось agent): момент, профиль (caller),
// клиент KC (client), код ответа (status). Свёртка по дням — здесь.
// Период — последние N дней по сегодня включительно; до 31 дня — по дням, дольше — по неделям (UTC).
// Разрез №13 — по профилю или по клиенту (выбор в адресе). Линий не больше пяти — остальные «прочие».
import { momentMs } from '../admin/moment';
import { weekLabel, weekStart } from '../analytics/analyticsModel';

const DAY = 864e5;
export const SERIES_MAX = 5;
export const REST = '__rest';

export interface ActionPoint { ts: number; caller: string; client: string; status: number | null }

const str = (v: unknown, dflt: string) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : dflt);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function parseActionPoints(rows: readonly Record<string, unknown>[]): { points: ActionPoint[]; undated: number } {
  const points: ActionPoint[] = [];
  let undated = 0;
  for (const r of rows) {
    const ts = momentMs(r.ts);
    if (ts === null) { undated += 1; continue; }
    points.push({ ts, caller: str(r.caller, '(unknown)'), client: str(r.client, '(unknown)'), status: num(r.status) });
  }
  return { points, undated };
}

export interface Buckets { step: 'day' | 'week'; starts: number[]; end: number }

export function periodBuckets(days: number, today: number, dayMax = 31): Buckets {
  const d0 = Math.floor(today / DAY) * DAY;
  if (days <= dayMax) {
    const starts = Array.from({ length: days }, (_, i) => d0 - (days - 1 - i) * DAY);
    return { step: 'day', starts, end: d0 + DAY };
  }
  const first = weekStart(d0 - (days - 1) * DAY), last = weekStart(today);
  const n = Math.floor((last - first) / (7 * DAY)) + 1;
  return { step: 'week', starts: Array.from({ length: n }, (_, i) => first + i * 7 * DAY), end: last + 7 * DAY };
}

const bucketOf = (b: Buckets, ts: number) => {
  if (ts < b.starts[0] || ts >= b.end) return -1;
  const len = b.step === 'day' ? DAY : 7 * DAY;
  return Math.floor((ts - b.starts[0]) / len);
};

/** Подпись корзины «дд.мм» — её первый день (у недели — понедельник). */
export const bucketLabel = (_b: Buckets, x: number) => weekLabel(x);

export interface ActionsSeries {
  buckets: Buckets;
  series: { key: string; points: { x: number; y: number }[] }[];
  total: number;
}

export function actionsOverTime(points: readonly ActionPoint[], days: number, today: number, by: 'caller' | 'client'): ActionsSeries {
  const b = periodBuckets(days, today);
  const per = new Map<string, number[]>();
  let total = 0;
  for (const p of points) {
    const i = bucketOf(b, p.ts);
    if (i < 0) continue;
    const k = p[by];
    const arr = per.get(k) ?? b.starts.map(() => 0);
    arr[i] += 1;
    per.set(k, arr);
    total += 1;
  }
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const keys = [...per.keys()].sort((a, z) => sum(per.get(z)!) - sum(per.get(a)!) || a.localeCompare(z));
  const top = keys.length > SERIES_MAX + 1 ? keys.slice(0, SERIES_MAX) : keys;
  const series = top.map(k => ({ key: k, points: b.starts.map((x, i) => ({ x, y: per.get(k)![i] })) }));
  if (top.length < keys.length) {
    const rest = b.starts.map((_, i) => keys.slice(SERIES_MAX).reduce((s, k) => s + per.get(k)![i], 0));
    series.push({ key: REST, points: b.starts.map((x, i) => ({ x, y: rest[i] })) });
  }
  return { buckets: b, series, total };
}

export interface FailuresByCode {
  buckets: Buckets;
  codes: string[];
  data: { category: string; values: Record<string, number> }[];
  total: number;
}

/** Столбики: дольше двух недель — по неделям (30 столбиков-дней на телефоне не читаются). */
export const BARS_DAY_MAX = 14;

export function failuresByCode(points: readonly ActionPoint[], days: number, today: number): FailuresByCode {
  const b = periodBuckets(days, today, BARS_DAY_MAX);
  const per = new Map<string, number[]>();
  let total = 0;
  for (const p of points) {
    if (p.status === null || p.status < 400) continue;
    const i = bucketOf(b, p.ts);
    if (i < 0) continue;
    const k = String(p.status);
    const arr = per.get(k) ?? b.starts.map(() => 0);
    arr[i] += 1;
    per.set(k, arr);
    total += 1;
  }
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const all = [...per.keys()].sort((a, z) => sum(per.get(z)!) - sum(per.get(a)!) || Number(a) - Number(z));
  const codes = all.length > SERIES_MAX + 1 ? [...all.slice(0, SERIES_MAX), REST] : all;
  const data = b.starts.map((x, i) => {
    const values: Record<string, number> = {};
    for (const c of codes) values[c] = c === REST ? all.slice(SERIES_MAX).reduce((s, k) => s + per.get(k)![i], 0) : per.get(c)![i];
    return { category: bucketLabel(b, x), values };
  });
  return { buckets: b, codes, data, total };
}
