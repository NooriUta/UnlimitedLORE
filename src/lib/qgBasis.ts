// SPRINT_QG_REBUILD/QG-07 — честный baseline: одно правило сравнения метрики прогона с прошлым.
//
// У метрики есть «база» (basis) — отпечаток её знаменателя: состав выборки, фильтр, LIMIT. Значение
// сравнимо с прошлым только при той же базе. Повод: task_done_pct_avg «упала» 99.1% → 78.1% без
// регресса — раньше считались 15 спринтов (LIMIT 15), потом все 357 групп. Молчаливое сравнение
// с другой базой даёт ложную тревогу, а тревога, которая раз за разом ложная, обесценивает настоящие.
//
// Правило общее для всех мест, где прогон сопоставляется с прошлым (блок «Изменилось с прошлого
// прогона», динамика-спарклайн): база сменилась — ряд разрывается с пометкой, а не рисует «падение».
// Две пустые базы — прежнее поведение (легаси-прогоны без базы друг с другом сравнимы); появление
// или пропажа базы — тоже смена выборки.

export interface BasisCarrier {
  status?: string | null;
  value?: number | null;
  basis?: string | null;
}

export type MetricChange =
  | { kind: 'status'; prev: string; cur: string }
  | { kind: 'rebased'; prevBasis: string | null; curBasis: string | null };

/** Пустая строка — не база (иначе «   » и null дали бы ложный разрыв). */
export function normBasis(b: string | null | undefined): string | null {
  if (b == null) return null;
  const s = b.trim();
  return s === '' ? null : s;
}

export function comparable(prev: string | null | undefined, cur: string | null | undefined): boolean {
  return normBasis(prev) === normBasis(cur);
}

/** Изменение метрики между прошлым и текущим прогоном: разрыв базы, смена статуса или ничего. */
export function metricChange(prev: BasisCarrier | undefined, cur: BasisCarrier | undefined): MetricChange | null {
  if (!prev || !cur) return null;
  if (!comparable(prev.basis, cur.basis)) {
    return { kind: 'rebased', prevBasis: normBasis(prev.basis), curBasis: normBasis(cur.basis) };
  }
  if (prev.status && cur.status && prev.status !== cur.status) {
    return { kind: 'status', prev: prev.status, cur: cur.status };
  }
  return null;
}

/**
 * Ряд для динамики (старые → новые): только хвост на базе последней точки. {@code rebased} — ряд
 * обрезан сменой базы, экран обязан это сказать, а не молча показать короткий ряд.
 */
export function currentBasisSegment<T extends { basis?: string | null }>(hist: T[]): { points: T[]; rebased: boolean } {
  if (hist.length === 0) return { points: [], rebased: false };
  const base = normBasis(hist[hist.length - 1].basis);
  let i = hist.length - 1;
  while (i > 0 && normBasis(hist[i - 1].basis) === base) i--;
  return { points: hist.slice(i), rebased: i > 0 };
}
