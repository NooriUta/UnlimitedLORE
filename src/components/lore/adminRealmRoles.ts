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
