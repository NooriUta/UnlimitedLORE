// ── /lore transport layer ──────────────────────────────────────────────────
// Same-origin in dev: the vite proxy forwards /lore to lore-backend (:9100) which
// queries system_aida_lore via named slices (AidaLoreResource). The browser
// never sees ArcadeDB credentials and never sends SQL.
//
// In prod lore.enabled=false → backend returns 404 LORE_DISABLED → LoreDisabledError.

import { authHeaders, sessionExpired } from '../auth/session';

const LORE_BASE = '/lore';

export class LoreDisabledError extends Error {
  constructor() { super('lore feature is disabled (dev-only)'); }
}

export class LoreUpstreamError extends Error {
  constructor(detail?: string) { super(detail ?? 'lore upstream failed'); }
}

export class LoreNotFoundError extends Error {
  constructor(id: string) { super(`lore entity not found: ${id}`); }
}

function assertJson(res: Response): void {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new LoreUpstreamError(`backend returned ${res.status} non-JSON`);
}

async function parseError(res: Response): Promise<never> {
  assertJson(res);
  let code = '';
  let detail = '';
  try {
    const body = (await res.json()) as { error?: string; detail?: string };
    code = body.error ?? '';
    detail = body.detail ?? '';
  } catch { /* fall through */ }
  // 401 — сессия недействительна, а не «данных нет». Без этой ветки протухший
  // токен выглядел как пустой экран: `authHeaders()` не находит валидного
  // токена и шлёт запрос БЕЗ заголовка, бэкенд отвечает 401, а список
  // рендерится как «не найдено». Уводим в состояние «нет сессии» — дальше
  // AuthGate сам отправит на вход.
  if (res.status === 401) sessionExpired();
  if (code === 'LORE_DISABLED') throw new LoreDisabledError();
  if (code === 'LORE_UPSTREAM') throw new LoreUpstreamError(detail);
  if (code === 'NOT_FOUND')     throw new LoreNotFoundError(detail);
  throw new Error(`${res.status} ${code || res.statusText}${detail ? `: ${detail}` : ''}`);
}

