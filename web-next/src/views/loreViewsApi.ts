// Виды списков LORE v2 — HTTP-клиент по контракту сервера
// (SPRINT_LORE_PRODUCT_BACKLOG/MINI-03-ME-VIEWS-CONTRACT; сервер — LoreMeResource, SPRINT_UXR_S2_GRAPH_MEMORY/S2-04).
//
// Один контракт для веба и мобилки (miniLORE повторяет его один в один):
//   GET  /lore/me/views?section={section} → {ok, views:[ViewRow], count, defaults:{section: view_uid}}
//   POST /lore/me/views  {name, section, query, visibility, roles?, is_personal_default?}        — создать
//   POST /lore/me/views  {view_uid, expected_version, name?, query?, visibility?, roles?, …}     — править
//   POST /lore/me/views/delete {view_uid, expected_version?}                                     — удалить
// ViewRow: {view_uid, name, section, query, visibility: me|all|roles, roles[], is_team_default,
//           is_personal_default, own, version, created_at, updated_at}.
// query — строка состояния списка kit (ключи lv, lq, lg, ls, lf). Разделы — sprints, adrs, specs.
// Отказы: 401 NO_IDENTITY, 403 NOT_OWNER / TEAM_VIEW_FORBIDDEN, 404 TARGET_NOT_FOUND, 409 CONFLICT (версия).
//
// Честные состояния: отказ — исключение со status (как у заглушки kit), а не пустой список;
// экран различает «нет прав» и «сбой» по status.
import type { KitSavedListView, KitViewDraft, KitViewPatch, KitViewStore, KitViewVisibility } from '@seidr/kit';
import { loreFetch } from '../auth/session';

export const LORE_VIEWS_HTTP = {
  list: 'GET /lore/me/views?section={section}',
  create: 'POST /lore/me/views',
  update: 'POST /lore/me/views (view_uid + expected_version)',
  remove: 'POST /lore/me/views/delete',
} as const;

interface ViewRow {
  view_uid?: unknown; name?: unknown; section?: unknown; query?: unknown; visibility?: unknown; roles?: unknown;
  is_team_default?: unknown; is_personal_default?: unknown; own?: unknown; version?: unknown; updated_at?: unknown;
}

interface StoreError extends Error { status: number; code?: string }

function fail(status: number, b: Record<string, unknown>): never {
  const code = typeof b.error === 'string' ? b.error : `HTTP ${status}`;
  const detail = typeof b.detail === 'string' ? b.detail : (typeof b.reason === 'string' ? b.reason : '');
  throw Object.assign(new Error(detail ? `${code}: ${detail}` : code), { status, code }) as StoreError;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  try {
    const v = (await res.json()) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function visibilityOf(r: ViewRow): KitViewVisibility {
  if (r.visibility === 'roles') return { roles: Array.isArray(r.roles) ? r.roles.map(String) : [] };
  return r.visibility === 'all' ? 'all' : 'me';
}

function wireVisibility(v: KitViewVisibility | undefined): { visibility?: string; roles?: string[] } {
  if (v === undefined) return {};
  if (typeof v === 'object') return { visibility: 'roles', roles: v.roles };
  return { visibility: v, roles: [] };
}

export interface LoreViewApiOptions {
  /** kc_sub вызывающего: сервер отдаёт только «мой / не мой», владельца-человека не раскрывает. */
  user: string;
  fetchImpl?: typeof fetch;
}

/** Хранилище видов по серверу: та же форма KitViewStore, что у заглушки — экран не меняется. */
export function createLoreViewApi({ user, fetchImpl = loreFetch }: LoreViewApiOptions): KitViewStore {
  // Версия вида из последнего чтения — для оптимистичной блокировки правки и удаления (S2-09).
  const versions = new Map<string, number>();

  const toView = (r: ViewRow): KitSavedListView => {
    const id = String(r.view_uid ?? '');
    if (typeof r.version === 'number') versions.set(id, r.version);
    const team = r.is_team_default === true;
    const own = r.own === true;
    return {
      id,
      name: String(r.name ?? ''),
      section: String(r.section ?? ''),
      query: typeof r.query === 'string' ? r.query : '',
      visibility: visibilityOf(r),
      // Свой — kc_sub вызывающего; командный — null (контракт kit); чужой — непрозрачная метка, не человек.
      owner: own ? user : team ? null : 'other',
      team_default: team,
      personal_default: r.is_personal_default === true,
      ...(typeof r.updated_at === 'string' ? { updated_at: r.updated_at } : {}),
    };
  };

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetchImpl(path, init);
    const b = await json(res);
    if (!res.ok) fail(res.status, b);
    return b;
  };
  const post = (path: string, payload: unknown) => call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const one = (b: Record<string, unknown>): KitSavedListView => {
    const v = b.view;
    if (!v || typeof v !== 'object') fail(502, { error: 'BAD_RESPONSE', detail: 'сервер не вернул вид' });
    return toView(v as ViewRow);
  };

  return {
    async list(section: string) {
      const b = await call(`/lore/me/views?section=${encodeURIComponent(section)}`);
      return (Array.isArray(b.views) ? b.views : []).map(r => toView(r as ViewRow));
    },
    async create(draft: KitViewDraft) {
      return one(await post('/lore/me/views', {
        name: draft.name, section: draft.section, query: draft.query, ...wireVisibility(draft.visibility),
        ...(draft.personal_default === undefined ? {} : { is_personal_default: draft.personal_default }),
      }));
    },
    async update(id: string, patch: KitViewPatch) {
      const v = versions.get(id);
      return one(await post('/lore/me/views', {
        view_uid: id,
        ...(v === undefined ? {} : { expected_version: v }),
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.query === undefined ? {} : { query: patch.query }),
        ...wireVisibility(patch.visibility),
        ...(patch.personal_default === undefined ? {} : { is_personal_default: patch.personal_default }),
      }));
    },
    async remove(id: string) {
      const v = versions.get(id);
      await post('/lore/me/views/delete', { view_uid: id, ...(v === undefined ? {} : { expected_version: v }) });
      versions.delete(id);
    },
  };
}
