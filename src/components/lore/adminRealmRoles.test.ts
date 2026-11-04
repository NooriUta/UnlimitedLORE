import { describe, expect, it } from 'vitest';
import { addableRealmRoles, isRemovableRealmRole, visibleRealmRoles, type RealmRole } from './adminRealmRoles';

// Регресс 04.11.2026 (владелец: «в админке есть роли по проектам, а есть полные
// роли, и через админку они не выдаются»). Карточка показывала только
// admin/super-admin/viewer, а выдавала только viewer/admin: роль, заведённая в
// realm руками, была невидима и невыдаваема. Правило: видно и выдаётся всё,
// что есть в realm, кроме служебных ролей KC; super-admin виден, но не выдаётся.
const REALM: RealmRole[] = [
  { name: 'admin', description: null, grantable: true },
  { name: 'super-admin', description: null, grantable: false },
  { name: 'viewer', description: null, grantable: true },
  { name: 'full', description: 'полный доступ', grantable: true },
];

describe('realm-роли в карточке человека', () => {
  it('видны все роли человека, кроме служебных ролей Keycloak', () => {
    expect(visibleRealmRoles(['default-roles-omilore', 'offline_access', 'uma_authorization', 'full', 'viewer']))
      .toEqual(['full', 'viewer']);
  });

  it('админские роли идут первыми, остальные — по алфавиту', () => {
    expect(visibleRealmRoles(['viewer', 'full', 'admin', 'super-admin'])).toEqual(['super-admin', 'admin', 'full', 'viewer']);
  });

  it('выдать можно любую выдаваемую роль realm, которой у человека ещё нет', () => {
    expect(addableRealmRoles(REALM, ['viewer']).map(r => r.name)).toEqual(['admin', 'full']);
  });

  it('super-admin не предлагается к выдаче, даже если его нет', () => {
    expect(addableRealmRoles(REALM, []).map(r => r.name)).not.toContain('super-admin');
  });

  it('список ролей realm не загрузился — остаётся прежний минимум admin/viewer', () => {
    expect(addableRealmRoles(null, []).map(r => r.name)).toEqual(['admin', 'viewer']);
  });

  it('снять можно всё, кроме super-admin', () => {
    expect(isRemovableRealmRole('full')).toBe(true);
    expect(isRemovableRealmRole('admin')).toBe(true);
    expect(isRemovableRealmRole('super-admin')).toBe(false);
  });
});
