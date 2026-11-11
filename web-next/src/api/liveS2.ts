// Боевой клиент личного слоя LORE (SPRINT_UXR_S5_RECORD_TASKS/S5-14).
//
// Поверхность — та же S2Client, против которой написаны экраны (контракт
// SPEC-LORE-UXR-S2-CONTRACTS), поэтому заглушка `createLocalS2Client`
// подменяется этим клиентом без правки экранов. Но подменить её одной строкой
// было нельзя: живой сервер (LoreMeResource, LoreMemoryResource) расходится с
// контрактом v2 не формой, а ИМЕНАМИ И ЗНАЧЕНИЯМИ.
//
//   контракт v2                     сервер (LoreMePrefs.SETTINGS)
//   collapse_nav_on_read            nav_collapse_on_read
//   right_column: auto|open|closed  right_column: auto|shown|hidden
//   text_size: sm|md|lg             text_size: s|m|l|xl
//   mode: dark|light                theme: dark|light|system
//   nav_version: v1|v2              new_navigation: boolean
//
// Сервер проверяет настройки по белому списку и отвергает неизвестный ключ
// (400 BAD_PARAMS) — и правильно делает: свободный мешок ключей превращается в
// свалку, где устройство А видит одно, а Б другое. Поэтому перевод имён и
// значений живёт здесь, в одном месте, а не расползается по экранам.
//
// Честные состояния, которые этот слой обязан сохранить:
//   • 401 на сервере называется NO_IDENTITY — «не смогли понять, кто вы», и
//     путать это с «у вас ничего нет» нельзя: в контракте это
//     UNAUTHENTICATED, а не пустая выдача;
//   • 409 несёт ТЕКУЩЕЕ состояние: без него человек повторит правку вслепую;
//   • значение, которого в v2 нет (theme: system, text_size: xl), не
//     выдумывается и не замалчивается — берётся умолчание v2, а расхождение
//     попадает в `warnings`;
//   • «не запоминаю» (remembering: false) — значение, а не пустой список;
//   • чего в клиенте нет (история, обратные связи), то отказывает громко и
//     называет, куда идти, а не возвращает пустоту.
//
// Глаголы: в /lore нет PUT и DELETE. Правка вида и настроек — POST, удаление
// вида — POST /lore/me/views/delete.
import {
  DEFAULT_SETTINGS,
  type Favorite, type FavoritesResponse, type MemoryItem, type MemoryKind, type MemoryResponse,
  type RecentResponse, type RecordRecentResult, type SavedView, type SavedViewInput,
  type SettingsPatchRequest, type SettingsResponse, type UserSettings,
  type ViewVisibility, type ViewsResponse, type S2ErrorBody, type S2ErrorCode,
} from './contracts/s2';
import { S2ConflictError, S2HttpError, type S2Client } from './contracts/s2.stubs';
import { loreFetch } from '../auth/session';

// ── перевод настроек ────────────────────────────────────────────────────────

/** Имя настройки v2 → имя на сервере. Ключи, которых нет у сервера, здесь не живут. */
const SETTING_KEY: Readonly<Record<keyof UserSettings, string>> = {
  collapse_nav_on_read: 'nav_collapse_on_read',
  right_column: 'right_column',
  text_size: 'text_size',
  palette: 'palette',
  mode: 'theme',
  density: 'density',
  single_key_shortcuts: 'single_key_shortcuts',
  stripes: 'stripes',
  peek_hover: 'peek_hover',
  graph_view: 'graph_view',
  nav_version: 'new_navigation',
  show_tech: 'show_tech',
};

/** Значения перечислений: v2 → сервер. Обратный перевод строится из этих же таблиц. */
const SETTING_VALUE: Readonly<Partial<Record<keyof UserSettings, Readonly<Record<string, string | boolean>>>>> = {
  right_column: { auto: 'auto', open: 'shown', closed: 'hidden' },
  text_size: { sm: 's', md: 'm', lg: 'l' },
  mode: { dark: 'dark', light: 'light' },
  nav_version: { v1: false, v2: true },
};

const V2_KEY_OF: Readonly<Record<string, keyof UserSettings>> = Object.fromEntries(
  Object.entries(SETTING_KEY).map(([v2, srv]) => [srv, v2 as keyof UserSettings]),
) as Record<string, keyof UserSettings>;

/** Значение настройки v2 → то, что примет сервер. */
function toServerValue(key: keyof UserSettings, value: unknown): string | boolean | number | null {
  const table = SETTING_VALUE[key];
  if (table) {
    const mapped = table[String(value)];
    // Значения нет в таблице — отдаём как есть: пусть сервер ответит 400 с
    // именем настройки, а не мы молча подставим «что-нибудь похожее».
    return mapped === undefined ? (value as string) : mapped;
  }
  return value as string | boolean;
}