export async function fetchLoreSlice<T>(
  slice: string,
  params?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T[]> {
  const url = new URL(`${LORE_BASE}/slice/${slice}`, location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  // MIG-30: чтение тоже под аутентификацией. До этого GET-и шли БЕЗ заголовков —
  // работало, потому что бэкенд отдавал слайсы анониму. С закрытием чтения такой
  // запрос стал бы 401 на каждом экране, то есть выглядел бы как «LORE сломался»,
  // а не как «не хватает токена».
  const res = await fetch(url.toString(), { signal, headers: { ...authHeaders() } });
  assertJson(res);
  if (!res.ok) return parseError(res);
  const body = (await res.json()) as { rows?: T[] };
  return body.rows ?? [];
}

// ── ADR-LORE-012: dictionary entries (KnowDictEntry) ───────────────────────
// One row per (dict_type, code). Read via fetchLoreSlice('dictionary', …) and
// cached in DictionaryProvider; consumers use the useDictionary hook.
export interface DictEntry {
  dict_type: string;
  code: string;
  label_ru: string | null;
  label_en: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number | null;
  is_active: boolean | null;
  is_extensible: boolean | null;
}

// Upsert one (dict_type, code) row — used to grow an is_extensible domain
// on the fly (e.g. a free-typed agent role not yet in the dictionary).
export async function upsertDictEntry(
  entry: Pick<DictEntry, 'dict_type' | 'code'> & Partial<DictEntry>,
  signal?: AbortSignal,
): Promise<{ ok: boolean }> {
  return loreMutate('/dict/entry', entry, signal);
}

// Single write/mutation transport for LORE POST endpoints. Replaces the
// per-component `fetch(... X-Seer-Role ...)` helpers that had each drifted their
// own error handling. `path` is relative to /lore (e.g. "/bragi/keyword").
export async function loreMutate<T = { ok: boolean; [k: string]: unknown }>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${LORE_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return (await res.json()) as T;
}

// BRAGI metric query (GET /lore/bragi/metric/query) — not a whitelisted slice,
// filter/agg shape doesn't fit the generic template (see MCP-03).
export interface BragiMetricPoint {
  object_type: string; object_id: string; metric: string;
  value: number; ts: string; source?: string; segment?: string;
}
export async function fetchBragiMetrics(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<BragiMetricPoint[]> {
  const url = new URL(`${LORE_BASE}/bragi/metric/query`, location.origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { signal, headers: { ...authHeaders() } });
  assertJson(res);
  if (!res.ok) return parseError(res);
  const body = (await res.json()) as { rows?: BragiMetricPoint[] };
  return body.rows ?? [];
}

// Slice catalog (GET /lore/slices) — the whitelist the MCP `list_slices`
// tool exposes. Used by the MCP API screen to show the live catalog.
export interface LoreSliceDescriptor {
  id: string;
  required: string[];
  optional: string[];
}

export async function fetchLoreSliceCatalog(signal?: AbortSignal): Promise<LoreSliceDescriptor[]> {
  const res = await fetch(`${LORE_BASE}/slices`, { signal, headers: { ...authHeaders() } });
  assertJson(res);
  if (!res.ok) return parseError(res);
  const body = (await res.json()) as { slices?: LoreSliceDescriptor[] };
  return body.slices ?? [];
}

// ── Analytics dashboard (GET /lore/analytics) ──────────────────────────────
export interface LoreAnalyticsComponent {
  component_id: string;
  full_name: string | null;
  area: string | null;
  sprint_count: number;
  task_total: number;
  task_done: number;
}
export interface LoreAnalyticsSprint {
  sprint_id: string;
  status_raw: string | null;
  task_total: number;
  task_done: number;
  effort_days_sum?: number;
}
export interface LoreAnalytics {
  totals: { sprints: number; tasks: number; tasks_done: number; releases: number; components: number };
  tasks_by_status: Record<string, number>;
  sprints_by_status: Record<string, number>;
  by_component: LoreAnalyticsComponent[];
  by_sprint: LoreAnalyticsSprint[];
  releases_by_project: Record<string, number>;
  current_releases: string[];
}

export async function fetchLoreAnalytics(signal?: AbortSignal): Promise<LoreAnalytics> {
  const res = await fetch(`${LORE_BASE}/analytics`, { signal, headers: { ...authHeaders() } });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return (await res.json()) as LoreAnalytics;
}

// ── Search v2 (SRCH-05, ADR-LORE-033) ──────────────────────────────────────
// Отдельный helper, а не fetchLoreSlice: ответ несёт агрегаты by_type /
// by_component, а не {rows} — та же причина, по которой analytics и
// bragi-метрики живут своими функциями.

export interface LoreSearchHit {
  type: string;
  ref_id: string;
  title: string | null;
  score: number;
  /** SRCH-09: слагаемые ранга — `score = bm25 × type_priority`. Итог сам по себе
   *  не отвечает, почему задача встала выше ADR; спорить с приоритетом можно,
   *  только если он виден. BM25 нормирован внутри ветки (доля от лучшего в типе). */
  bm25: number;
  type_priority: number;
  matched_field: string;
  snippet: string | null;
  components: string[];
  /** Непустое = компонент ВЫВЕДЕН от родителя (sprint | adr), не прямое ребро. */
  inherited_from: string | null;
  projects: string[];
}
/** SRCH-10: ветка, по которой поиск НЕ отработал. Не то же, что «ничего не нашлось». */
export interface LoreSearchWarning { type: string; error: string; }

export interface LoreSearchResult {
  hits: LoreSearchHit[];
  by_type: Record<string, number>;
  by_component: Record<string, number>;
  /** SRCH-10: третья ось СЕРВЕРНАЯ. Раньше UI считал её по текущей странице —
   *  счётчики врали за пределами первых 50 хитов. */
  by_project: Record<string, number>;
  /** Пустой массив, а не отсутствие поля: «предупреждений нет» ≠ «поле не пришло». */
  warnings: LoreSearchWarning[];
  total_collected: number;
  capped_at: number;
  /** SRCH-09: во что превратился запрос перед уходом в индекс — строку строит
   *  сервер (D2), и больше она нигде не видна. Без неё расхождение «что я искал»
   *  и «что искали за меня» проверить нечем. */
  lucene: string;
  mode: 'smart' | 'exact' | 'fuzzy';
  /** Границы страницы рядом с самой страницей: иначе «конец выдачи» не отличить
   *  от «страницу пролистали мимо». */
  offset: number;
  limit: number;
  took_ms: number;
}
export interface LoreSearchParams {
  q: string;
  types?: string[];
  components?: string[];
  projects?: string[];
  limit?: number;
  offset?: number;
  mode?: 'smart' | 'exact' | 'fuzzy';
}

export async function fetchLoreSearch(p: LoreSearchParams, signal?: AbortSignal): Promise<LoreSearchResult> {
  const qs = new URLSearchParams({ q: p.q });
  if (p.types?.length) qs.set('types', p.types.join(','));
  if (p.components?.length) qs.set('components', p.components.join(','));
  if (p.projects?.length) qs.set('projects', p.projects.join(','));
  if (p.limit) qs.set('limit', String(p.limit));
  if (p.offset) qs.set('offset', String(p.offset));
  if (p.mode) qs.set('mode', p.mode);
  const res = await fetch(`${LORE_BASE}/search?${qs}`, { signal, headers: { ...authHeaders() } });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return (await res.json()) as LoreSearchResult;
}

// ── Typed slice helpers ────────────────────────────────────────────────────

export interface LoreTimelineItem {
  date: string;
  kind: 'adr' | 'decision' | 'release' | 'sprint';
  ref_id: string;
  title: string;
  status: string;
}

export interface LoreAdrRow {
  adr_id: string;
  name: string | null;
  status: string | null;
  date_created: string | null;
  component: string | null;
  components: string[] | null;
  tags: string[] | null;
  decision_count: number | null;
}

export interface LoreFileRow {
  project: string | null;
  file_path: string;
  summary_md: string | null;
  project_hosts: string | null;           // JSON string of RepoHost[] (ADR-018)
  project_default_branch: string | null;
}

// ADR-LORE-020/021: open-questions register (KnowQuestion). status is a plain
// vertex field (vertex-only, no SCD2). overdue/blocking/age are derived on read.
export interface LoreQuestionRow {
  question_id: string;
  title: string | null;
  body_md: string | null;                  // контекст вопроса (для раскрывающегося блока)
  status: string | null;                  // open | deferred | closed | dropped
  component_id: string | null;
  components: (string | null)[] | null;    // T43: multi component via BELONGS_TO
  projects: (string | null)[] | null;      // T43: multi git project via BELONGS_TO_PROJECT
  due_date: string | null;
  priority: string | null;                // blocker | high | normal | low
  owner: string | null;
  raised_by: string | null;
  opened_date: string | null;
  closed_date: string | null;
  gating_tasks: (string | null)[] | null;   // tasks this question GATES
  raised_adr: (string | null)[] | null;      // RAISED_IN → ADR
  raised_sprint: (string | null)[] | null;
  answered_by: (string | null)[] | null;     // decision_id(s) that closed it
}

export interface LoreAdrPassport {
  adr_id: string;
  name: string | null;
  status: string | null;
  file_path: string | null;
  date_created: string | null;
  components: string[] | null;
  context_md: string | null;
  decision_md: string | null;
  consequences_md: string | null;
  sprint_id: string | null;
  depends_on_ids: string[] | null;
  implemented_in_ids: string[] | null;
  release_ids: string[] | null;
  supersedes_ids: string[] | null;
  tags: string[] | null;
  /** ADRPROJ-01: git-проекты ADR (BELONGS_TO_PROJECT, multi). */
  git_projects?: string[] | null;
  /** PL-19: сценарии, ссылающиеся на этот ADR (обратное TRACED_TO). */
  traced_by_ucs?: string[] | null;
  /** PL-19: enb-задачи, обоснованные этим ADR (обратное JUSTIFIED_BY). */
  justified_task_uids?: string[] | null;
}

export interface LoreSprintDep {
  from_sprint: string;
  to_sprint: string;
  kind: string | null;   // 'hard' | 'soft' | null
  reason: string | null;
}

export interface AdrWritePayload {
  adr_id: string;
  name: string;
  status?: string;
  date_created?: string;
  context_md?: string;
  decision_md?: string;
  consequences_md?: string;
  depends_on_ids?: string[];
  supersedes_ids?: string[];
  component_ids?: string[];
  tags?: string[];
}

export async function createLoreAdr(payload: AdrWritePayload): Promise<{ ok: boolean; adr_id: string; hist_created: boolean }> {
  const res = await fetch(`${LORE_BASE}/adr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; adr_id: string; hist_created: boolean }>;
}

export interface LoreDecisionRow {
  decision_id: string;
  title: string;
  date_created: string | null;
  status_raw: string | null;
  component_id: string | null;   // ADR-019: legacy single component (primary)
  components: (string | null)[] | null; // T43: multi component via BELONGS_TO
  projects: (string | null)[] | null;   // T43: multi git project via BELONGS_TO_PROJECT
  tags: string[] | null;
  parent_adr: string | null;     // out('DECIDED_IN') — the ADR this decision lives under
}

export interface LoreDecisionPassport {
  decision_id: string;
  title: string;
  date_created: string | null;
  body_md: string | null;
  rationale_md: string | null;
  refs_raw: string | null;
  adr_refs: string[] | null;
  sprint_refs: string[] | null;
  pr_refs: string[] | null;
  release_refs: string[] | null;
  supersedes_ids: string[] | null;
}

export interface LoreSprintRow {
  sprint_id: string;
  name: string;
  status_raw: string | null;
  priority: string | null;
  valid_from: string | null;
  release_ids: string[] | null;
  release_dates: string[] | null;
  done_date: string | null;
  git_projects: string[] | null;
  components: string[] | null;
  track_id: string | null;
  context_md: string | null;
  created_date: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  milestone_ids?: string[] | null;
  no_release_required: boolean | null;
}

export interface LoreSprintDoneDate {
  sprint_id: string;
  done_date: string | null;
}

export interface LoreSprintTask {
  task_uid: string;
  task_id: string;
  title: string | null;
  order_index: number;
  phase_uid: string | null;
  status_raw: string | null;
  effort_days: number | null;
  note_md: string | null;
  component_ids: string[] | null;
  // ADR-LORE-014 §4 — free-text task ownership; reviewer_agent must differ from
  // executor_agent before the task can move to done (backend hard gate).
  author_agent?: string | null;
  executor_agent?: string | null;
  reviewer_agent?: string | null;
  // ADR-LORE-015 (T14) — classification, plain vertex field like the roles above.
  task_type?: string | null;
  // ADR-LORE-022 (PL-19) — ось ЗАЧЕМ, ортогональная task_type: uc | jtd | enb.
  // Слайс отдаёт её с PL-14, но фронт не типизировал и не показывал.
  work_class?: string | null;
  /** Сценарии, которые задача реализует (REALIZES) — их может быть несколько. */
  realizes_uc?: string[] | null;
}

export interface LoreMilestone {
  milestone_id: string;
  label: string;
  week: number | null;
  date_display: string | null;
  goal_md: string | null;
  // direct_sprint_ids (TARGETS_MILESTONE edge) is the sole source of truth for
  // sprint↔milestone membership — a separate "planned" bucket (planned_milestone_
  // id field, client-derived) used to exist alongside it, drifted out of sync on
  // 62+ sprints, and was retired.
  direct_sprint_ids?: string[] | null;
  priority?: string | null;
}

export interface LoreComponent {
  component_id: string;
  full_name: string;
  area: string;
  parent_id: string | null;
  game_icon: string | null;
  children: string[];
  tech: string[];
  owner?: string | null;
  team?: string | null;
  adr_count?: number | null;
  spec_count?: number | null;
  qg_count?: number | null;
  sprint_count?: number | null;
  git_projects?: string[] | null;
}

export interface LoreComponentDetail extends LoreComponent {
  sub_components: string[] | null;
  adrs: string[] | null;
  specs: string[] | null;
  spec_docs: string[] | null;
}

export interface ComponentUpdatePayload {
  component_id: string;
  owner?: string | null;
  team?: string | null;
  full_name?: string | null;
  area?: string | null;
  game_icon?: string | null;
  parent_id?: string | null;
}

export async function updateLoreComponent(payload: ComponentUpdatePayload): Promise<{ ok: boolean; component_id: string }> {
  const res = await fetch('/lore/component/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; component_id: string }>;
}

export interface LoreSpecRow {
  spec_id: string;
  title: string | null;
  file_path: string | null;
  component_id: string | null;
}

export interface LoreSpecPassport extends LoreSpecRow {
  content_md: string | null;
  summary: string | null;
  version: string | null;
  valid_from: string | null;
}

// ── Продуктовый слой: Value Proposition как граф (ADR-LORE-022/032, Остервальдер + Коберн).
// Поля-массивы (*_ids/*_ucs) — рёбра графа; счётчики (*_by) — их размер. Слайсы:
// features · use_cases_of_feature(id) · pains · gains · jobs · actors.
// PL-28 (решение №141): «фича» — это КОРНЕВОЙ сценарий, а не отдельный тип.
// Отсюда uc_id вместо feature_id: слайс `features` отбирает корни по goal_level.
export interface LoreFeatureRow {
  uc_id: string;
  title: string | null;
  body_md?: string | null;
  context_md?: string | null;
  status?: string | null;
  component_id?: string | null;
  component_ids?: string[] | null;  // PL-10: рёбра BELONGS_TO, а не плоское поле
  projects?: string[] | null;
  goal_level?: string | null;      // ☁ cloud | 🪁 kite (Коберн, D1)
  shipped_at?: string | null;
  uc_ids?: string[] | null;
  uc_total?: number | null;
  uc_shipped?: number | null;       // D4 — вычислено рёбрами
  pain_ids?: string[] | null;       // ADDRESSES — заявлено
  gain_ids?: string[] | null;       // PROMISES
  job_ids?: string[] | null;        // HELPS_WITH (Остервальдер, третья ось)
  milestone_id?: string | null;
}

export interface LoreUcRow {
  uc_id: string;
  title: string | null;
  scenario_md?: string | null;
  acceptance_md?: string | null;
  status?: string | null;
  parent_uc_id?: string | null;     // родитель того же типа (DECOMPOSES_INTO)
  component_ids?: string[] | null;           // PL-10 (D14): СВОЙ компонент сценария
  inherited_component_ids?: string[] | null; // …и отдельно унаследованный от родителя
  projects?: string[] | null;
  goal_level?: string | null;       // 🌊 sea-level | 🐟 subfunction
  rigor?: string | null;            // casual | fully-dressed
  relieves_pain_ids?: string[] | null;   // RELIEVES — сделано (замыкает fit)
  delivers_gain_ids?: string[] | null;   // DELIVERS
  performs_job_ids?: string[] | null;    // PERFORMS — третья ось fit
  task_uids?: string[] | null;
  traced_adr_ids?: string[] | null;
  traced_decision_ids?: string[] | null;
  actor_ids?: string[] | null;
  actor_names?: string[] | null;
  includes_uc?: string[] | null;
  extends_uc?: string[] | null;
  included_by?: string[] | null;
  extended_by?: string[] | null;
}

/** Строка слайса `tasks_of_uc` — задача, реализующая сценарий (PL-16). */
export interface LoreUcTaskRow {
  task_uid: string;
  task_id: string;
  title: string | null;
  task_type?: string | null;
  work_class?: string | null;
  status_raw?: string | null;
  sprint_id?: string | null;
  // Статус СПРИНТА, а не задачи: закрытая задача в живом спринте и та же
  // задача в отменённом — разные новости, а по статусу задачи не различимы.
  sprint_status_raw?: string | null;
  justified_by_adr_ids?: string[] | null;
}

export interface LorePainRow {
  pain_id: string;
  title: string | null;
  body_md?: string | null;
  severity?: string | null;
  actor_ids?: string[] | null;       // FELT_BY — чья боль
  blocks_job_ids?: string[] | null;  // BLOCKS — какой работе мешает
  claimed_by_ucs?: string[] | null;  // ADDRESSES — кто ЗАЯВИЛ, что адресует
  addressed_by?: number | null;
  relieved_by_ucs?: string[] | null; // кто РЕАЛЬНО снимает
  relieved_by?: number | null;
}

export interface LoreGainRow {
  gain_id: string;
  title: string | null;
  body_md?: string | null;
  metric_md?: string | null;         // без метрики выгода не в fit
  rank?: string | null;              // essential | expected | desired | unexpected
  actor_ids?: string[] | null;       // DESIRED_BY
  success_of_job_ids?: string[] | null; // SUCCESS_OF — успех в какой работе
  claimed_by_ucs?: string[] | null;  // PROMISES — кто ЗАЯВИЛ
  promised_by?: number | null;
  delivered_by_ucs?: string[] | null;
  delivered_by?: number | null;
}

export interface LoreJobRow {
  job_id: string;
  title: string | null;
  body_md?: string | null;
  kind?: string | null;              // functional | social | emotional | supporting
  importance?: string | null;        // high | normal | low
  actor_ids?: string[] | null;       // PERFORMED_BY — чья работа
  blocking_pain_ids?: string[] | null;
  blocked_by?: number | null;
  gain_ids?: string[] | null;        // SUCCESS_OF
  claimed_by_ucs?: string[] | null;  // HELPS_WITH — кто ЗАЯВИЛ помощь
  helped_by?: number | null;
  performed_by_ucs?: string[] | null; // PERFORMS — кто РЕАЛЬНО выполняет
  performed_by?: number | null;
}

export interface LoreActorRow {
  actor_id: string;
  name?: string | null;
  kind?: string | null;              // human-role | system | agent
  body_md?: string | null;
  uc_ids?: string[] | null;
  uc_count?: number | null;
}

export async function fetchLoreSpec(
  specId: string,
  signal?: AbortSignal,
): Promise<LoreSpecPassport | null> {
  const rows = await fetchLoreSlice<LoreSpecPassport>('spec_by_id', { id: specId }, signal);
  return rows[0] ?? null;
}

export interface LorePlanConfig {
  config_id: string;
  w0_date: string;
  weeks_total: number;
}

export interface LorePlanTrack {
  track_id: string;
  label: string;
  type: string | null;
}

export interface LorePlanSection {
  section_id: string;
  label: string;
  start_week: number;
  end_week: number;
  color: string;
}

export interface LorePlanCheckpoint {
  checkpoint_id: string;
  label: string;
  desc_md: string | null;
  milestone: string | null;
}

export interface LorePlanItem {
  item_id: string;
  label: string;
  track_id: string | null;
  week_start: number | null;
  week_end: number | null;
  bar_color: string | null;
  represents_sprint: string | null;
  status: string | null;
  milestone_id: string | null;
  /** Component ids the represented sprint BELONGS_TO (lane + bar icons). */
  components: string[] | null;
}

// Canonical source of truth: shared/lore-statuses.json (planStatuses). Drift is
// caught in CI by `npm run check:statuses` (scripts/check-lore-statuses.mjs).
export type LorePlanItemStatus = 'todo' | 'planned' | 'backlog' | 'design' | 'active' | 'partial' | 'done' | 'blocked' | 'high' | 'cancelled' | 'ready_for_deploy';

export interface LoreStatusUpdateResponse {
  ok: boolean;
  entity_type: string;
  id: string;
  old_status: string | null;
  new_status: string;
  revision: { valid_from: string; plan_version?: string | null };
}

export async function postLoreStatus(
  entityType: 'plan_item' | 'sprint' | 'task' | 'checkpoint' | 'phase',
  id: string,
  status: LorePlanItemStatus,
): Promise<LoreStatusUpdateResponse> {
  const res = await fetch(`${LORE_BASE}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ entity_type: entityType, id, status }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<LoreStatusUpdateResponse>;
}

export async function uploadBragiAsset(file: File): Promise<{ ok: boolean; file_url: string; size_bytes: number }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${LORE_BASE}/bragi/asset/upload`, {
    method: 'POST',
    headers: { ...authHeaders() },
    body: form,
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; file_url: string; size_bytes: number }>;
}

/** Register (or amend) a BragiAsset and optionally attach it to a publication/variant
 * (POST /lore/bragi/asset) — the second half of the upload+attach cover-image flow;
 * uploadBragiAsset() above only stores the file and returns its file_url. */
export async function attachBragiAsset(p: {
  asset_id: string; file_url?: string; asset_type?: string; alt?: string; size_bytes?: number;
  attach_to_publication_id?: string; attach_to_variant_id?: string;
}): Promise<{ ok: boolean; asset_id: string; attached_to: string }> {
  const res = await fetch(`${LORE_BASE}/bragi/asset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(p),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; asset_id: string; attached_to: string }>;
}

/** Create/amend a BragiCampaign and optionally link it to a variant (POST
 * /lore/bragi/campaign) — EDIT-04. UPSERT by campaign_id, partial-safe. */
export async function createBragiCampaign(p: {
  campaign_id: string; utm_source?: string; utm_medium?: string; utm_campaign?: string;
  target_url?: string; period?: string; variant_id?: string;
}): Promise<{ ok: boolean; campaign_id: string; linked_variant: boolean }> {
  const res = await fetch(`${LORE_BASE}/bragi/campaign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(p),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; campaign_id: string; linked_variant: boolean }>;
}

/** Link (or unlink) a BragiPublication/BragiVariant into the Forseti work graph
 * (POST /lore/bragi/link) — EDIT-05. PRODUCED_BY→task|sprint, SHIPPED_IN→release. */
export async function linkBragiForseti(p: {
  entity_type: 'publication' | 'variant'; entity_id: string;
  edge_type: 'PRODUCED_BY' | 'SHIPPED_IN';
  target_type: 'task' | 'sprint' | 'release'; target_id: string;
  git_project?: string; action?: 'add' | 'remove';
}): Promise<{ ok: boolean; entity_id: string; target_id: string; action: string }> {
  const res = await fetch(`${LORE_BASE}/bragi/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(p),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; entity_id: string; target_id: string; action: string }>;
}

export interface LoreTaskWriteResponse {
  ok: boolean;
  task_uid: string;
  task_id: string | null;
  order_index: number | null;
}

export async function createLoreTask(
  sprintId: string,
  taskId: string,
  title: string,
  noteMd?: string | null,
  taskType?: string | null,
): Promise<LoreTaskWriteResponse> {
  const res = await fetch(`${LORE_BASE}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      sprint_id: sprintId, task_id: taskId, title, note_md: noteMd ?? null,
      task_type: taskType ?? null,
    }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<LoreTaskWriteResponse>;
}

export interface LoreTaskAgentFields {
  authorAgent?: string | null;
  executorAgent?: string | null;
  reviewerAgent?: string | null;
  taskType?: string | null;
}

export async function editLoreTask(
  taskUid: string,
  title: string,
  noteMd?: string | null,
  effortDays?: number | null,
  agents?: LoreTaskAgentFields,
): Promise<LoreTaskWriteResponse> {
  // effort_days / agent fields: null (or omitted) = leave unchanged (backend only
  // writes a field when it's non-null; ADR-LORE-014 §4 / ADR-LORE-015 fields live
  // on the vertex).
  const res = await fetch(`${LORE_BASE}/task/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      task_uid: taskUid, title, note_md: noteMd ?? null, effort_days: effortDays ?? null,
      author_agent: agents?.authorAgent ?? null,
      executor_agent: agents?.executorAgent ?? null,
      reviewer_agent: agents?.reviewerAgent ?? null,
      task_type: agents?.taskType ?? null,
    }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<LoreTaskWriteResponse>;
}

/** Link or unlink a KnowSprint to a KnowGitProject (POST /lore/sprint/project). */
export async function linkTaskComponent(
  taskUid: string,
  componentId: string,
  action: 'add' | 'remove' = 'add',
): Promise<{ ok: boolean; task_uid: string; component_id: string; action: string }> {
  const res = await fetch(`${LORE_BASE}/task/component`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ task_uid: taskUid, component_id: componentId, action }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; task_uid: string; component_id: string; action: string }>;
}

