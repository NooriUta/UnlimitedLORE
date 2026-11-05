// V2-05 (ТЗ: SPRINT_BRAGI_ARCHIVE_IMPL/ANA-03): «вывод» в ретро — не свободный
// текст в ячейке, а действие: зафиксировать BragiInsight прямо со строки.
// Чистые функции — номер, обоснование, чипы строки; UI их только показывает.

import type { RetroWindowHours } from './bragiAnalytics';

const INS_ID = /^INS-(\d+)$/;

/** Следующий свободный INS-NN: после наибольшего номера, с ведущим нулём до двух знаков. */
export function nextInsightId(existing: readonly string[]): string {
  let max = 0;
  for (const id of existing) {
    const m = INS_ID.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `INS-${String(max + 1).padStart(2, '0')}`;
}

/**
 * Обоснование, подставляемое в evidence_ref: объект, цифры строки и окно среза —
 * ровно то, на что смотрел человек, когда делал вывод. Замера в окне нет —
 * «нет замера», а не 0: ноль утверждал бы то, чего не мерили.
 */
export function insightEvidence(
  row: { variant_id: string; views: number | null; clicks: number | null; demo: number | null },
  win: RetroWindowHours,
): string {
  const v = (x: number | null) => (x === null ? 'нет замера' : String(x));
  const window = win === null ? 'за всё время' : `окно ${win} ч от публикации`;
  return `${row.variant_id} · views ${v(row.views)} · clicks ${v(row.clicks)} · demo_conv ${v(row.demo)} · ${window}`;
}

/** Инсайты строки: те, чей subject_id — ровно её вариация или её публикация. */
export function insightsOfRow(
  insights: readonly { insight_id: string; subject_id: string | null }[],
  variantId: string,
  publicationId: string | null,
): string[] {
  return insights
    .filter(i => i.subject_id !== null && (i.subject_id === variantId || i.subject_id === publicationId))
    .map(i => i.insight_id);
}
