// V2-03 (ANA-01 в отменённом оригинале SPRINT_BRAGI_ARCHIVE_IMPL): вычисляемые
// метрики ретроспективы — CTR, демо-rate, медиана-бенчмарк канала. Считаются
// на чтении, в TIMESERIES не пишутся (производные не хранить — MetricSnapshot
// несёт только сырые замеры). Деление на ноль → null, рендер решает сам,
// показывать ли «—» — чистая функция не знает про UI.

/** clicks/views или demo/clicks — доля в процентах, null при делении на ноль (не 0). */
export function ratioPct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

/** Медиана массива чисел. Пустой массив → null (не 0 — «нечего мерить», а не «ноль»). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Медиана CTR по каждому каналу — бенчмарк «обычного для канала» из ANA-01.
 * Строки без канала или с null CTR (views=0) не участвуют в подсчёте медианы
 * своего канала — они не характеризуют «типичный» результат, а несут
 * собственную неопределённость.
 */
export function channelCtrMedians(rows: { channel: string | null; ctr: number | null }[]): Map<string, number> {
  const byChannel = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.channel || r.ctr === null) continue;
    const arr = byChannel.get(r.channel) ?? [];
    arr.push(r.ctr);
    byChannel.set(r.channel, arr);
  }
  const out = new Map<string, number>();
  for (const [channel, values] of byChannel) {
    const m = median(values);
    if (m !== null) out.set(channel, m);
  }
  return out;
}

export type BenchmarkArrow = '▲' | '▼' | null;

/**
 * ▲/▼ относительно медианы канала. Строгое сравнение — равенство медиане не
 * стрелка ни в одну сторону (это и есть «типичный» результат, помечать
 * лучше/хуже нечем). null при отсутствии значения или медианы (< 2 замеров
 * канала, или единственный замер — медиана не показательна).
 */
export function benchmarkArrow(value: number | null, channelMedian: number | undefined): BenchmarkArrow {
  if (value === null || channelMedian === undefined) return null;
  if (value > channelMedian) return '▲';
  if (value < channelMedian) return '▼';
  return null;
}

/** Окно ретроспективы: null — «за всё время», иначе часы от даты публикации. */
export type RetroWindowHours = null | 72 | 168;

/**
 * V2-04: значение метрики в окне, исходя из того, что точка MetricSnapshot для
 * views/clicks/demo_conv — НАКОПИТЕЛЬНЫЙ снимок («всего к моменту ts»).
 *
 * - окно null («за всё время») — последний снимок;
 * - окно N часов — последний снимок не позже published_at + N ч. Посты разного
 *   возраста сравниваются в одинаковых окнах, а не «старое всегда больше»;
 * - снимка в окне нет — value null («мало точек»), а не 0: ноль утверждал бы,
 *   что просмотров не было, хотя их просто не замерили;
 * - у окна нет даты публикации — тоже null: подменить окно на «всё время»
 *   значило бы показать цифру не того окна, которое выбрано.
 * `points` — сколько снимков попало в окно (для подписи «мало точек»).
 */
export function snapshotValue(
  points: { metric: string; value: number; ts: string }[],
  metric: string,
  publishedAt: string | null,
  windowHours: RetroWindowHours | number,
): { value: number | null; points: number } {
  let limit = Infinity;
  if (windowHours !== null) {
    const start = publishedAt ? Date.parse(/T/.test(publishedAt) ? publishedAt : `${publishedAt}T00:00:00Z`) : NaN;
    if (Number.isNaN(start)) return { value: null, points: 0 };
    limit = start + windowHours * 3600_000;
  }
  const inWindow = points
    .filter(p => p.metric === metric)
    .map(p => ({ v: p.value, t: Date.parse(p.ts) }))
    .filter(p => !Number.isNaN(p.t) && p.t <= limit)
    .sort((a, b) => a.t - b.t);
  return inWindow.length === 0
    ? { value: null, points: 0 }
    : { value: inWindow[inWindow.length - 1].v, points: inWindow.length };
}
