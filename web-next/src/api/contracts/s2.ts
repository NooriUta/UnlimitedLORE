// SPRINT_UXR_S2_GRAPH_MEMORY/S2-01 — контракты API S2, зафиксированные до
// бэкенда, чтобы UI v2 (S4) писался параллельно на заглушках (s2.stubs.ts).
// Спека с обоснованием: SPEC-LORE-UXR-S2-CONTRACTS (LORE, слайс specs).
//
// Здесь только формы и чистые правила — без сети. Боевые реализации:
//   контракт 1 «обратные связи»   → S2-02  GET /lore/backlinks
//   контракт 2 «история SCD2»     → S2-03  GET /lore/history
//   контракт 3 «виды/избранное/настройки» → S2-04  /lore/me/{views,favorites,settings}
//   контракт 4 «что LORE помнит»  → S2-05  /lore/me/{memory,recent}
//   409 на всех версионных записях → S2-09 (оптимистическая блокировка)
// Правила, которые сервер обязан повторить, — функции ниже; s2.test.ts держит
// их и сверку типов с Java. Форму менять только вместе со спекой и тестом;
// изменения — только аддитивные (новые необязательные поля).

// ── Общее ────────────────────────────────────────────────────────────────────

/**
 * Маркер скоупа и полнота — те же формы, что в контракте S1
 * (SPEC-LORE-UXR-S1-CONTRACTS, AidaLoreResource.scopeMeta/outsideScopeMarker).
 * v1 и v2 друг друга не импортируют (D-2026-UXR-V2-FOLDER-V1-FROZEN), поэтому
 * формы повторены здесь, а не взяты из src/api/contracts/s1.ts.
 */
export interface ScopeMarker { applied: boolean; projects?: number; note?: string }
export interface OutsideScopeMarker { id: string; verdict: 'outside_scope'; reason: string }
export type Completeness = 'complete' | 'partial' | 'unknown';
export type StatusCategory = 'not_started' | 'in_progress' | 'in_force' | 'finished' | 'withdrawn' | 'unknown';

export interface PageMeta { limit: number | null; offset: number; total: number; has_more: boolean }

/** Тело ошибки — LoreResourceBase.LoreError + current у 409 (S2-09). */
export type S2ErrorCode =
  | 'BAD_PARAMS' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN'
  | 'UNAUTHENTICATED' | 'AGENT_SCOPE_FORBIDDEN' | 'LORE_DISABLED';
export interface S2ErrorBody<C = unknown> { error: S2ErrorCode; detail?: string; current?: C }

/**
 * Кто спрашивает. Человек — kc_sub токена (LoreResourceBase.callerKcSub);
 * агент — client_id и владелец по ребру KnowActor -OWNED_BY-> KnowUser.
 * anonymous — токена нет (auth выключен): личные эндпоинты отвечают 401.
 */
export type S2Caller =
  | { kind: 'human'; kc_sub: string; roles: string[] }
  | { kind: 'agent'; client_id: string; owner_kc_sub: string | null; roles: string[] }
  | { kind: 'anonymous' };

/** Чьё это: kc_sub человека или владельца агента; null — не опознан. */
export function principalSub(c: S2Caller): string | null {
  if (c.kind === 'human') return c.kc_sub;
  if (c.kind === 'agent') return c.owner_kc_sub;
  return null;
}

/** Ссылка на запись: тип API (как в поиске) + естественный id. */
export interface EntityRef { type: string; id: string; title: string | null }

// ── Контракт 1: обратные связи — GET /lore/backlinks ────────────────────────

/** Типы цели = ветки поиска (LoreSearchResource.BRANCHES), S2-02 берёт ту же таблицу. */
export const BACKLINK_TARGET_TYPES = [
  'adr', 'spec', 'sprint', 'task', 'decision', 'question', 'runbook', 'doc',
  'quality_gate', 'use_case', 'pain', 'gain', 'job', 'actor', 'release', 'agent_actor',
] as const;
export type BacklinkTargetType = typeof BACKLINK_TARGET_TYPES[number];

/**
 * Структурные рёбра — не «ссылки», в выдачу не идут: версия записи (HAS_STATE)
 * и принадлежность проекту (BELONGS_TO_PROJECT, это ось скоупа). Сервер
 * возвращает фактический список в excluded_edge_types — UI читает его оттуда.
 */
export const BACKLINK_EXCLUDED_EDGE_TYPES = ['HAS_STATE', 'BELONGS_TO_PROJECT'] as const;

