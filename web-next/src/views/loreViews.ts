// Виды списков LORE v2 на заглушке по контракту S2
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-08; сервер — SPRINT_UXR_S2_GRAPH_MEMORY/S2-04,
// D-2026-UXR-VIEWS-SERVER).
//
// Контракт (форма — KitSavedListView из @seidr/kit):
//   GET    /lore/views?section={section} → KitSavedListView[] (командные + свои + общие)
//   POST   /lore/views          body KitViewDraft  → KitSavedListView (owner = kc_sub из токена)
//   PATCH  /lore/views/{id}     body KitViewPatch  → KitSavedListView (403 — не владелец/командный)
//   DELETE /lore/views/{id}                        → 204 (403 / 404)
// Вид = строка запроса состояния списка (lv/lq/lg/ls/lf) + имя + раздел + видимость.
//
// Пока сервера нет — заглушка kit (createMemoryViewStore) с теми же формами и
// кодами отказов; личные виды кэшируются в lore.v2.views (только как кэш —
// «только в браузере» решением отклонено). Замена на HTTP-клиент — одна
// функция, экран не меняется.
import { DEFAULT_LIST_STATE, createMemoryViewStore, listStateToQuery } from '@seidr/kit';
import type { KitLang, KitSavedListView, KitViewStore, ListState } from '@seidr/kit';
import { appT } from '../i18n';
import { storage as safeStorage } from '../storage/safe';
import { v2Key } from '../storage/storage';

// MINI-03: адреса — серверные (LoreMeResource), один контракт с мобилкой; HTTP-клиент — loreViewsApi.ts.
export const LORE_VIEWS_API = {
  list: 'GET /lore/me/views?section={section}',
  create: 'POST /lore/me/views',
  update: 'POST /lore/me/views (view_uid + expected_version)',
  remove: 'POST /lore/me/views/delete',
} as const;

/** Разделы v2 с видами (MVP D-2026-UXR-MVP: сначала спринты и ADR). */
export const LORE_VIEW_SECTIONS = ['sprints', 'adrs', 'specs'] as const;
export type LoreViewSection = (typeof LORE_VIEW_SECTIONS)[number];

const q = (p: Partial<ListState>) => listStateToQuery({ ...DEFAULT_LIST_STATE, ...p });

/**
 * Командные виды по умолчанию — то, что вернёт сервер для разделов, пока у
 * пользователя нет своих (новичок не видит пустоту). Ключи фильтров и
 * «Быстро» — из конфигов экранов списков (S4-04): status, quick active/proposed.
 */
export function loreTeamViews(lang: KitLang): KitSavedListView[] {
  const team = (id: string, section: LoreViewSection, nameKey: Parameters<typeof appT>[1], query: string, isDefault = false): KitSavedListView =>
    ({ id, section, name: appT(lang, nameKey), query, owner: null, visibility: 'all', team_default: isDefault });
  return [
    team('team-sprints-by-status', 'sprints', 'views.team.sprintsByStatus', q({ group: 'status', sort: { key: 'updated_at', dir: 'desc' } }), true),
    team('team-sprints-active', 'sprints', 'views.team.sprintsActive', q({ quick: 'active', sort: { key: 'updated_at', dir: 'desc' } })),
    team('team-adrs-by-status', 'adrs', 'views.team.adrsByStatus', q({ group: 'status', sort: { key: 'updated_at', dir: 'desc' } }), true),
    team('team-adrs-proposed', 'adrs', 'views.team.adrsProposed', q({ quick: 'proposed', sort: { key: 'updated_at', dir: 'desc' } })),
    team('team-specs-by-status', 'specs', 'views.team.specsByStatus', q({ group: 'status', sort: { key: 'updated_at', dir: 'desc' } }), true),
  ];
}

export interface LoreViewStubOptions {
  /** kc_sub пользователя (из сессии OIDC); без входа — 'anonymous'. */
  user: string;
  lang: KitLang;
  /** Кэш браузера; по умолчанию — хранилище v2 с откатом в память (S4-00f). */
  storage?: { get(key: string): string | null; set(key: string, value: string): void };
}

/** Хранилище видов LORE до готовности S2-04: заглушка по контракту S2. */
export function createLoreViewStub({ user, lang, storage = safeStorage }: LoreViewStubOptions): KitViewStore {
  return createMemoryViewStore({ user, teamViews: loreTeamViews(lang), persist: storage, key: v2Key('views') });
}
