// SPRINT_UXR_S1_HONEST_API/S1-01 — контракты API S1, зафиксированные заранее,
// чтобы UI v2 (SPRINT_UXR_S4_UI_SHELL_LISTS) писался параллельно на заглушках.
// Спека с правилами и обоснованием: SPEC-LORE-UXR-S1-CONTRACTS.
//
// Здесь только формы и чистые функции — без сети. Боевые реализации:
//   контракт 1 → S1-02 (fetchLoreSliceMeta в src/api/lore.ts поверх toSliceEnvelope);
//   контракт 2 → S1-06 (категория приходит с сервера аддитивным полем; таблица ниже —
//                эталон, который сервер обязан повторить);
//   контракт 3 → S1-07 (эндпоинт/слайс счётчиков отдаёт SectionCount[]).
// Менять форму — только вместе со спекой и s1.test.ts.

// ── Контракт 1: ответ слайса с метаданными полноты ─────────────────────────

/** Маркер проектного скоупа (AidaLoreResource.scopeMeta). */
export interface ScopeMarker {
  applied: boolean;
  projects?: number;
  note?: string;
}

/** «Запись есть, но вне ваших проектов» (AidaLoreResource.outsideScopeMarker). */
export interface OutsideScopeMarker {
  id: string;
  verdict: 'outside_scope';
  reason: string;
}

/** Метаданные страницы (SlicePage.apply → body.page). */
export interface PageMeta {
  limit: number | null;
  offset: number;
  total: number;
  has_more: boolean;
  fields?: string[];
  fields_checked?: boolean;
  warning?: string;
}

/**
 * complete — ответ полон в пределах скоупа;
 * partial  — точно неполон (обрезан сервером или есть следующая страница);
 * unknown  — проверить полноту нечем (truncated:"unknown").
 * Скоуп полноту не снижает: он показывается отдельно (scope), иначе любой
 * скоупный ответ навсегда стал бы «неполным».
 */
export type Completeness = 'complete' | 'partial' | 'unknown';

/** Сырое тело GET /lore/slice/{id} — как его отдаёт бэкенд сейчас и после S1-02. */
export interface RawSliceBody<T = unknown> {
  rows?: T[];
  truncated?: boolean | 'unknown';
  limit?: number;
  hint?: string;
  scope?: ScopeMarker;
  outside_scope?: OutsideScopeMarker;
  page?: PageMeta;
  /** S1-02: аддитивное поле сервера; до него — отсутствует. */
  warnings?: string[];
}

/** Конверт ответа слайса для UI: «пусто», «скрыто скоупом» и «обрезано» различимы. */
export interface SliceEnvelope<T> {
  rows: T[];
  /** ISO-время получения ответа клиентом. */
  fetchedAt: string;
  scope: ScopeMarker | null;
  truncated: boolean | 'unknown';
  limit: number | null;
  page: PageMeta | null;
  outsideScope: OutsideScopeMarker | null;
  /** Человекочитаемые предупреждения сервера, без дублей, в порядке появления. */
  warnings: string[];
  completeness: Completeness;
}

export function toSliceEnvelope<T>(body: RawSliceBody<T>, fetchedAt: string): SliceEnvelope<T> {
  const truncated = body.truncated ?? false;
  const page = body.page ?? null;
  const completeness: Completeness =
    truncated === true || page?.has_more === true ? 'partial'
      : truncated === 'unknown' ? 'unknown'
        : 'complete';
  const warnings: string[] = [];
  const add = (w: string | undefined) => { if (w && !warnings.includes(w)) warnings.push(w); };
  (body.warnings ?? []).forEach(add);
  if (truncated !== false) add(body.hint);
  add(page?.warning);
  add(body.scope?.note);
  add(body.outside_scope?.reason);
  return {
    rows: body.rows ?? [],
    fetchedAt,
    scope: body.scope ?? null,
    truncated,
    limit: body.limit ?? null,
    page,
    outsideScope: body.outside_scope ?? null,
    warnings,
    completeness,
  };
}

// ── Контракт 2: категории статусов ─────────────────────────────────────────