export async function linkSprintComponent(
  sprintId: string,
  componentId: string,
  action: 'add' | 'remove' = 'add',
): Promise<{ ok: boolean; sprint_id: string; component_id: string; action: string }> {
  const res = await fetch(`${LORE_BASE}/sprint/component`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sprint_id: sprintId, component_id: componentId, action }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; sprint_id: string; component_id: string; action: string }>;
}

export async function linkSprintProject(
  sprintId: string,
  gitProject: string,
  action: 'add' | 'remove' = 'add',
): Promise<{ ok: boolean; sprint_id: string; git_project: string; action: string }> {
  const res = await fetch(`${LORE_BASE}/sprint/project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sprint_id: sprintId, git_project: gitProject, action }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; sprint_id: string; git_project: string; action: string }>;
}

/** Link or unlink a KnowSprint to a KnowMilestone (POST /lore/milestone/sprint). */
export async function linkSprintMilestone(
  sprintId: string,
  milestoneId: string,
  action: 'add' | 'remove' = 'add',
): Promise<{ ok: boolean; sprint_id: string; milestone_id: string; action: string }> {
  const res = await fetch(`${LORE_BASE}/milestone/sprint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sprint_id: sprintId, milestone_id: milestoneId, action }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; sprint_id: string; milestone_id: string; action: string }>;
}

