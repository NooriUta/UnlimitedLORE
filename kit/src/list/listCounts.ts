// Счётчики списка, посчитанные ИСТОЧНИКОМ ДАННЫХ (SPRINT_UXR_S9_SCALE_OPT/S9-01).
//
// `facetOf` и `quickCounts` считают по `data.records` — по тому, что влезло в
// страницу выдачи. Рядом стоит «Показано 1000 из 4000», и счётчик читается как
// число по всей выдаче, хотя посчитан по тысяче. Поэтому источник может
// прислать свои числа, а здесь живут правила, КОГДА им верить и что говорить,
// когда их нет.
//
// kit знает только форму (K-14): «ось», «значение», «посчитано / не посчитано /
// посчитано не целиком». Что это за ось и откуда числа — знает приложение; имён
// полей и типов предметной области здесь нет.
import type { KitFilter } from '../core/contract';
import type { Facet } from './filterModel';

/** Посчитана ли выдача целиком. */
export type CountsCompleteness = 'complete' | 'partial' | 'unknown';

/** Счётчики одной оси. Σcount бывает БОЛЬШЕ total: у записи бывает несколько значений. */
export interface AxisCounts {
  /** Значения со счётчиком, порядком источника (у него — по убыванию счёта). */
  values: readonly { value: string; count: number }[];
  /** Записей без значения. */
  empty: number;
  /** Записей со значением. */
  nonempty: number;
  /** Записей в выдаче без фильтра ЭТОЙ оси. */
  total: number;
  /** У записи бывает несколько значений: Σcount > total — норма, а не сбой счёта. */
  multi?: boolean;
}

/**
 * Что пришло от источника счётчиков. Разные отказы — разные ответы:
 * «счётчиков не бывает» ≠ «нет прав» ≠ «сбой» ≠ «ноль».
 */
export type ListCounts =
  | {
    kind: 'counted';
    /** Ось → счётчики. Оси здесь нет — её НЕ спрашивали, это не ноль. */
    axes: Record<string, AxisCounts>;
    /** Ось → причина, почему не посчитана. Это «не знаем», а не ноль. */
    unavailable?: Record<string, string>;
    completeness?: CountsCompleteness;
    /** Счёт упёрся в предел: какие части обрезаны и каким числом. */
    cap?: { parts: readonly string[]; limit: number };
  }
  /** Счётчиков по всей выдаче у этого источника не бывает — не «ноль». */
  | { kind: 'unsupported' }
  /** Источник отказал (нет разрешённых областей видимости) — не «пусто». */
  | { kind: 'forbidden'; reason?: string }
  | { kind: 'failed'; reason?: string };

/** Чем выдача сужена сейчас: ключи включённых фильтров полей и есть ли текст. */
export interface CountsNarrowing { keys: readonly string[]; text?: boolean }

/** Откуда взять число оси. */
export type AxisSource =
  | { from: 'all'; axis: AxisCounts }
  | { from: 'unknown'; reason?: string }
  | { from: 'page' };

const bare = (k: string): string => (k.startsWith('fields.') ? k.slice(7) : k);

/** Одна и та же ось, записанная «fields.x» и «x» (как у `fieldValue`). */
export function sameAxis(a: string, b: string): boolean {
  return bare(a) === bare(b);
}

/** Счётчики оси по любому её написанию. */
export function axisOf(axes: Record<string, AxisCounts>, key: string): AxisCounts | undefined {
  const own = axes[key];
  if (own) return own;
  const hit = Object.keys(axes).find(k => sameAxis(k, key));
  return hit === undefined ? undefined : axes[hit];
}

function reasonOf(unavailable: Record<string, string> | undefined, key: string): string | undefined {
  if (!unavailable) return undefined;
  const hit = Object.keys(unavailable).find(k => sameAxis(k, key));
  return hit === undefined ? undefined : unavailable[hit];
}

/**
 * Откуда взять число для оси.
 *
 * Источник считает ось по выдаче БЕЗ фильтра своей оси, но с прочими условиями
 * — а прочие условия мы ему не отправляли. Значит, его числа годятся, пока
 * выдачу не сузило что-то ДРУГОЕ: свой фильтр оси не мешает (его и источник не
 * учитывает), чужой фильтр или текст — мешают, и тогда число остаётся по
 * загруженной странице и называется так.
 */