/**
 * Одна ось для всех типов (D-2026-UXR-STATUS-AXIS):
 * not_started · in_progress · in_force («действует») · finished · withdrawn («снято»).
 * unknown — статус не распознан; считается ОТКРЫТЫМ, чтобы не прятать.
 */
export type StatusCategory = 'not_started' | 'in_progress' | 'in_force' | 'finished' | 'withdrawn' | 'unknown';

export type StatusEntityType = 'task' | 'sprint' | 'adr' | 'spec' | 'decision';

export const CLOSED_CATEGORIES: ReadonlySet<StatusCategory> = new Set<StatusCategory>(['finished', 'withdrawn']);

export function isOpenCategory(c: StatusCategory): boolean {
  return !CLOSED_CATEGORIES.has(c);
}

const PLAN: Record<string, StatusCategory> = {
  todo: 'not_started',
  planned: 'not_started',
  backlog: 'not_started',
  design: 'not_started',
  active: 'in_progress',
  partial: 'in_progress',
  blocked: 'in_progress',
  ready_for_deploy: 'in_progress',
  uat: 'in_progress',
  done: 'finished',
  cancelled: 'withdrawn',
};

// accepted = «действует», а не «закрыто»: при наивной связке 180 принятых ADR
// из 241 прятались как закрытые (критика раунда 2).
const RECORD: Record<string, StatusCategory> = {
  draft: 'not_started',
  deferred: 'not_started',
  proposed: 'in_progress',
  accepted: 'in_force',
  deprecated: 'withdrawn',
  superseded: 'withdrawn',
};

/** Эталон «тип → статус → категория». Сервер (S1-06) обязан отдавать то же. */
export const STATUS_CATEGORY_TABLE: Readonly<Record<StatusEntityType, Readonly<Record<string, StatusCategory>>>> = {
  task: PLAN,
  sprint: PLAN,
  adr: RECORD,
  spec: RECORD,
  decision: RECORD,
};

export function categoryOf(type: StatusEntityType, status: string | null | undefined): StatusCategory {
  const code = (status ?? '').trim().toLowerCase();
  return STATUS_CATEGORY_TABLE[type][code] ?? 'unknown';
}

// ── Контракт 3: правило счётчиков ──────────────────────────────────────────

/**
 * Одно правило на все места (меню, фасет, вид): число = открытые записи
 * В СКОУПЕ и С ТЕКУЩИМИ ФИЛЬТРАМИ; закрытые (finished|withdrawn) — отдельным
 * слагаемым «142 · +361». Неполная выборка помечается, а не выдаётся за точное.
 */
export interface SectionCount {
  section: string;
  open: number;
  closed: number;
  byCategory: Partial<Record<StatusCategory, number>>;
  scope: ScopeMarker | null;
  filters: Record<string, string>;
  completeness: Completeness;
}

export function countSection<R>(args: {
  section: string;
  entityType: StatusEntityType;
  rows: readonly R[];
  statusOf: (row: R) => string | null | undefined;
  envelope?: Pick<SliceEnvelope<R>, 'completeness' | 'scope'>;
  filters?: Record<string, string>;
}): SectionCount {
  const byCategory: Partial<Record<StatusCategory, number>> = {};
  let open = 0;
  let closed = 0;
  for (const row of args.rows) {
    const c = categoryOf(args.entityType, args.statusOf(row));
    byCategory[c] = (byCategory[c] ?? 0) + 1;
    if (isOpenCategory(c)) open++; else closed++;
  }
  return {
    section: args.section,
    open,
    closed,
    byCategory,
    scope: args.envelope?.scope ?? null,
    filters: args.filters ?? {},
    completeness: args.envelope?.completeness ?? 'complete',
  };
}

/** «142 · +361»; без закрытых — «142»; partial — «≥142», unknown — «142?». */
export function formatSectionCount(c: SectionCount): string {
  const head = c.completeness === 'partial' ? `≥${c.open}`
    : c.completeness === 'unknown' ? `${c.open}?`
      : String(c.open);
  return c.closed > 0 ? `${head} · +${c.closed}` : head;
}