// ── Tech registry (SPRINT_TECH_REGISTRY) ───────────────────────────────────
// Stored as one KnowSpec per (component, tech) pair via the existing /lore/spec
// upsert path — spec_id "SPEC-TECH-<COMPONENT>-<TECH>" — same convention as the
// tech_set MCP tool. Read side is the tech_registry slice.
export interface LoreTechRow {
  spec_id: string;
  tech_name: string;
  version: string | null;
  content_md: string | null;
  checked_at: string | null;
  component_id: string | null;
}

export interface TechUpsertPayload {
  component_id: string;
  tech_name: string;
  version: string;
  release_date?: string;    // when the TECH ITSELF was released upstream
  license?: string;
  source_url?: string;
  checked_at?: string;
  our_release?: string;     // which of OUR releases pinned/shipped this version
  usage?: string;           // how/where it's actually used (free text)
}

export async function upsertTech(p: TechUpsertPayload): Promise<{ ok: boolean; spec_id: string }> {
  const specId = `SPEC-TECH-${p.component_id.toUpperCase()}-${p.tech_name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    p.release_date && `- **Дата релиза:** ${p.release_date}`,
    p.our_release && `- **Наш релиз:** ${p.our_release}`,
    p.license && `- **Лицензия:** ${p.license}`,
    p.usage && `- **Использование:** ${p.usage}`,
    p.source_url && `- **Источник:** ${p.source_url}`,
    `- **Проверено:** ${p.checked_at ?? today}`,
  ].filter(Boolean);
  const res = await fetch(`${LORE_BASE}/spec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      spec_id: specId, title: p.tech_name, version: p.version, component_id: p.component_id,
      content_md: lines.join('\n'),
    }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; spec_id: string }>;
}

