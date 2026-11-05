import { describe, expect, it } from 'vitest';
import { addableRealmRoles, isRemovableRealmRole, realmRoleRows, visibleRealmRoles, type RealmRole } from './adminRealmRoles';

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

// AH-05 (прототип admin-v2): в карточке realm-роли идут построчно — по строке на
// роль realm, у каждой своё действие: снять / +роль / admin в два шага / замок
// «только консоль KC». Строки обязаны совпадать с прежними правилами
// addableRealmRoles/isRemovableRealmRole — иначе карточка разошлась бы с бэкендом.
describe('realm-роли построчно (карточка человека, AH-05)', () => {
  it('по строке на каждую роль realm, служебные KC скрыты и посчитаны', () => {
    const realm: RealmRole[] = [...REALM, { name: 'offline_access', description: null, grantable: false }];
    const r = realmRoleRows(realm, ['viewer', 'default-roles-omilore']);
    expect(r.rows.map(x => x.name)).toEqual(['super-admin', 'admin', 'full', 'viewer']);
    expect(r.hiddenService).toBe(1);
    expect(r.fallback).toBe(false);
  });

  it('действие строки: есть → снять; admin → в два шага; super-admin → только консоль KC', () => {
    const r = realmRoleRows(REALM, ['viewer', 'super-admin']);
    const act = Object.fromEntries(r.rows.map(x => [x.name, [x.has, x.action]]));
    expect(act).toEqual({
      'super-admin': [true, 'kcOnly'],
      admin: [false, 'addAdmin'],
      full: [false, 'add'],
      viewer: [true, 'remove'],
    });
  });

  it('невыдаваемая роль без super-admin — тоже замок, а не кнопка', () => {
    const r = realmRoleRows([{ name: 'ops', description: null, grantable: false }], []);
    expect(r.rows[0]).toMatchObject({ name: 'ops', has: false, action: 'kcOnly' });
  });

  it('то, что можно выдать построчно, — ровно addableRealmRoles', () => {
    for (const held of [[], ['viewer'], ['admin', 'full'], ['super-admin']]) {
      const r = realmRoleRows(REALM, held);
      expect(r.rows.filter(x => x.action === 'add' || x.action === 'addAdmin').map(x => x.name).sort())
        .toEqual(addableRealmRoles(REALM, held).map(x => x.name).sort());
    }
  });

  it('список realm не загрузился — минимум admin/viewer + флаг «показан не весь realm»; свои роли человека не теряются', () => {
    const r = realmRoleRows(null, ['full']);
    expect(r.fallback).toBe(true);
    expect(r.rows.map(x => x.name)).toEqual(['admin', 'full', 'viewer']);
    expect(r.rows.find(x => x.name === 'full')).toMatchObject({ has: true, action: 'remove' });
  });
});
