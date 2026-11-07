// Сохранённые виды списка (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-08,
// D-2026-UXR-VIEWS-SERVER): чистая модель без React.
//
// Вид = строка запроса состояния списка (фильтры, «Быстро», группировка,
// порядок, вид список/доска) + имя + раздел + видимость «я / все / роли».
// Владелец — kc_sub; owner=null — командный вид (сервер), team_default — вид
// раздела по умолчанию, чтобы новичок не видел пустоту. Личный вид с
// personal_default переопределяет командный.
//
// Хранение — на сервере (SPRINT_UXR_S2_GRAPH_MEMORY/S2-04). Пока его нет,
// createMemoryViewStore — заглушка по тому же контракту KitViewStore: те же
// формы, те же коды отказов (403 на чужой/командный вид, 404 на неизвестный),
// чтобы замена на HTTP-клиент не меняла экран.
import { DEFAULT_LIST_STATE, LIST_URL_KEYS, readListState, writeListState } from '../../list/listModel';
import type { ListState } from '../../list/listModel';

export type KitViewVisibility = 'me' | 'all' | { roles: string[] };

/** Вид по контракту S2: форма ответа GET /lore/views?section=… (строка массива). */
export interface KitSavedListView {
  id: string;
  name: string;
  /** Раздел (пункт меню), к которому относится вид: sprints, adrs… */
  section: string;
  /** Состояние списка строкой запроса (ключи LIST_URL_KEYS: lv, lq, lg, ls, lf). */
  query: string;
  visibility: KitViewVisibility;
  /** kc_sub владельца; null — командный вид. */
  owner: string | null;
  /** Командный вид раздела по умолчанию. */
  team_default?: boolean;
  /** Личный вид по умолчанию — важнее командного. */
  personal_default?: boolean;
  updated_at?: string;
}

/** Тело создания вида: POST /lore/views. Владельца ставит сервер по токену. */
export type KitViewDraft = Pick<KitSavedListView, 'name' | 'section' | 'query' | 'visibility'> & { personal_default?: boolean };
/** Тело правки вида: PATCH /lore/views/{id}. */
export type KitViewPatch = Partial<Pick<KitSavedListView, 'name' | 'query' | 'visibility' | 'personal_default'>>;

/**
 * Хранилище видов (контракт S2). Отказ — исключение с полем status (403 — нет
 * прав, 404 — нет вида, 409 — конфликт), как у HTTP-клиента: экран различает
 * «нет прав» и «сбой» по classifyError, а не по тексту.
 */
export interface KitViewStore {
  list(section: string): Promise<KitSavedListView[]>;
  create(draft: KitViewDraft): Promise<KitSavedListView>;
  update(id: string, patch: KitViewPatch): Promise<KitSavedListView>;
  remove(id: string): Promise<void>;
}

/* ---------- состояние ⇄ строка ---------- */

/** Каноническая строка: ключи фильтра по алфавиту, пустое — не пишется. */
export function listStateToQuery(s: ListState): string {
  const filters = Object.fromEntries(
    Object.entries(s.filters).filter(([, v]) => v.length > 0).sort(([a], [b]) => a.localeCompare(b)),
  );
  const raw = writeListState({ ...s, filters });
  const p = new URLSearchParams();
  for (const k of LIST_URL_KEYS) {
    const v = raw[k];
    if (v !== null && v !== '') p.set(k, v);
  }
  return p.toString();
}

/** Обратно в состояние; битая строка — состояние по умолчанию (readListState). */
export function queryToListState(q: string): ListState {
  return readListState(new URLSearchParams(q));
}

/** «Изменён»: текущее состояние отличается от сохранённого (или от умолчания без вида). */
export function isViewDirty(view: KitSavedListView | null, current: ListState): boolean {
  const base = view ? listStateToQuery(queryToListState(view.query)) : listStateToQuery(DEFAULT_LIST_STATE);
  return listStateToQuery(current) !== base;
}

/* ---------- умолчания, старт, сброс ---------- */

export function teamDefault(views: readonly KitSavedListView[], section: string): KitSavedListView | null {
  return views.find(v => v.section === section && v.owner === null && v.team_default) ?? null;
}

