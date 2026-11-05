// Realm-роли Keycloak в карточке человека. Вынесено из LoreAdminPanel.tsx ради
// теста (adminRealmRoles.test.ts). Правило: видно и выдаётся то, что есть в
// realm, а не зашитый в код список. Исключения два, и оба — на бэкенде тоже
// (KcBridge.isGrantableRealmRole): служебные роли Keycloak (не права LORE) и
// super-admin (D11 — виден, но выдаётся только в консоли KC).

export interface RealmRole { name: string; description: string | null; grantable: boolean }

const ADMIN_FIRST = ['super-admin', 'admin'];

// Запасной минимум, если /lore/kc/realm-roles не ответил (старый бэкенд, сбой KC):
// ровно то, что карточка умела до 04.11.2026, — не меньше.
const FALLBACK: RealmRole[] = [
  { name: 'admin', description: null, grantable: true },
  { name: 'viewer', description: null, grantable: true },
];

export function isKeycloakServiceRole(name: string): boolean {
  return name.startsWith('default-roles-') || name === 'offline_access' || name === 'uma_authorization';
}

export function visibleRealmRoles(held: string[] | null | undefined): string[] {
  const rank = (r: string) => { const i = ADMIN_FIRST.indexOf(r); return i < 0 ? ADMIN_FIRST.length : i; };
  return (held ?? []).filter(r => !isKeycloakServiceRole(r))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function addableRealmRoles(realm: RealmRole[] | null, held: string[] | null | undefined): RealmRole[] {
  const have = new Set(held ?? []);
  return (realm ?? FALLBACK).filter(r => r.grantable && r.name !== 'super-admin' && !have.has(r.name));
}

export function isRemovableRealmRole(name: string): boolean {
  return name !== 'super-admin';
}

export function isAdminRealmRole(name: string): boolean {
  return ADMIN_FIRST.includes(name);
}

// AH-05 (прототип admin-v2): карточка человека показывает realm-роли ПОСТРОЧНО —
// строка на каждую роль realm (а не только на выданные), у строки одно действие.
// Действия выводятся из тех же правил, что addableRealmRoles/isRemovableRealmRole:
// построчный вид не имеет права разойтись с тем, что примет бэкенд.
export type RealmRoleAction = 'remove' | 'add' | 'addAdmin' | 'kcOnly';
export interface RealmRoleRow { name: string; description: string | null; has: boolean; action: RealmRoleAction }

export function realmRoleRows(realm: RealmRole[] | null, held: string[] | null | undefined): {
  rows: RealmRoleRow[]; fallback: boolean; hiddenService: number;
} {
  const src = realm ?? FALLBACK;
  const have = new Set(held ?? []);
  const byName = new Map(src.filter(r => !isKeycloakServiceRole(r.name)).map(r => [r.name, r]));
  // Роль человека, которой нет в списке realm (запасной минимум, рассинхрон KC), не прячем.
  for (const h of visibleRealmRoles(held)) if (!byName.has(h)) byName.set(h, { name: h, description: null, grantable: false });
  const addable = new Set(addableRealmRoles(realm, held).map(r => r.name));
  const rows = visibleRealmRoles([...byName.keys()]).map(name => {
    const r = byName.get(name)!;
    const has = have.has(name);
    const action: RealmRoleAction = has
      ? (isRemovableRealmRole(name) ? 'remove' : 'kcOnly')
      : addable.has(name) ? (name === 'admin' ? 'addAdmin' : 'add') : 'kcOnly';
    return { name, description: r.description, has, action };
  });
  return { rows, fallback: realm === null, hiddenService: src.filter(r => isKeycloakServiceRole(r.name)).length };
}
