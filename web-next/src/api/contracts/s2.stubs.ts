// SPRINT_UXR_S2_GRAPH_MEMORY/S2-01 — заглушки по контрактам S2 для UI v2 (S4).
// Клиент в памяти с той же поверхностью, что будет у боевого (S2-02..S2-05):
// UI пишется против S2Client, а боевой fetch-клиент подменяет заглушку без
// правки экранов. Правила (видимость, умолчания, 409, доступ к памяти) взяты
// из s2.ts — заглушка их не дублирует, а вызывает.

import {
  BACKLINK_EXCLUDED_EDGE_TYPES,
  BACKLINK_TARGET_TYPES,
  DEFAULT_SETTINGS,
  HISTORY_HIST_CLASS,
  HISTORY_TYPES,
  MEMORY_KINDS,
  MEMORY_RETENTION_DAYS,
  canReadMemory,
  canSeeView,
  changedFields,
  effectiveDefaultView,
  historyAnomalies,
  mergeSettings,
  principalSub,
  validateSettingsPatch,
  type BacklinkGroup,
  type BacklinksQuery,
  type BacklinksResponse,
  type Favorite,
  type FavoritesResponse,
  type HistoryQuery,
  type HistoryResponse,
  type HistoryType,
  type HistoryVersion,
  type MemoryItem,
  type MemoryKind,
  type MemoryResponse,
  type RecentResponse,
  type RecordRecentResult,
  type S2Caller,
  type S2ErrorBody,
  type SavedView,
  type SavedViewInput,
  type SavedViewPatch,
  type SettingsPatchRequest,
  type SettingsResponse,
  type UserSettings,
  type ViewsResponse,
} from './s2';

export class S2HttpError<C = unknown> extends Error {
  constructor(readonly status: number, readonly body: S2ErrorBody<C>) {
    super(`${status} ${body.error}${body.detail ? ': ' + body.detail : ''}`);
  }
}

/** 409 S2-09: в body.current — состояние, с которым разошлось expected_version. */
export class S2ConflictError<C> extends S2HttpError<C> {
  constructor(current: C) {
    super(409, { error: 'CONFLICT', detail: 'запись изменена другой сессией — перечитайте и повторите', current });
  }
}

export interface S2Client {
  backlinks(q: BacklinksQuery): Promise<BacklinksResponse>;
  history(q: HistoryQuery): Promise<HistoryResponse>;
  listViews(section?: string): Promise<ViewsResponse>;
  createView(input: SavedViewInput): Promise<SavedView>;
  updateView(viewId: string, patch: SavedViewPatch): Promise<SavedView>;
  deleteView(viewId: string, expectedVersion: number): Promise<void>;
  listFavorites(): Promise<FavoritesResponse>;
  addFavorite(type: string, id: string): Promise<Favorite>;
  removeFavorite(type: string, id: string): Promise<void>;
  getSettings(): Promise<SettingsResponse>;
  patchSettings(req: SettingsPatchRequest): Promise<SettingsResponse>;
  memory(): Promise<MemoryResponse>;
  forget(memoryId: string): Promise<void>;
  forgetAll(kind?: MemoryKind): Promise<{ deleted: number }>;
  setRemembering(req: { remembering: boolean; purge?: boolean }): Promise<{ remembering: boolean }>;
  recent(limit?: number): Promise<RecentResponse>;
  recordRecent(type: string, id: string): Promise<RecordRecentResult>;
}

const NOW = '2026-11-07T12:00:00Z';
const SCOPE = { applied: true, projects: 1, note: 'выдача сужена проектным скоупом — строки вне разрешённых проектов не показаны' };

const TITLES: Record<string, string> = {
  'adr:ADR-LORE-045': 'UI v2 отдельным приложением',
  'adr:ADR-LORE-038': 'Продукт над проектами',
  'spec:SPEC-LONELY': 'Спека без входящих связей',
  'sprint:SPRINT_UXR_S2_GRAPH_MEMORY': 'Редизайн UI · S2 Сервер',
  'task:SPRINT_UXR_S2_GRAPH_MEMORY/S2-01': 'Контракты API S2',
  'question:Q-1': 'Открытый вопрос',
};
const OUTSIDE = new Set(['adr:ADR-VOLVA-001']);