export interface BacklinksQuery {
  type: BacklinkTargetType;
  id: string;
  /** Потолок элементов в одной группе (хабы), по умолчанию 20, максимум 200. */
  per_edge?: number;
  /** CSV-фильтр типов рёбер; пусто — все нестуктурные. */
  edge_types?: string;
}

export interface BacklinkItem extends EntityRef {
  status: string | null;
  status_category: StatusCategory | null;
  /** valid_from ребра, если есть; ISO. */
  linked_at: string | null;
}

export interface BacklinkGroup {
  edge_type: string;
  /** Пока только входящие; 'out' — возможное аддитивное расширение. */
  direction: 'in';
  /** Сколько всего связей этого типа в скоупе (до потолка per_edge). */
  total: number;
  truncated: boolean;
  items: BacklinkItem[];
}

export interface BacklinksResponse {
  target: EntityRef;
  /** Отсортированы по total убыв., затем по edge_type. */
  groups: BacklinkGroup[];
  total: number;
  excluded_edge_types: string[];
  /** Закрытые SCD2-рёбра (valid_to задан) не возвращаются никогда. */
  scope: ScopeMarker | null;
  /** Цель существует, но вне проектов вызывающего: groups пусты, и это не «нет связей». */
  outside_scope: OutsideScopeMarker | null;
  /** partial — хотя бы одна группа обрезана per_edge. */
  completeness: Completeness;
  warnings: string[];
}

// ── Контракт 2: история — GET /lore/history ─────────────────────────────────

/** Типы с цепочкой SCD2 = LoreSlices.HIST_PARENT (та же карта, что у history_hygiene). */
export const HISTORY_TYPES = [
  'adr', 'decision', 'doc', 'finding', 'milestone', 'phase',
  'release', 'runbook', 'spec', 'task', 'sprint', 'dict_entry',
] as const;
export type HistoryType = typeof HISTORY_TYPES[number];

/** Тип → класс цепочки (ключи LoreSlices.HIST_PARENT); отдаётся в HistoryResponse.hist_type. */
export const HISTORY_HIST_CLASS: Readonly<Record<HistoryType, string>> = {
  adr: 'KnowADRHist', decision: 'KnowDecisionHist', doc: 'KnowDocHist', finding: 'KnowFindingHist',
  milestone: 'KnowMilestoneHist', phase: 'KnowPhaseHist', release: 'KnowReleaseHist',
  runbook: 'KnowRunbookHist', spec: 'KnowSpecHist', task: 'KnowTaskHist', sprint: 'KnowSprintHist',
  dict_entry: 'KnowDictEntryHist',
};

export interface HistoryQuery {
  type: string;
  id: string;
  /** Обязателен для dict_entry: ключ справочника составной (dict_type + code). */
  dict_type?: string;
  limit?: number;
  offset?: number;
}

/**
 * Автор правки (принцип 18). Сегодня в *Hist авторства нет — старые версии
 * честно 'unknown'; S2-03 пишет его аддитивными полями при каждой close-open.
 */
export type HistoryAuthor =
  | { kind: 'human'; kc_sub: string; display_name: string | null }
  | { kind: 'agent'; client_id: string; actor_id: string | null; session_id: string | null; owner_kc_sub: string | null }
  | { kind: 'unknown' };

export interface HistoryVersion {
  state_uid: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_open: boolean;
  status: string | null;
  status_category: StatusCategory | null;
  /** Снимок полей версии без служебных (@rid, @type, valid_*, state_uid). */
  fields: Record<string, unknown>;
  /** Поля, отличные от предыдущей (более старой) версии; у первой — все. */
  changed: string[];
  author: HistoryAuthor;
}

export type HistoryAnomaly = 'multiple_open_versions' | 'open_state_without_valid_from' | 'no_open_version';

export interface HistoryResponse {
  target: EntityRef;
  /** not_tracked — у типа нет цепочки SCD2: «история не ведётся», а не «правок не было». */
  tracking: 'scd2' | 'not_tracked';
  hist_type: string | null;
  /** Новейшая первой. */
  versions: HistoryVersion[];
  anomalies: HistoryAnomaly[];
  page: PageMeta | null;
  scope: ScopeMarker | null;
  outside_scope: OutsideScopeMarker | null;
  warnings: string[];
}