/** Link or unlink a KnowSprint to a KnowRelease (POST /lore/release/link | /lore/release/unlink). */
export async function linkSprintRelease(
  sprintId: string,
  releaseId: string,
  gitProject: string,
  action: 'add' | 'remove' = 'add',
): Promise<{ ok: boolean }> {
  const res = await fetch(`${LORE_BASE}/release/${action === 'remove' ? 'unlink' : 'link'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ release_id: releaseId, git_project: gitProject, sprint_ids: [sprintId] }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean }>;
}

/** Create or edit a KnowMilestone (POST /lore/milestone). */
export async function upsertMilestone(
  m: { milestone_id: string; label?: string; week?: number | null; date_display?: string | null; goal_md?: string | null; priority?: string | null },
): Promise<{ ok: boolean; milestone_id: string }> {
  const res = await fetch(`${LORE_BASE}/milestone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(m),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; milestone_id: string }>;
}

export async function updateLoreSprint(
  sprintId: string,
  fields: { context_md?: string | null; outcome_md?: string | null; name?: string | null; no_release_required?: boolean | null },
): Promise<{ ok: boolean; sprint_id: string }> {
  const res = await fetch(`${LORE_BASE}/sprint/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sprint_id: sprintId, ...fields }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; sprint_id: string }>;
}

/**
 * Real-SCD2 edit of sprint plan fields (POST /lore/sprint/plan) — unlike
 * updateLoreSprint (in-place vertex mutation), this closes the open
 * KnowSprintHist row and opens a new one, carrying forward any of these
 * fields the caller doesn't pass. priority lives here now, not on updateLoreSprint.
 */
export async function updateSprintPlan(
  sprintId: string,
  fields: {
    priority?: string | null; planned_start_date?: string | null; planned_end_date?: string | null;
    track_id?: string | null;
  },
): Promise<{ ok: boolean; sprint_id: string }> {
  const res = await fetch(`${LORE_BASE}/sprint/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ sprint_id: sprintId, ...fields }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; sprint_id: string }>;
}