export function axisSource(counts: ListCounts | undefined, key: string, narrow: CountsNarrowing): AxisSource {
  if (!counts) return { from: 'page' };
  if (counts.kind === 'unsupported') return { from: 'page' };
  if (counts.kind === 'forbidden' || counts.kind === 'failed') {
    return counts.reason === undefined ? { from: 'unknown' } : { from: 'unknown', reason: counts.reason };
  }
  if (narrow.text) return { from: 'page' };
  if (narrow.keys.some(k => !sameAxis(k, key))) return { from: 'page' };
  const axis = axisOf(counts.axes, key);
  if (axis) return { from: 'all', axis };
  const reason = reasonOf(counts.unavailable, key);
  if (reason !== undefined) return { from: 'unknown', reason };
  return { from: 'page' };
}

/** Откуда взять число «Быстро». */
export type QuickSource =
  | { from: 'all'; count: number }
  | { from: 'unknown'; reason?: string }
  | { from: 'page' };

/**
 * Число «Быстро» у источника.
 *
 * Сопоставить можно только условие вида «одно поле — одно значение»: пересечение
 * двух полей источник осями не считает, и притворяться, что считает, нельзя.
 * «Быстро» к тому же учитывает ВСЕ включённые условия, в том числе своего поля
 * — поэтому при любом включённом фильтре число остаётся по странице.
 */
export function quickSource(counts: ListCounts | undefined, filter: KitFilter, narrow: CountsNarrowing): QuickSource {
  if (!counts) return { from: 'page' };
  if (counts.kind === 'unsupported') return { from: 'page' };
  if (counts.kind === 'forbidden' || counts.kind === 'failed') {
    return counts.reason === undefined ? { from: 'unknown' } : { from: 'unknown', reason: counts.reason };
  }
  if (narrow.text || narrow.keys.length > 0) return { from: 'page' };
  const entries = Object.entries(filter);
  if (entries.length !== 1) return { from: 'page' };
  const [key, raw] = entries[0];
  const want = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : null) : raw;
  if (want === null) return { from: 'page' };
  const axis = axisOf(counts.axes, key);
  if (!axis) {
    const reason = reasonOf(counts.unavailable, key);
    if (reason !== undefined) return { from: 'unknown', reason };
    return { from: 'page' };
  }
  // «Без значения» — это «пусто» оси; его нет среди значений и нулём он не является.
  if (want === '') return { from: 'all', count: axis.empty };
  return { from: 'all', count: axis.values.find(v => v.value === want)?.count ?? 0 };
}

/** Оговорка о счёте — словами её скажет список. */
export type CountsNote =
  | { kind: 'unsupported' }
  | { kind: 'forbidden'; reason?: string }
  | { kind: 'failed'; reason?: string }
  | { kind: 'cap'; limit: number; parts: string[] }
  | { kind: 'partial' }
  | { kind: 'unknown' };

/** Что надо сказать о полноте счёта. Пусто — счёт полный (или счётчиков нет вовсе). */
export function countsNotes(counts: ListCounts | undefined): CountsNote[] {
  if (!counts) return [];
  if (counts.kind === 'unsupported') return [{ kind: 'unsupported' }];
  if (counts.kind === 'forbidden') return [counts.reason === undefined ? { kind: 'forbidden' } : { kind: 'forbidden', reason: counts.reason }];
  if (counts.kind === 'failed') return [counts.reason === undefined ? { kind: 'failed' } : { kind: 'failed', reason: counts.reason }];
  const out: CountsNote[] = [];
  // Предел — причина неполноты, поэтому говорится раньше самой неполноты.
  if (counts.cap) out.push({ kind: 'cap', limit: counts.cap.limit, parts: [...counts.cap.parts] });
  if (counts.completeness === 'partial') out.push({ kind: 'partial' });
  if (counts.completeness === 'unknown') out.push({ kind: 'unknown' });
  return out;
}

/**
 * Счётчики оси в форме фасета: числа — источника, порядок — его же (по убыванию
 * счёта). Пусто / не пусто / итог НЕ пересчитываются по странице: пересчёт
 * занижал бы молча.
 */
export function facetFromAxis(axis: AxisCounts): Facet {
  return {
    values: axis.values.map(v => ({ value: v.value, count: v.count })),
    empty: axis.empty,
    nonempty: axis.nonempty,
    total: axis.total,
  };
}