export function historyAnomalies(versions: readonly HistoryVersion[]): HistoryAnomaly[] {
  if (versions.length === 0) return [];
  const open = versions.filter(v => v.is_open);
  const out: HistoryAnomaly[] = [];
  if (open.length > 1) out.push('multiple_open_versions');
  if (open.some(v => v.valid_from == null)) out.push('open_state_without_valid_from');
  if (open.length === 0) out.push('no_open_version');
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Изменённые поля older → newer (включая появившиеся и пропавшие), по алфавиту. */
export function changedFields(older: Record<string, unknown> | null, newer: Record<string, unknown>): string[] {
  const prev = older ?? {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(newer)]);
  return [...keys].filter(k => !(k in prev) || !(k in newer) || !same(prev[k], newer[k])).sort();
}

// ── Контракт 3: виды, избранное, настройки — /lore/me/* ─────────────────────

export type ViewVisibility =
  | { kind: 'me' }
  | { kind: 'all' }
  | { kind: 'roles'; roles: string[] };

export interface SavedView {
  view_id: string;
  name: string;
  /** Раздел v2 (tasks, adrs, …) — ключ навигации, а не таблица БД. */
  section: string;
  /** Строка запроса раздела без «?» — состояние живёт в URL. */
  query: string;
  visibility: ViewVisibility;
  /** null — командный вид (владелец — команда, правит admin). */
  owner: { kc_sub: string; display_name?: string | null } | null;
  is_team_default: boolean;
  order: number;
  created_at: string;
  updated_at: string;
  /** Номер версии для оптимистической блокировки (S2-09). */
  version: number;
  /**
   * Мой это вид или нет (S5-14, аддитивно). Боевой сервер kc_sub владельца не
   * отдаёт — только «мой / не мой» (LoreMeResource.viewOut), поэтому у видов
   * с сервера owner остаётся null: придумывать чужой идентификатор нельзя.
   */
  own?: boolean;
  /** Личный вид по умолчанию в разделе (есть у боевого сервера). */
  is_personal_default?: boolean;
}

export interface SavedViewInput {
  name: string;
  section: string;
  query: string;
  visibility: ViewVisibility;
  /** Командное умолчание раздела — только admin, иначе 403 FORBIDDEN. */
  is_team_default?: boolean;
  order?: number;
}

export type SavedViewPatch = Partial<SavedViewInput> & { expected_version: number };

export interface ViewsResponse {
  /** Только видимые вызывающему. */
  items: SavedView[];
  /** Действующее умолчание по разделам: личное перекрывает командное. */
  effective_default: Record<string, string | null>;
}

export function canSeeView(v: SavedView, caller: S2Caller): boolean {
  const sub = principalSub(caller);
  if (v.owner && v.owner.kc_sub === sub) return true;
  if (v.visibility.kind === 'all') return caller.kind !== 'anonymous';
  if (v.visibility.kind === 'roles') {
    const roles = caller.kind === 'anonymous' ? [] : caller.roles;
    return v.visibility.roles.some(r => roles.includes(r));
  }
  return false;
}

export function effectiveDefaultView(views: readonly SavedView[], section: string, caller: S2Caller): SavedView | null {
  const sub = principalSub(caller);
  const candidates = views.filter(v => v.section === section && v.is_team_default && canSeeView(v, caller));
  return candidates.find(v => v.owner?.kc_sub === sub && sub != null)
    ?? candidates.find(v => v.owner == null)
    ?? null;
}

export interface Favorite { type: string; id: string; title: string | null; added_at: string }
export interface FavoritesResponse { items: Favorite[] }

/** Личные настройки (пункты S2-04). Ключи snake_case — как в теле API. */
export interface UserSettings {
  collapse_nav_on_read: boolean;
  right_column: 'auto' | 'open' | 'closed';
  /** Шаг xl добавлен 09.11.2026 (S4-16): «у меня 4к и все мелкое». Сервер его уже знал — см. SettingsResponse.warnings. */
  text_size: 'sm' | 'md' | 'lg' | 'xl';
  /** Палитра темы — те же коды, что в cookie seer-prefs (palette). */
  palette: string;
  mode: 'dark' | 'light';
  /** roomy — умолчание с S4-21 (владелица 08.11): строка списка как в прототипе v4. */
  density: 'roomy' | 'compact' | 'comfortable';
  single_key_shortcuts: boolean;
  stripes: boolean;
  /** Карточка Peek по наведению на ссылку (S9-10, D-2026-LORE-PEEK-ONE-CARD); выключить можно, как в Wikipedia. */
  peek_hover: boolean;
  /** Флаг «новая навигация»; cookie seer-prefs.nav остаётся кэшем для перехода между хостами. */
  nav_version: 'v1' | 'v2';
  /** S4-TECH-NOTES: показывать технические сведения (коды источников, оговорки модели, сырые метрики). */
  show_tech: boolean;
  /**
   * Множитель размера шрифта поверх ступени text_size (S4-16, ползунок kit).
   * Сервер его хранил давно (LoreMePrefs), клиент — нет: ползунка в настройках
   * не было (S4-21, владелица 11.11: «я жду ползунка для шрифтов»). 1 — выбора не было.
   */
  text_scale: number;
}