/** Create a KnowSprint directly (POST /lore/sprint/create). */
export async function createLoreSprint(payload: {
  sprint_id: string; name: string; status?: string; plan_id?: string;
  priority?: string; outcome_md?: string; context_md?: string;
}): Promise<{ ok: boolean; sprint_id: string; created: boolean }> {
  const res = await fetch(`${LORE_BASE}/sprint/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; sprint_id: string; created: boolean }>;
}

export interface LoreRelease {
  release_id: string;
  release_uid: string | null;
  git_tag: string | null;
  version: string | null;
  type: 'major' | 'minor' | 'patch' | string | null;
  release_date: string | null;
  is_current: boolean | null;
  description_md: string | null;
  week: number | null;
  sprint_count: number | null;
  pr_count: number | null;
  git_project: string | null;
}

export interface LoreHistRow {
  valid_from: string | null;
  valid_to: string | null;
  content_hash: string | null;
  source_commit: string | null;
  status_raw?: string | null;
}

export interface LorePlanVersion {
  version_id: string;
  version_date: string | null;
  changelog_md: string | null;
}

export interface LoreKnowDocRow {
  doc_id: string;
  title: string | null;
  // e.g. "page", "fragment", "guide", "reference", "research", "product", "site", "prompt"
  kind: string | null;
  has_ext_deps: boolean | null;
  component_id: string | null;
  // DeepWiki-style page tree (DOC_CHILD_OF edge, child→parent) — not yet
  // rendered as a tree in the UI, just exposed for future use.
  sort_order: number | null;
  parent_doc_id: string | null;
  child_ids: string[] | null;
  // Same edges ADR uses: BELONGS_TO (component_id above, edge-backed via
  // COALESCE with the legacy plain field) and IMPLEMENTED_IN (sprint_ids).
  sprint_ids: string[] | null;
}

export interface LoreKnowDoc extends LoreKnowDocRow {
  content_html: string | null;
  content_md_en: string | null;
  content_md_ru: string | null;
  valid_from: string | null;
}

export async function fetchLoreDoc(
  docId: string,
  signal?: AbortSignal,
): Promise<LoreKnowDoc | null> {
  const rows = await fetchLoreSlice<LoreKnowDoc>('doc_by_id', { id: docId }, signal);
  return rows[0] ?? null;
}

// Partial upsert — only supplied fields are set (same semantics as
// doc_new/POST /lore/doc), so an EN-only save doesn't clear RU.
export async function updateLoreDoc(
  docId: string,
  fields: { title?: string; content_md_en?: string; content_md_ru?: string },
): Promise<{ ok: boolean; doc_id: string }> {
  const res = await fetch(`${LORE_BASE}/doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ doc_id: docId, ...fields }),
  });
  assertJson(res);
  if (!res.ok) return parseError(res);
  return res.json() as Promise<{ ok: boolean; doc_id: string }>;
}