/**
 * Значение сервера → значение v2. `undefined` — такого значения в v2 нет;
 * вызывающий подставляет умолчание и пишет предупреждение.
 */
function toV2Value(key: keyof UserSettings, value: unknown): unknown {
  const table = SETTING_VALUE[key];
  if (!table) return value;
  for (const [v2, srv] of Object.entries(table)) if (srv === value) return v2;
  return undefined;
}

export interface SettingsTranslation { settings: UserSettings; warnings: string[] }

/** Настройки сервера → UserSettings. Незнакомое значение не выдумывается. */
export function settingsFromServer(raw: unknown): SettingsTranslation {
  const out: UserSettings = { ...DEFAULT_SETTINGS };
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') return { settings: out, warnings };
  for (const [srvKey, srvValue] of Object.entries(raw as Record<string, unknown>)) {
    const key = V2_KEY_OF[srvKey];
    if (!key) continue; // настройка, о которой v2 не знает: не наша забота
    const value = toV2Value(key, srvValue);
    if (value === undefined) {
      warnings.push(`${srvKey}: сервер хранит «${String(srvValue)}», такого значения в v2 нет — показано умолчание`);
      continue;
    }
    (out as unknown as Record<string, unknown>)[key] = value;
  }
  return { settings: out, warnings };
}

/** Патч v2 → тело POST /lore/me/settings. */
export function patchToServer(patch: Partial<UserSettings>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const key = k as keyof UserSettings;
    const srvKey = SETTING_KEY[key];
    if (!srvKey) continue;
    body[srvKey] = toServerValue(key, v);
  }
  return body;
}

// ── разбор ответов ──────────────────────────────────────────────────────────

const ERROR_CODE: Readonly<Record<string, S2ErrorCode>> = {
  // «Не смогли понять, кто вы» — не «у вас ничего нет».
  NO_IDENTITY: 'UNAUTHENTICATED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  BAD_PARAMS: 'BAD_PARAMS',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  FORBIDDEN: 'FORBIDDEN',
  NOT_OWNER: 'FORBIDDEN',
  TEAM_VIEW_FORBIDDEN: 'FORBIDDEN',
  AGENT_SCOPE_FORBIDDEN: 'AGENT_SCOPE_FORBIDDEN',
  LORE_DISABLED: 'LORE_DISABLED',
  SCOPE_EMPTY: 'FORBIDDEN',
  OUTSIDE_SCOPE: 'FORBIDDEN',
};

interface Json { [k: string]: unknown }

async function readJson(res: Response): Promise<Json | null> {
  try {
    const v = (await res.json()) as unknown;
    return v && typeof v === 'object' ? (v as Json) : null;
  } catch {
    return null;
  }
}

/**
 * Ошибка с кодом и причиной сервера; не-JSON тело тоже остаётся ошибкой, а не
 * «пусто».
 *
 * `translate` переводит «current» из 409 в форму контракта. Без него наружу
 * уходила бы серверная форма (`{ok, settings, stored, schema…}`) под видом
 * контрактной: экран прочитал бы `current.settings.mode`, не нашёл его, и
 * повтор правки после 409 пошёл бы по пустому значению.
 */