export const DEFAULT_SETTINGS: Readonly<UserSettings> = {
  collapse_nav_on_read: false,
  right_column: 'auto',
  text_size: 'md',
  palette: 'amber',
  mode: 'dark',
  density: 'roomy',
  single_key_shortcuts: true,
  stripes: true,
  peek_hover: true,
  nav_version: 'v2',
  show_tech: false,
  text_scale: 1,
};

type Check = (v: unknown) => boolean;
const oneOf = (...xs: string[]): Check => v => typeof v === 'string' && xs.includes(v);
const bool: Check = v => typeof v === 'boolean';
const SETTINGS_SCHEMA: Record<keyof UserSettings, Check> = {
  collapse_nav_on_read: bool,
  right_column: oneOf('auto', 'open', 'closed'),
  text_size: oneOf('sm', 'md', 'lg', 'xl'),
  palette: v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v),
  mode: oneOf('dark', 'light'),
  density: oneOf('roomy', 'compact', 'comfortable'),
  single_key_shortcuts: bool,
  stripes: bool,
  peek_hover: bool,
  nav_version: oneOf('v1', 'v2'),
  show_tech: bool,
  text_scale: v => typeof v === 'number' && Number.isFinite(v),
};

/** Ключи патча, которые сервер отвергнет 400 BAD_PARAMS (незнакомые и с чужим значением). */
export function validateSettingsPatch(patch: Partial<UserSettings>): string[] {
  return Object.entries(patch)
    .filter(([k, v]) => !(k in SETTINGS_SCHEMA) || !SETTINGS_SCHEMA[k as keyof UserSettings](v))
    .map(([k]) => k);
}

/** Сохранённое поверх умолчаний; незнакомые/битые ключи (новее клиента) отбрасываются. */
export function mergeSettings(stored: Partial<UserSettings> | null | undefined): UserSettings {
  const out: UserSettings = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(stored ?? {})) {
    const check = SETTINGS_SCHEMA[k as keyof UserSettings];
    if (check && check(v)) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

export interface SettingsResponse {
  settings: UserSettings;
  defaults: UserSettings;
  version: number;
  updated_at: string | null;
  /**
   * Расхождения, о которых нельзя молчать (S5-14, аддитивно). Боевой сервер
   * знает значения, которых в v2 нет (например theme: system): клиент
   * показывает умолчание v2 и называет расхождение здесь. Пустой массив —
   * «перевод сошёлся», отсутствие поля — «источник о расхождениях не говорит».
   */
  warnings?: string[];
}
export interface SettingsPatchRequest { patch: Partial<UserSettings>; expected_version: number }

// ── Контракт 4: «что LORE помнит обо мне» — /lore/me/memory, /lore/me/recent ─

export const MEMORY_KINDS = ['frequent_views', 'frequent_slices', 'recent_records'] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];

/** Срок хранения привычек: старше — стирается сервером (S2-05). */
export const MEMORY_RETENTION_DAYS = 90;

export interface MemoryItem {
  memory_id: string;
  kind: MemoryKind;
  /** view_id | section?query | type:id */
  key: string;
  label: string | null;
  hits: number;
  first_seen: string;
  last_seen: string;
}

export interface MemoryResponse {
  remembering: boolean;
  retention_days: number;
  categories: { kind: MemoryKind; items: MemoryItem[] }[];
  /** Правило доступа, а не настройка: никаких сводок «по людям». */
  access: 'self_and_own_agents';
}

export interface RecentResponse {
  /** false — «не запоминаю»: пустой список значит выключено, а не «ничего не открывали». */
  remembering: boolean;
  items: (EntityRef & { last_seen: string })[];
}

export type RecordRecentResult = { recorded: true } | { recorded: false; reason: 'not_remembering' };

/** Память читает и стирает только сам пользователь и его агенты (OWNED_BY); admin — нет. */
export function canReadMemory(caller: S2Caller, ownerSub: string): boolean {
  const sub = principalSub(caller);
  return sub != null && sub === ownerSub;
}

// ── Реестр эндпоинтов ───────────────────────────────────────────────────────