/** Входящие связи ADR-LORE-045 — формы реальных рёбер схемы. */
const BACKLINKS_045: BacklinkGroup[] = [
  {
    edge_type: 'REFERENCES_ADR', direction: 'in', total: 3, truncated: false,
    items: [
      { type: 'task', id: 'SPRINT_UXR_S3_V2_INFRA/S3-01', title: 'Каталог web-next', status: 'done', status_category: 'finished', linked_at: '2026-11-05T09:00:00Z' },
      { type: 'task', id: 'SPRINT_UXR_S2_GRAPH_MEMORY/S2-07', title: 'Миграции S2 безопасны для v1', status: 'planned', status_category: 'not_started', linked_at: null },
      { type: 'spec', id: 'SPEC-LORE-UXR-S1-CONTRACTS', title: 'Контракты S1', status: 'accepted', status_category: 'in_force', linked_at: null },
    ],
  },
  {
    edge_type: 'DECIDED_IN', direction: 'in', total: 1, truncated: false,
    items: [{ type: 'decision', id: 'D-2026-UXR-V2-FOLDER-V1-FROZEN', title: 'Код v1 заморожен', status: 'accepted', status_category: 'in_force', linked_at: null }],
  },
];

const v = (
  state_uid: string, valid_from: string, valid_to: string | null,
  fields: Record<string, unknown>, author: HistoryVersion['author'],
): HistoryVersion => ({
  state_uid, valid_from, valid_to, is_open: valid_to == null,
  status: typeof fields.status_raw === 'string' ? fields.status_raw : null,
  status_category: null, fields, changed: [], author,
});

/** Старейшая первой — заглушка сама разворачивает и считает changed, как обязан сервер. */
const TASK_HISTORY: HistoryVersion[] = [
  v('st-1', '2026-11-06T18:00:00Z', '2026-11-07T11:00:00Z', { title: 'Контракты API S2', status_raw: 'planned', effort_days: 0.5 }, { kind: 'unknown' }),
  v('st-2', '2026-11-07T11:00:00Z', null, { title: 'Контракты API S2', status_raw: 'active', effort_days: 0.5 },
    { kind: 'agent', client_id: 'lore-agent-full', actor_id: 'claude-code-full', session_id: 'sess-s2-01', owner_kc_sub: 'sub-owner' }),
];

function withChanges(oldestFirst: HistoryVersion[]): HistoryVersion[] {
  return oldestFirst
    .map((x, i) => ({ ...x, changed: changedFields(i === 0 ? null : oldestFirst[i - 1].fields, x.fields) }))
    .reverse();
}

function seedMemory(): MemoryItem[] {
  return [
    { memory_id: 'm1', kind: 'frequent_views', key: 'view-blockers', label: 'Блокеры', hits: 14, first_seen: '2026-10-01T08:00:00Z', last_seen: NOW },
    { memory_id: 'm2', kind: 'frequent_slices', key: 'tasks?status=active', label: null, hits: 9, first_seen: '2026-10-10T08:00:00Z', last_seen: NOW },
    { memory_id: 'm3', kind: 'frequent_slices', key: 'adrs?status=proposed', label: null, hits: 4, first_seen: '2026-10-12T08:00:00Z', last_seen: NOW },
    { memory_id: 'm4', kind: 'recent_records', key: 'adr:ADR-LORE-038', label: 'Продукт над проектами', hits: 2, first_seen: '2026-11-06T08:00:00Z', last_seen: NOW },
  ];
}

export interface S2StubOptions {
  caller?: S2Caller;
  /** Чья память открывается; по умолчанию — вызывающего (так устроен /lore/me). */
  memoryOwner?: string;
}

const DEFAULT_CALLER: S2Caller = { kind: 'human', kc_sub: 'sub-owner', roles: ['admin'] };

const isAdmin = (c: S2Caller) => c.kind !== 'anonymous' && c.roles.some(r => r === 'admin' || r === 'superadmin');

