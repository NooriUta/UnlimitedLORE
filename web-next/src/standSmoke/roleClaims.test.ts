// AP-02 (20.11.2026): на препроде test-admin и test-viewer опознаются как superadmin. Бэкенд берёт роль из
// claim seer_roles (SeerRoleFromTokenFilter). Чтобы разобрать причину без входа в админку Keycloak, RB-0x
// показывает роли из своего токена — только роли, без самого токена.
import { describe, expect, it } from 'vitest';
import { roleClaimsOf } from './roleClaims';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: unknown) => `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;

describe('roleClaimsOf — роли из токена, без секрета', () => {
  it('seer_roles, realm_access.roles и groups', () => {
    expect(roleClaimsOf(jwt({ seer_roles: ['admin', 'super-admin'], realm_access: { roles: ['default-roles-x', 'admin'] }, groups: ['/ops'] })))
      .toEqual({ seer_roles: ['admin', 'super-admin'], realm_roles: ['default-roles-x', 'admin'], groups: ['/ops'] });
  });
  it('нет полей — пустые списки; не JWT — null', () => {
    expect(roleClaimsOf(jwt({ sub: 'x' }))).toEqual({ seer_roles: [], realm_roles: [], groups: [] });
    expect(roleClaimsOf('не-токен')).toBeNull();
    expect(roleClaimsOf(null)).toBeNull();
  });
  it('в ответе нет ничего, кроме ролей и групп', () => {
    const r = roleClaimsOf(jwt({ seer_roles: ['viewer'], sub: 'secret-sub', email: 'a@b' }))!;
    expect(Object.keys(r).sort()).toEqual(['groups', 'realm_roles', 'seer_roles']);
  });
});
