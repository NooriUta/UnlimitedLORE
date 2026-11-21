// @vitest-environment jsdom
// Владелица 21.11.2026 (канал): «админка — кнопка внутри карточки настроек клиента, а кнопка в меню со странной
// страницей; админку пересадить на иконку настройки и показывать только логинам с admin, superadmin» · «не в шапке
// а в левом меню» · «у тебя есть шестерёнка в конце». Вход в админку — пункт левого меню в группе «Личное» сразу
// после «Настроек», только для admin/superadmin; ссылки в меню аватара больше нет.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADMIN_ENTRY, canSeeAdmin, v2Config } from './v2Config';

const personal = (canAdmin: boolean) =>
  v2Config('ru', undefined, undefined, undefined, canAdmin).menu.groups.find(g => g.id === 'personal')!.items.map(i => i.id);

describe('вход в админку — пункт левого меню после «Настроек», только admin и superadmin', () => {
  it('может — «Админка» сразу после «Настроек»', () => {
    expect(personal(true)).toEqual(['settings', ADMIN_ENTRY]);
  });
  it('не может — пункта нет', () => {
    expect(personal(false)).toEqual(['settings']);
  });
  it('внутри админки меню своё — пункт не добавляется', () => {
    const groups = v2Config('ru', undefined, 'admin', undefined, true).menu.groups;
    expect(groups.flatMap(g => g.items.map(i => i.id))).not.toContain(ADMIN_ENTRY);
  });
  it.each([
    [{ auth_enabled: true, seer_role: 'admin' }, true],
    [{ auth_enabled: true, seer_role: 'superadmin' }, true],
    [{ auth_enabled: true, seer_role: 'viewer' }, false],
    [{ auth_enabled: true, seer_role: null }, false],
    [{ auth_enabled: false }, true],
    [null, false],
  ] as const)('кто я %j → %s', (b, want) => {
    expect(canSeeAdmin(b)).toBe(want);
  });
  it('в меню аватара ссылки «Админка» больше нет', () => {
    const src = readFileSync(`${process.cwd()}/src/settings/AccountMenu.tsx`, 'utf8');
    expect(src).not.toMatch(/data-testid="account-admin"/);
  });
});