function fail(res: Response, body: Json | null, translate?: (current: unknown) => unknown): never {
  const rawCode = typeof body?.error === 'string' ? body.error : '';
  const code = ERROR_CODE[rawCode] ?? (res.status === 401 ? 'UNAUTHENTICATED' : 'BAD_PARAMS');
  const detail = typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`;
  const err: S2ErrorBody = { error: code, detail };
  if (body && 'current' in body) err.current = body.current;
  if (res.status === 409) {
    const current = body?.current ?? null;
    throw new S2ConflictError(translate && current ? translate(current) : current);
  }
  throw new S2HttpError(res.status, err);
}

export interface LiveS2Options {
  /** Подмена сети (тесты); по умолчанию — fetch с токеном сеанса. */
  fetchImpl?: typeof fetch;
  /** Префикс API; по умолчанию относительный, как у остальных вызовов v2. */
  base?: string;
}

export function createLiveS2Client(opts: LiveS2Options = {}): S2Client {
  const http = opts.fetchImpl ?? loreFetch;
  const base = opts.base ?? '';

  type Translate = (current: unknown) => unknown;
  const get = async (path: string, translate?: Translate): Promise<Json> => {
    const res = await http(`${base}${path}`);
    const body = await readJson(res);
    if (!res.ok) fail(res, body, translate);
    return body ?? {};
  };
  const post = async (path: string, payload: unknown, translate?: Translate): Promise<Json> => {
    const res = await http(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await readJson(res);
    if (!res.ok) fail(res, body, translate);
    return body ?? {};
  };

  const settingsBody = (raw: Json): SettingsResponse => {
    const eff = settingsFromServer(raw.settings);
    const schema = raw.schema && typeof raw.schema === 'object' ? (raw.schema as Json) : {};
    const srvDefaults: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(schema)) {
      if (spec && typeof spec === 'object' && 'default' in (spec as Json)) srvDefaults[k] = (spec as Json).default;
    }
    const defaults = settingsFromServer(srvDefaults);
    return {
      settings: eff.settings,
      defaults: Object.keys(srvDefaults).length ? defaults.settings : { ...DEFAULT_SETTINGS },
      version: typeof raw.version === 'number' ? raw.version : 0,
      updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : null,
      // Предупреждения — только о действующих значениях: умолчания сервера
      // человек не выбирал, и говорить о них ему нечего.
      warnings: eff.warnings,
    };
  };

  const visibilityOf = (raw: Json): ViewVisibility => {
    const kind = String(raw.visibility ?? 'me');
    if (kind === 'all') return { kind: 'all' };
    if (kind === 'roles') {
      const roles = Array.isArray(raw.roles) ? raw.roles.map(String) : [];
      return { kind: 'roles', roles };
    }
    return { kind: 'me' };
  };

  const viewOf = (raw: Json): SavedView => ({
    view_id: String(raw.view_uid ?? ''),
    name: String(raw.name ?? ''),
    section: String(raw.section ?? ''),
    query: String(raw.query ?? ''),
    visibility: visibilityOf(raw),
    // kc_sub владельца сервер НЕ отдаёт — только «мой / не мой»
    // (LoreMeResource.viewOut). Поэтому `own` отдаётся как есть, а `owner`
    // остаётся null: придумывать чужой идентификатор нельзя.
    owner: null,
    own: raw.own === true,
    is_team_default: raw.is_team_default === true,
    is_personal_default: raw.is_personal_default === true,
    order: 0,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
    version: typeof raw.version === 'number' ? raw.version : 0,
  });

  const viewBody = (input: Partial<SavedViewInput> & { view_uid?: string; expected_version?: number }) => {
    const body: Record<string, unknown> = {};
    if (input.view_uid) body.view_uid = input.view_uid;
    if (input.name !== undefined) body.name = input.name;
    if (input.section !== undefined) body.section = input.section;
    if (input.query !== undefined) body.query = input.query;
    if (input.visibility !== undefined) {
      body.visibility = input.visibility.kind;
      body.roles = input.visibility.kind === 'roles' ? input.visibility.roles : [];
    }
    if (input.is_team_default !== undefined) body.is_team_default = input.is_team_default;
    if (input.expected_version !== undefined) body.expected_version = input.expected_version;
    return body;
  };

  const refOf = (raw: Json, at: string): { type: string; id: string; title: null } & Record<string, unknown> => ({
    type: String(raw.ref_type ?? ''),
    id: String(raw.ref_id ?? ''),
    // Названий сервер в этих ответах не даёт; «null» — «названия не знаем»,
    // а не «названия нет».
    title: null,
    [at]: raw[at] ?? null,
  });

  const memoryItemOf = (raw: Json, kind: MemoryKind): MemoryItem => ({
    memory_id: String(raw.memory_id ?? ''),
    kind,
    key: String(raw.key ?? ''),
    label: typeof raw.label === 'string' ? raw.label : null,
    hits: typeof raw.hits === 'number' ? raw.hits : 0,
    first_seen: String(raw.first_seen ?? ''),
    last_seen: String(raw.last_seen ?? ''),
  });

  return {
    async backlinks() {
      // У графа паспорта свой живой путь (record/backlinksGraph.ts): он ходит
      // на /lore/backlinks сам и разбирает ответ сервера (edge/count/ref_id),
      // который не совпадает с формой контракта. Дублировать разбор здесь
      // значило бы иметь две правды; пустой ответ вместо данных — хуже отказа.
      throw new Error('backlinks: боевой разбор живёт в record/backlinksGraph.ts — этот клиент его не дублирует');
    },

    async history() {
      // GET /lore/history есть, но отдаёт {type, id, rows, attribution} —
      // другую форму, чем HistoryResponse контракта (versions/tracking/
      // anomalies/page). Пока перевод не написан, честный отказ лучше пустой
      // истории: «истории нет» и «не умеем читать» — разные вещи.
      throw new Error('history: форма GET /lore/history не совпадает с контрактом S2 — перевод не написан');
    },

    async listViews(section) {
      const q = section ? `?section=${encodeURIComponent(section)}` : '';
      const body = await get(`/lore/me/views${q}`);
      const items = Array.isArray(body.views) ? body.views.map(v => viewOf(v as Json)) : [];
      const defaults = body.defaults && typeof body.defaults === 'object' ? (body.defaults as Json) : {};
      const effective_default: Record<string, string | null> = {};
      for (const [sec, uid] of Object.entries(defaults)) effective_default[sec] = typeof uid === 'string' ? uid : null;
      return { items, effective_default } satisfies ViewsResponse;
    },

    async createView(input) {
      const body = await post('/lore/me/views', viewBody(input));
      return viewOf((body.view ?? {}) as Json);
    },

    async updateView(viewId, patch) {
      const body = await post(
        '/lore/me/views',
        viewBody({ ...patch, view_uid: viewId }),
        current => viewOf(current as Json),
      );
      return viewOf((body.view ?? {}) as Json);
    },

    async deleteView(viewId, expectedVersion) {
      await post('/lore/me/views/delete', { view_uid: viewId, expected_version: expectedVersion });
    },

    async listFavorites() {
      const body = await get('/lore/me/favorites');
      const items = (Array.isArray(body.favorites) ? body.favorites : [])
        .map(f => refOf(f as Json, 'added_at') as unknown as Favorite);
      return { items } satisfies FavoritesResponse;
    },

    async addFavorite(type, id) {
      await post('/lore/me/favorites', { ref_type: type, ref_id: id, action: 'add' });
      return { type, id, title: null, added_at: new Date().toISOString() };
    },

    async removeFavorite(type, id) {
      await post('/lore/me/favorites', { ref_type: type, ref_id: id, action: 'remove' });
    },

    async getSettings() {
      return settingsBody(await get('/lore/me/settings'));
    },

    async patchSettings(req: SettingsPatchRequest) {
      const settings = patchToServer(req.patch);
      // Пустой патч на сервер не идёт: нечего сохранять — незачем спрашивать.
      // Но ответ вернуть надо, и он должен быть настоящим, а не придуманным.
      if (Object.keys(settings).length === 0) return settingsBody(await get('/lore/me/settings'));
      return settingsBody(await post(
        '/lore/me/settings',
        { settings, expected_version: req.expected_version },
        current => settingsBody(current as Json),
      ));
    },

    async memory() {
      const body = await get('/lore/me/memory');
      const categories = (Array.isArray(body.categories) ? body.categories : []).map(c => {
        const row = c as Json;
        const kind = String(row.kind ?? '') as MemoryKind;
        const items = (Array.isArray(row.items) ? row.items : []).map(i => memoryItemOf(i as Json, kind));
        return { kind, items };
      });
      return {
        // «Не запоминаю» — значение, а не пустой список.
        remembering: body.remembering === true,
        retention_days: typeof body.retention_days === 'number' ? body.retention_days : 0,
        categories,
        access: 'self_and_own_agents',
      } satisfies MemoryResponse;
    },

    async forget(memoryId) {
      await post('/lore/me/memory/delete', { memory_id: memoryId });
    },

    async forgetAll(kind) {
      const body = await post('/lore/me/memory/delete', kind ? { kind } : {});
      // Сколько стёрли — по ответу сервера, а не по нашим ожиданиям.
      const erased = body.erased && typeof body.erased === 'object' ? (body.erased as Json) : {};
      const deleted = Object.values(erased).reduce<number>((n, v) => n + (typeof v === 'number' ? v : 0), 0);
      return { deleted };
    },

    async setRemembering(req) {
      const body = await post('/lore/me/memory/remembering', { remembering: req.remembering });
      // Ответ сервера главнее запроса: он мог отказать или уже быть таким.
      return { remembering: body.remembering === true };
    },

    async recent(limit) {
      const q = limit === undefined ? '' : `?limit=${limit}`;
      const body = await get(`/lore/me/recent${q}`);
      const items = (Array.isArray(body.recent) ? body.recent : []).map(r => {
        const row = r as Json;
        return {
          type: String(row.ref_type ?? ''),
          id: String(row.ref_id ?? ''),
          title: null,
          last_seen: String(row.visited_at ?? ''),
        };
      });
      return { remembering: body.remembering === true, items } satisfies RecentResponse;
    },

    async recordRecent(type, id) {
      const body = await post('/lore/me/recent', { ref_type: type, ref_id: id });
      if (body.recorded === true) return { recorded: true } satisfies RecordRecentResult;
      return { recorded: false, reason: 'not_remembering' } satisfies RecordRecentResult;
    },
  };
}
