// SPRINT_UXR_S1_HONEST_API/S1-01 — заглушки по контрактам S1 для UI v2 (S4).
// Каталога web-next пока нет (его заводит SPRINT_UXR_S3_V2_INFRA), поэтому
// заглушки живут рядом с контрактом; web-next импортирует их отсюда.
// Каждый сценарий — реальная форма тела бэкенда (AidaLoreResource.sliceBody /
// scopeMeta / outsideScopeMarker, SlicePage.apply), а не выдуманная.

import { toSliceEnvelope, type Completeness, type RawSliceBody, type SectionCount, type SliceEnvelope } from './s1';

export type StubScenario = 'complete' | 'empty' | 'truncated' | 'truncatedUnknown' | 'paged' | 'scoped' | 'outsideScope';

const ADR_ROWS = [
  { id: 'ADR-LORE-045', title: 'UI v2 отдельным приложением', status: 'accepted' },
  { id: 'ADR-LORE-038', title: 'Продукт над проектами', status: 'proposed' },
  { id: 'ADR-LORE-012', title: 'Словари', status: 'superseded' },
];

export const STUB_SLICE_BODIES: Record<StubScenario, { body: RawSliceBody; expect: Completeness }> = {
  complete: { body: { rows: ADR_ROWS }, expect: 'complete' },
  empty: { body: { rows: [] }, expect: 'complete' },
  truncated: {
    body: {
      rows: ADR_ROWS, truncated: true, limit: 1000,
      hint: 'выдача обрезана сервером на 1000 строк(ах): это потолок HTTP-API базы, конфигурацией он не поднимается — сузьте запрос или разбейте на страницы',
    },
    expect: 'partial',
  },
  truncatedUnknown: {
    body: {
      rows: ADR_ROWS, truncated: 'unknown',
      hint: 'строк ровно 1000 при известном потолке 1000, а версия базы об усечении НЕ СООБЩАЕТ — проверить, полна ли выдача, нечем',
    },
    expect: 'unknown',
  },
  paged: {
    body: { rows: ADR_ROWS.slice(0, 1), page: { limit: 1, offset: 0, total: 3, has_more: true } },
    expect: 'partial',
  },
  scoped: {
    body: {
      rows: ADR_ROWS.slice(0, 2),
      scope: { applied: true, projects: 2, note: 'выдача сужена проектным скоупом — строки вне разрешённых проектов не показаны' },
    },
    expect: 'complete',
  },
  outsideScope: {
    body: {
      rows: [],
      scope: { applied: true, projects: 1, note: 'выдача сужена проектным скоупом — строки вне разрешённых проектов не показаны' },
      outside_scope: { id: 'ADR-VOLVA-001', verdict: 'outside_scope', reason: 'запись с таким id существует, но вне ваших проектов — пустой ответ не значит «нет»' },
    },
    expect: 'complete',
  },
};

/** Заглушка будущего fetchLoreSliceMeta (S1-02): та же сигнатура результата. */
export async function stubFetchLoreSliceMeta<T = unknown>(scenario: StubScenario): Promise<SliceEnvelope<T>> {
  const stub = STUB_SLICE_BODIES[scenario];
  if (!stub) throw new Error(`unknown stub scenario: ${String(scenario)}`);
  return toSliceEnvelope(stub.body as RawSliceBody<T>, new Date().toISOString());
}

export const STUB_SECTION_COUNTS: SectionCount[] = [
  {
    section: 'adrs', open: 183, closed: 58,
    byCategory: { in_force: 180, in_progress: 3, withdrawn: 58 },
    scope: { applied: true, projects: 1 }, filters: {}, completeness: 'complete',
  },
  {
    section: 'tasks', open: 142, closed: 361,
    byCategory: { not_started: 90, in_progress: 52, finished: 340, withdrawn: 21 },
    scope: { applied: true, projects: 1 }, filters: {}, completeness: 'complete',
  },
  {
    section: 'docs', open: 1, closed: 0,
    byCategory: { unknown: 1 },
    scope: { applied: true, projects: 1 }, filters: { kind: 'claude-rules' }, completeness: 'unknown',
  },
];

/** Заглушка эндпоинта счётчиков (S1-07). */
export async function stubFetchSectionCounts(): Promise<SectionCount[]> {
  return STUB_SECTION_COUNTS;
}