/** С какого вида открыть раздел: id из URL → личный по умолчанию → командный. */
export function startView(views: readonly KitSavedListView[], section: string, urlId: string | null): KitSavedListView | null {
  const inSection = views.filter(v => v.section === section);
  if (urlId) {
    const byId = inSection.find(v => v.id === urlId);
    if (byId) return byId;
  }
  return inSection.find(v => v.owner !== null && v.personal_default) ?? teamDefault(inSection, section);
}

/**
 * Куда ведёт «Сбросить»: при правках — к сохранённому состоянию активного
 * вида; без правок — к командному виду по умолчанию; некуда — null.
 */
export function resetTarget(
  views: readonly KitSavedListView[], section: string, active: KitSavedListView | null, current: ListState,
): KitSavedListView | null {
  if (active && isViewDirty(active, current)) return active;
  const team = teamDefault(views, section);
  if (team && team.id !== active?.id) return team;
  return null;
}

/** «Сохранить» — только в свой вид; командный и чужой — через «Сохранить как». */
export function viewCanSave(view: KitSavedListView | null, user: string | null | undefined): boolean {
  return !!view && !!user && view.owner === user;
}

/* ---------- заглушка хранилища по контракту S2 ---------- */

export interface ViewStoreError extends Error { status: number }

function fail(status: number, message: string): ViewStoreError {
  return Object.assign(new Error(message), { status });
}

export interface MemoryViewStoreOptions {
  /** kc_sub текущего пользователя — владелец новых видов. */
  user: string;
  /** Командные виды (owner=null); в заглушке неизменяемы, как на сервере для не-админа. */
  teamViews?: readonly KitSavedListView[];
  /** Куда сохранять личные виды между перезагрузками (кэш браузера); без него — память. */
  persist?: { get(key: string): string | null; set(key: string, value: string): void };
  key?: string;
  /** Часы (тесты). */
  now?: () => string;
}

function readPersisted(o: MemoryViewStoreOptions): KitSavedListView[] {
  if (!o.persist) return [];
  try {
    const raw = JSON.parse(o.persist.get(o.key ?? 'views') ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((v): v is KitSavedListView => !!v && typeof v === 'object' && typeof (v as KitSavedListView).id === 'string')
      : [];
  } catch {
    return [];
  }
}

export function createMemoryViewStore(o: MemoryViewStoreOptions): KitViewStore {
  const team = (o.teamViews ?? []).map(v => ({ ...v, owner: null }));
  let mine: KitSavedListView[] = readPersisted(o);
  const now = o.now ?? (() => new Date().toISOString());
  const save = () => o.persist?.set(o.key ?? 'views', JSON.stringify(mine));
  const visible = (v: KitSavedListView) => v.owner === o.user || v.visibility !== 'me';
  const nextId = () => {
    let n = mine.length + 1;
    while (mine.some(v => v.id === `view-${n}`) || team.some(v => v.id === `view-${n}`)) n += 1;
    return `view-${n}`;
  };
  const own = (id: string): KitSavedListView => {
    if (team.some(v => v.id === id)) throw fail(403, 'team view is read-only');
    const v = mine.find(x => x.id === id);
    if (!v) throw fail(404, `view ${id} not found`);
    if (v.owner !== o.user) throw fail(403, 'not the owner');
    return v;
  };
  return {
    async list(section) {
      return [...team, ...mine.filter(visible)].filter(v => v.section === section).map(v => ({ ...v }));
    },
    async create(draft) {
      const v: KitSavedListView = { ...draft, id: nextId(), owner: o.user, updated_at: now() };
      if (v.personal_default) mine = mine.map(x => x.section === v.section ? { ...x, personal_default: false } : x);
      mine = [...mine, v];
      save();
      return { ...v };
    },
    async update(id, patch) {
      const cur = own(id);
      const v: KitSavedListView = { ...cur, ...patch, updated_at: now() };
      if (patch.personal_default) mine = mine.map(x => x.section === v.section ? { ...x, personal_default: false } : x);
      mine = mine.map(x => x.id === id ? v : x);
      save();
      return { ...v };
    },
    async remove(id) {
      own(id);
      mine = mine.filter(x => x.id !== id);
      save();
    },
  };
}
