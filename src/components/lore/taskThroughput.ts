// Пропускная способность задач по ISO-неделям — только реальные закрытия.
//
// Отсечки:
//  - valid_from >= 12 июн (раньше — массовый импорт);
//  - states > 1 (реальная прогрессия, а не «рождена done» / архивный дамп);
//  - SPRINT_LORE_MEASURE_TRUTH/MT-CAL-BOOKKEEPING: bookkeeping = запись уже
//    сделанной работы задним числом. Её done_date — дата простановки статуса,
//    а не работы (4–5.11 закрыто 45 спринтов разом). Исключается и называется
//    числом: молча выкинутое неотличимо от «такого не было».

export const TASK_THROUGHPUT_CUTOFF = '2026-06-12';

export type DoneRow = {
  valid_from: string | null;
  states: number | number[] | null;
  bookkeeping?: boolean | boolean[] | null;
};

const first = <T,>(v: T | T[] | null | undefined): T | null | undefined =>
  Array.isArray(v) ? v[0] : v;

/** Строка — запись задним числом (флаг на вершине задачи). */
export const isBookkeeping = (r: { bookkeeping?: boolean | boolean[] | null }): boolean =>
  first(r.bookkeeping) === true;

// ISO week key "YYYY-Www"
export function isoWeekKey(d: Date): string {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const thu = new Date(tmp);
  thu.setUTCDate(thu.getUTCDate() - (tmp.getUTCDay() + 6) % 7 + 3);
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  const w    = 1 + Math.round((thu.getTime() - jan4.getTime()) / 604800000);
  return `${thu.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

export function taskThroughputOf(rows: DoneRow[]) {
  const map = new Map<string, number>();
  let counted = 0;
  let bookkeepingExcluded = 0;
  rows.forEach(t => {
    const st = first(t.states);
    const raw = String(t.valid_from ?? '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return;        // skip epoch/garbage
    const day = raw.slice(0, 10);
    if (day < TASK_THROUGHPUT_CUTOFF) return;            // skip import era
    if (!st || st <= 1) return;                          // skip archived "born done"
    if (isBookkeeping(t)) { bookkeepingExcluded++; return; }
    const wk = isoWeekKey(new Date(day));
    map.set(wk, (map.get(wk) ?? 0) + 1); counted++;
  });
  const weeks = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12)
    .map(([key, count]) => ({ key, label: `W${key.split('-W')[1]}`, count }));
  const avg = weeks.length ? Math.round(counted / weeks.length) : 0;
  return { weeks, counted, avg, bookkeepingExcluded };
}