export function createS2Stub(opts: S2StubOptions = {}): S2Client {
  const caller = opts.caller ?? DEFAULT_CALLER;
  const sub = principalSub(caller);
  const memoryOwner = opts.memoryOwner ?? sub ?? '';
  let seq = 0;
  const views: SavedView[] = [
    {
      view_id: 'team-tasks-open', name: 'Открытые задачи', section: 'tasks', query: 'status=open',
      visibility: { kind: 'all' }, owner: null, is_team_default: true, order: 0,
      created_at: NOW, updated_at: NOW, version: 1,
    },
  ];
  let favorites: Favorite[] = [];
  let settings: UserSettings = { ...DEFAULT_SETTINGS };
  let settingsVersion = 1;
  let settingsUpdated: string | null = null;
  let memory = seedMemory();
  let remembering = true;

  const requireSub = (): string => {
    if (!sub) throw new S2HttpError(401, { error: 'UNAUTHENTICATED', detail: 'личные эндпоинты требуют токен' });
    return sub;
  };
  const requireHuman = () => {
    if (caller.kind === 'agent') throw new S2HttpError(403, { error: 'AGENT_SCOPE_FORBIDDEN', detail: 'личные настройки и виды правит человек' });
  };
  const requireMemoryAccess = () => {
    requireSub();
    if (!canReadMemory(caller, memoryOwner)) {
      throw new S2HttpError(403, { error: 'FORBIDDEN', detail: 'память пользователя видят только он сам и его агенты' });
    }
  };
  const ownView = (id: string): SavedView => {
    const found = views.find(x => x.view_id === id);
    if (!found || !canSeeView(found, caller)) throw new S2HttpError(404, { error: 'NOT_FOUND', detail: id });
    const mine = found.owner?.kc_sub === sub;
    if (!mine && !(found.owner == null && isAdmin(caller))) throw new S2HttpError(403, { error: 'FORBIDDEN', detail: 'чужой вид' });
    return found;
  };
  const checkTeamDefault = (input: Partial<SavedViewInput>) => {
    const team = input.visibility && input.visibility.kind !== 'me';
    if (input.is_team_default && team && !isAdmin(caller)) {
      throw new S2HttpError(403, { error: 'FORBIDDEN', detail: 'командный вид по умолчанию задаёт admin' });
    }
  };
  const settingsBody = (): SettingsResponse => ({
    settings: mergeSettings(settings), defaults: { ...DEFAULT_SETTINGS }, version: settingsVersion, updated_at: settingsUpdated,
  });

  return {
    async backlinks(q) {
      if (!(BACKLINK_TARGET_TYPES as readonly string[]).includes(q.type)) {
        throw new S2HttpError(400, { error: 'BAD_PARAMS', detail: `type: ${String(q.type)}` });
      }
      const key = `${q.type}:${q.id}`;
      const base = {
        excluded_edge_types: [...BACKLINK_EXCLUDED_EDGE_TYPES], scope: SCOPE, warnings: [] as string[],
      };
      if (OUTSIDE.has(key)) {
        return {
          ...base, target: { type: q.type, id: q.id, title: null }, groups: [], total: 0, completeness: 'complete',
          outside_scope: { id: q.id, verdict: 'outside_scope', reason: 'запись с таким id существует, но вне ваших проектов — пустой ответ не значит «нет»' },
        };
      }
      if (!(key in TITLES)) throw new S2HttpError(404, { error: 'NOT_FOUND', detail: key });
      const perEdge = Math.min(Math.max(q.per_edge ?? 20, 1), 200);
      const filter = q.edge_types ? new Set(q.edge_types.split(',').map(s => s.trim())) : null;
      const src = key === 'adr:ADR-LORE-045' ? BACKLINKS_045 : [];
      const groups = src
        .filter(g => !filter || filter.has(g.edge_type))
        .map(g => ({ ...g, items: g.items.slice(0, perEdge), truncated: g.total > perEdge }))
        .sort((a, b) => b.total - a.total || a.edge_type.localeCompare(b.edge_type));
      return {
        ...base, target: { type: q.type, id: q.id, title: TITLES[key] }, groups,
        total: groups.reduce((n, g) => n + g.total, 0), outside_scope: null,
        completeness: groups.some(g => g.truncated) ? 'partial' : 'complete',
      };
    },

    async history(q) {
      const key = `${q.type}:${q.id}`;
      if (!(key in TITLES)) throw new S2HttpError(404, { error: 'NOT_FOUND', detail: key });
      const target = { type: q.type, id: q.id, title: TITLES[key] };
      const common = { scope: SCOPE, outside_scope: null, warnings: [] as string[] };
      if (!(HISTORY_TYPES as readonly string[]).includes(q.type)) {
        return { ...common, target, tracking: 'not_tracked', hist_type: null, versions: [], anomalies: [], page: null };
      }
      if (q.type === 'dict_entry' && !q.dict_type) throw new S2HttpError(400, { error: 'BAD_PARAMS', detail: 'dict_type обязателен для dict_entry' });
      const all = withChanges(q.type === 'task' ? TASK_HISTORY : []);
      const offset = q.offset ?? 0;
      const limit = q.limit ?? 50;
      const versions = all.slice(offset, offset + limit);
      return {
        ...common, target, tracking: 'scd2', hist_type: HISTORY_HIST_CLASS[q.type as HistoryType],
        versions, anomalies: historyAnomalies(all),
        page: { limit, offset, total: all.length, has_more: offset + limit < all.length },
      };
    },

    async listViews(section) {
      requireSub();
      const visible = views.filter(x => canSeeView(x, caller) && (!section || x.section === section));
      const sections = [...new Set(visible.map(x => x.section))];
      const effective_default: Record<string, string | null> = {};
      for (const s of sections) effective_default[s] = effectiveDefaultView(views, s, caller)?.view_id ?? null;
      return { items: visible, effective_default };
    },

    async createView(input) {
      const me = requireSub();
      requireHuman();
      checkTeamDefault(input);
      const teamOwned = input.is_team_default === true && input.visibility.kind !== 'me';
      const created: SavedView = {
        view_id: `view-${++seq}`, name: input.name, section: input.section, query: input.query,
        visibility: input.visibility, owner: teamOwned ? null : { kc_sub: me },
        is_team_default: input.is_team_default ?? false, order: input.order ?? views.length,
        created_at: NOW, updated_at: NOW, version: 1,
      };
      views.push(created);
      return created;
    },

    async updateView(viewId, patch) {
      requireSub();
      requireHuman();
      const cur = ownView(viewId);
      if (patch.expected_version !== cur.version) throw new S2ConflictError<SavedView>({ ...cur });
      checkTeamDefault({ ...cur, ...patch });
      const { expected_version: _ignored, ...fields } = patch;
      void _ignored;
      Object.assign(cur, fields, { version: cur.version + 1, updated_at: NOW });
      return { ...cur };
    },

    async deleteView(viewId, expectedVersion) {
      requireSub();
      requireHuman();
      const cur = ownView(viewId);
      if (expectedVersion !== cur.version) throw new S2ConflictError<SavedView>({ ...cur });
      views.splice(views.indexOf(cur), 1);
    },

    async listFavorites() {
      requireSub();
      return { items: [...favorites] };
    },

    async addFavorite(type, id) {
      requireSub();
      requireHuman();
      const found = favorites.find(f => f.type === type && f.id === id);
      if (found) return found;
      const fav: Favorite = { type, id, title: TITLES[`${type}:${id}`] ?? null, added_at: NOW };
      favorites = [...favorites, fav];
      return fav;
    },

    async removeFavorite(type, id) {
      requireSub();
      requireHuman();
      favorites = favorites.filter(f => !(f.type === type && f.id === id));
    },

    async getSettings() {
      requireSub();
      return settingsBody();
    },

    async patchSettings(req) {
      requireSub();
      requireHuman();
      const bad = validateSettingsPatch(req.patch);
      if (bad.length) throw new S2HttpError(400, { error: 'BAD_PARAMS', detail: `недопустимые ключи: ${bad.join(', ')}` });
      if (req.expected_version !== settingsVersion) throw new S2ConflictError<SettingsResponse>(settingsBody());
      settings = { ...settings, ...req.patch };
      settingsVersion += 1;
      settingsUpdated = NOW;
      return settingsBody();
    },

    async memory() {
      requireMemoryAccess();
      return {
        remembering, retention_days: MEMORY_RETENTION_DAYS, access: 'self_and_own_agents',
        categories: MEMORY_KINDS.map(kind => ({ kind, items: memory.filter(m => m.kind === kind) })),
      };
    },

    async forget(memoryId) {
      requireMemoryAccess();
      if (!memory.some(m => m.memory_id === memoryId)) throw new S2HttpError(404, { error: 'NOT_FOUND', detail: memoryId });
      memory = memory.filter(m => m.memory_id !== memoryId);
    },

    async forgetAll(kind) {
      requireMemoryAccess();
      const before = memory.length;
      memory = kind ? memory.filter(m => m.kind !== kind) : [];
      return { deleted: before - memory.length };
    },

    async setRemembering(req) {
      requireMemoryAccess();
      requireHuman();
      remembering = req.remembering;
      if (!remembering && req.purge) memory = [];
      return { remembering };
    },

    async recent(limit = 20) {
      requireMemoryAccess();
      if (!remembering) return { remembering: false, items: [] };
      const items = memory
        .filter(m => m.kind === 'recent_records')
        .sort((a, b) => b.last_seen.localeCompare(a.last_seen))
        .slice(0, limit)
        .map(m => {
          const [type, ...rest] = m.key.split(':');
          return { type, id: rest.join(':'), title: m.label, last_seen: m.last_seen };
        });
      return { remembering: true, items };
    },

    async recordRecent(type, id) {
      requireMemoryAccess();
      if (!remembering) return { recorded: false, reason: 'not_remembering' };
      const key = `${type}:${id}`;
      const found = memory.find(m => m.kind === 'recent_records' && m.key === key);
      if (found) { found.hits += 1; found.last_seen = NOW; }
      else {
        memory = [...memory, {
          memory_id: `m-${++seq}`, kind: 'recent_records', key, label: TITLES[key] ?? null,
          hits: 1, first_seen: NOW, last_seen: NOW,
        }];
      }
      return { recorded: true };
    },
  };
}
