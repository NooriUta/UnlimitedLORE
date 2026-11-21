// №7 предложения 19.11.2026 («добавляй графики»): прогноз вехи — burnup по задачам её спринтов
// (срезы task_created_dates и task_done_dates, как у сгорания вехи PU-27) и тренд до даты вехи.
//
// Точка недели — значение на КОНЕЦ недели (у текущей — на сегодня), поэтому x = конец недели.
// Темп — закрыто за последние до TREND_WEEKS недель, делённое на их число (единица — задач в неделю).
// Тренд — от сегодняшнего «сделано» вперёд по темпу до срока вехи или до конца по темпу, что позже;
// выше объёма не поднимается. «Нужно к сроку» — прямая от сегодняшнего «сделано» к объёму в срок.
// Честно: меньше двух недель с закрытиями — тренда нет («мало данных»); веха заморожена — прогноза нет;
// срок в «Когда» не распознан — тренд без срока.
import { firstDates, weekStart, type LinePoint, type TaskRow } from '../analytics/analyticsModel';

const DAY = 864e5;
const WEEK = 7 * DAY;
export const FORECAST_WEEKS_MAX = 26;
export const TREND_WEEKS = 6;
const TREND_MAX = 52;

export type ForecastKind = 'ok' | 'late' | 'nodue' | 'few' | 'done' | 'frozen' | 'empty';

export interface MilestoneForecast {
  scope: LinePoint[];
  done: LinePoint[];
  trend: LinePoint[];
  need: LinePoint[];
  /** Задач в неделю (по последним неделям). */
  rate: number;
  remaining: number;
  verdict: { kind: ForecastKind; weeks?: number; finish?: number };
}

export interface ForecastInput {
  created: readonly TaskRow[];
  done: readonly TaskRow[];
  inScope: (uid: string) => boolean;
  today: number;
  /** Срок ГГГГ-ММ-ДД; null — не распознан. */
  due: string | null;
  frozen: boolean;
}

const pick = (rows: readonly TaskRow[], inScope: (uid: string) => boolean) =>
  [...firstDates(rows.filter(r => typeof r.task_uid === 'string' && inScope(r.task_uid))).values()];

export function milestoneForecast(p: ForecastInput): MilestoneForecast {
  const born = pick(p.created, p.inScope);
  const closed = pick(p.done, p.inScope);
  const base = { trend: [] as LinePoint[], need: [] as LinePoint[], rate: 0 };
  if (!born.length) return { ...base, scope: [], done: [], remaining: 0, verdict: { kind: 'empty' } };

  const w0 = weekStart(Math.min(...born, ...closed));
  const wN = weekStart(p.today);
  const n = Math.max(1, Math.min(FORECAST_WEEKS_MAX, Math.floor((wN - w0) / WEEK) + 1));
  const ends = Array.from({ length: n }, (_, i) => Math.min(wN - (n - 1 - i) * WEEK + WEEK, p.today));
  const upTo = (ts: number[], end: number) => ts.filter(t => t < end).length;
  const scope = ends.map(x => ({ x, y: upTo(born, x) }));
  const done = ends.map(x => ({ x, y: upTo(closed, x) }));
  const last = done[n - 1].y, total = scope[n - 1].y;
  const remaining = Math.max(0, total - last);
  const series = { scope, done, remaining };

  if (p.frozen) return { ...base, ...series, verdict: { kind: 'frozen' } };
  if (remaining === 0) return { ...base, ...series, verdict: { kind: 'done' } };

  const win = done.slice(-TREND_WEEKS);
  const prev = (i: number) => (i === 0 ? (done[n - win.length - 1]?.y ?? 0) : win[i - 1].y);
  const weeksWithClosures = win.filter((d, i) => d.y > prev(i)).length;
  const rate = win.length > 1 ? (win[win.length - 1].y - win[0].y) / (win.length - 1) : 0;
  if (weeksWithClosures < 2 || rate <= 0) return { ...base, ...series, verdict: { kind: 'few' } };

  const now = p.today;
  const finish = now + (remaining / rate) * WEEK;
  const dueMs = p.due ? Date.parse(`${p.due}T00:00:00Z`) : null;
  const until = Math.max(finish, dueMs ?? finish);
  const k = Math.min(TREND_MAX, Math.ceil((until - now) / WEEK));
  const trend = Array.from({ length: k + 1 }, (_, i) => ({ x: now + i * WEEK, y: Math.min(total, Math.round((last + i * rate) * 10) / 10) }));
  if (dueMs === null) return { ...series, trend, need: [], rate, verdict: { kind: 'nodue', finish } };
  const need = dueMs > now ? [{ x: now, y: last }, { x: dueMs, y: total }] : [];
  const verdict = finish <= dueMs
    ? { kind: 'ok' as const, weeks: Math.floor((dueMs - finish) / WEEK), finish }
    : { kind: 'late' as const, weeks: Math.ceil((finish - dueMs) / WEEK), finish };
  return { ...series, trend, need, rate, verdict };
}