// ── QG dashboard types ──────────────────────────────────────────────────────

export interface LoreQGViolation {
  job_id: string;
  inv_id: string | null;
  severity: string | null;
  status: string | null;
  run_date: string | null;
  note_md: string | null;
  qg_id: string | null;
  component_id: string | null;
}

export interface LoreQGPendingRec {
  rec_id: string;
  title: string | null;
  body_md: string | null;
  status: string | null;
  priority: string | null;
  severity: string | null;
  effort_days: number | null;
  tags: string | null;
  component_id: string | null;
  qg_id: string | null;
  inv_id: string | null;
  fix_cmd: string | null;
  how_to_verify: string | null;
}

export interface LoreQGRoutineRun {
  run_id: string | null;
  routine_name: string;
  run_date: string | null;
  status: string | null;
  flags: string | null;
  started_at: string | null;
  finished_at: string | null;
}

// ── Продуктовый слой: WRITE (PL-31) ────────────────────────────────────────
//
// До этой задачи слой был read-only ПО ПОСТРОЕНИЮ: во фронтенде не было ни
// одного вызова записи, и экран честно писал «Заводятся через MCP feature_new».
// Любая форма создания упиралась в то, что ей нечего звать.
//
// Обёртки тонкие и намеренно повторяют контракт REST один-в-один: слой уже
// проверяет инварианты на сервере (высота корня, цикл в иерархии, вычисляемые
// статусы, существование цели ребра), и дублировать эти проверки здесь значило
// бы завести вторую правду, которая разойдётся с первой.
//
// Ответы link-путей несут linked/…_linked — НЕ игнорировать: CREATE EDGE в
// пустой FROM/TO молча ничего не делает, и «ok:true» без ребра выглядит успехом.