export interface S2Endpoint {
  contract: 'backlinks' | 'history' | 'views' | 'settings' | 'memory';
  task: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: string[];
  /** Запись над версионным объектом — требует expected_version, иначе 409 (S2-09). */
  versioned?: boolean;
  errors: S2ErrorCode[];
  /** Агенты: all — любые; own — только агенты владельца (OWNED_BY); none — только человек. */
  agents: 'own' | 'none' | 'all';
}

const R: S2ErrorCode[] = ['UNAUTHENTICATED'];

export const S2_ENDPOINTS: readonly S2Endpoint[] = [
  { contract: 'backlinks', task: 'S2-02', method: 'GET', path: '/lore/backlinks', query: ['type', 'id', 'per_edge', 'edge_types'], errors: ['BAD_PARAMS', 'NOT_FOUND'], agents: 'all' },
  { contract: 'history', task: 'S2-03', method: 'GET', path: '/lore/history', query: ['type', 'id', 'dict_type', 'limit', 'offset'], errors: ['BAD_PARAMS', 'NOT_FOUND'], agents: 'all' },

  { contract: 'views', task: 'S2-04', method: 'GET', path: '/lore/me/views', query: ['section'], errors: R, agents: 'own' },
  { contract: 'views', task: 'S2-04', method: 'POST', path: '/lore/me/views', errors: [...R, 'BAD_PARAMS', 'FORBIDDEN', 'AGENT_SCOPE_FORBIDDEN'], agents: 'none' },
  { contract: 'views', task: 'S2-04', method: 'PUT', path: '/lore/me/views/{view_id}', versioned: true, errors: [...R, 'BAD_PARAMS', 'NOT_FOUND', 'CONFLICT', 'FORBIDDEN', 'AGENT_SCOPE_FORBIDDEN'], agents: 'none' },
  { contract: 'views', task: 'S2-04', method: 'DELETE', path: '/lore/me/views/{view_id}', query: ['expected_version'], versioned: true, errors: [...R, 'NOT_FOUND', 'CONFLICT', 'FORBIDDEN', 'AGENT_SCOPE_FORBIDDEN'], agents: 'none' },
  { contract: 'views', task: 'S2-04', method: 'GET', path: '/lore/me/favorites', errors: R, agents: 'own' },
  { contract: 'views', task: 'S2-04', method: 'PUT', path: '/lore/me/favorites/{type}/{id}', errors: [...R, 'BAD_PARAMS', 'AGENT_SCOPE_FORBIDDEN'], agents: 'none' },
  { contract: 'views', task: 'S2-04', method: 'DELETE', path: '/lore/me/favorites/{type}/{id}', errors: [...R, 'AGENT_SCOPE_FORBIDDEN'], agents: 'none' },

  { contract: 'settings', task: 'S2-04', method: 'GET', path: '/lore/me/settings', errors: R, agents: 'own' },
  { contract: 'settings', task: 'S2-04', method: 'PATCH', path: '/lore/me/settings', versioned: true, errors: [...R, 'BAD_PARAMS', 'CONFLICT', 'AGENT_SCOPE_FORBIDDEN'], agents: 'none' },

  { contract: 'memory', task: 'S2-05', method: 'GET', path: '/lore/me/memory', errors: [...R, 'FORBIDDEN'], agents: 'own' },
  // Стирание — одним POST, как на бэкенде (LoreMemoryResource): тело {kind?} стирает категорию
  // (пустое — всё), тело {memory_id} — одну запись (recent:<type>:<id> | mem-<uuid>).
  { contract: 'memory', task: 'S2-05', method: 'POST', path: '/lore/me/memory/delete', errors: [...R, 'BAD_PARAMS', 'NOT_FOUND', 'FORBIDDEN'], agents: 'own' },
  { contract: 'memory', task: 'S2-05', method: 'POST', path: '/lore/me/memory/remembering', errors: [...R, 'BAD_PARAMS', 'AGENT_SCOPE_FORBIDDEN'], agents: 'none' },
  // Учёт привычки: тело {kind: 'frequent_views'|'frequent_slices', key, label?}.
  { contract: 'memory', task: 'S2-05', method: 'POST', path: '/lore/me/memory/hit', errors: [...R, 'BAD_PARAMS', 'NOT_FOUND', 'AGENT_SCOPE_FORBIDDEN'], agents: 'none' },
  { contract: 'memory', task: 'S2-05', method: 'GET', path: '/lore/me/recent', query: ['limit'], errors: R, agents: 'own' },
  { contract: 'memory', task: 'S2-05', method: 'POST', path: '/lore/me/recent', errors: [...R, 'BAD_PARAMS'], agents: 'none' },
];