/** Ответ write-пути слоя. `ok` есть всегда; остальное зависит от эндпоинта. */
export interface LoreProductWriteResult {
  ok: boolean;
  /** link-пути: ребро реально создано. false = цель не найдена, см. hint. */
  linked?: boolean;
  /** uc_new: родитель подхвачен (или его нет — тогда hint). */
  parent_linked?: boolean;
  /** actor_new: проект зарегистрирован и привязан. */
  project_linked?: boolean;
  /** Человекочитаемая причина, когда что-то не привязалось. */
  hint?: string;
  /** uc_new/uc_set: линтер оформления возвращается сразу (ADR-027-D3). */
  quality?: unknown;
  [k: string]: unknown;
}

/** Корневой сценарий («фича»). Высота — только cloud|kite (ADR-032 §1). */
export function saveLoreFeature(body: {
  feature_id: string;
  title?: string; body_md?: string; context_md?: string;
  /** Только намерения: active/shipped вычисляются из задач (D17) и отбиваются 400. */
  status?: 'proposed' | 'dropped';
  component_id?: string;
  goal_level?: 'cloud' | 'kite';
}, signal?: AbortSignal) {
  return loreMutate<LoreProductWriteResult>('/feature', body, signal);
}

/** Сценарий любой высоты. parent_uc_id держит DECOMPOSES_INTO в синхроне. */
export function saveLoreUc(body: {
  uc_id: string;
  title?: string; scenario_md?: string; acceptance_md?: string;
  status?: 'proposed' | 'dropped';
  parent_uc_id?: string;
  goal_level?: 'cloud' | 'kite' | 'sea-level' | 'subfunction';
  rigor?: 'casual' | 'fully-dressed';
  priority?: string;
}, signal?: AbortSignal) {
  return loreMutate<LoreProductWriteResult>('/uc', body, signal);
}

/** Проектируемая роль. project обязателен по смыслу (D18), но не по схеме. */
export function saveLoreActor(body: {
  actor_id: string;
  name?: string;
  kind?: 'human-role' | 'system' | 'agent';
  body_md?: string;
  project?: string;
}, signal?: AbortSignal) {
  return loreMutate<LoreProductWriteResult>('/actor', body, signal);
}

export function saveLorePain(body: {
  pain_id: string; title?: string; body_md?: string; severity?: string;
}, signal?: AbortSignal) {
  return loreMutate<LoreProductWriteResult>('/pain', body, signal);
}

/** metric_md — без метрики выгода не попадает в fit (ADR-032). */
export function saveLoreGain(body: {
  gain_id: string; title?: string; body_md?: string; metric_md?: string; rank?: string;
}, signal?: AbortSignal) {
  return loreMutate<LoreProductWriteResult>('/gain', body, signal);
}

export function saveLoreJob(body: {
  job_id: string; title?: string; body_md?: string; kind?: string; importance?: string;
}, signal?: AbortSignal) {
  return loreMutate<LoreProductWriteResult>('/job', body, signal);
}

/**
 * Связки корня — половина «ЗАЯВЛЕНО» парных рёбер (ADR-022-D20).
 * Вторая половина, «ДОСТАВЛЕНО», вешается через linkLoreUc.
 */
export function linkLoreFeature(body: {
  feature_id: string;
  rel: 'pain' | 'gain' | 'job' | 'milestone' | 'component';
  target_id: string;
  action?: 'add' | 'remove';
}, signal?: AbortSignal) {
  return loreMutate<LoreProductWriteResult>('/feature/link', body, signal);
}

/** Связки сценария. relieves/delivers/performs — половина «ДОСТАВЛЕНО». */
export function linkLoreUc(body: {
  uc_id: string;
  rel: 'task' | 'adr' | 'decision' | 'actor' | 'component'
     | 'includes' | 'extends' | 'relieves' | 'delivers' | 'performs';
  target_id: string;
  action?: 'add' | 'remove';
  /** rel="actor": первый актор сценария становится primary по умолчанию (D19). */
  actor_role?: 'primary' | 'supporting';
}, signal?: AbortSignal) {
  return loreMutate<LoreProductWriteResult>('/uc/link', body, signal);
}

/** Профиль клиента: чья боль/выгода/работа (левая половина VP-канвы). */
export function linkLoreVp(body: {
  source_id: string;
  rel: 'felt_by' | 'desired_by' | 'performed_by' | 'blocks' | 'success_of';
  target_id: string;
  action?: 'add' | 'remove';
}, signal?: AbortSignal) {
  return loreMutate<LoreProductWriteResult>('/vp/link', body, signal);
}

/**
 * Линтер оформления по Коберну (ADR-027-D3). Это ЧТЕНИЕ по запросу, но живёт
 * на POST — форма зовёт его по ходу набора, чтобы чек-лист загорался ДО
 * сохранения, а не пост-фактум при ревью.
 */
export function checkLoreUcQuality(body: { uc_id: string }, signal?: AbortSignal) {
  return loreMutate<LoreProductWriteResult>('/uc/quality', body, signal);
}
