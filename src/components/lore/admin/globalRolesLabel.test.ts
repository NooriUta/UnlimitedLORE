// Владелица не нашла, где выдаются глобальные роли KC: блок карточки человека
// назывался «Realm-роли · все роли realm», а слово realm ей ни о чём не говорит.
// Решение 05.11: блок зовётся «Глобальные роли» — в пару к ролям по проектам —
// и под заголовком строка, что они действуют во всех проектах.
import { describe, it, expect } from 'vitest';
import ru from '../../../i18n/locales/ru/common.json';
import en from '../../../i18n/locales/en/common.json';

const USERS_SRC = import.meta.glob('./UsersTab.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const admin = (l: unknown) => (l as { lore: { admin: Record<string, string> } }).lore.admin;

describe('Карточка человека: глобальные роли KC названы понятно', () => {
  it('заголовок блока — «Глобальные роли», без слова realm', () => {
    expect(admin(ru).realmRolesH).toBe('Глобальные роли');
    expect(admin(en).realmRolesH).toBe('Global roles');
  });

  it('под заголовком есть пояснение «во всех проектах» в обеих локалях', () => {
    expect(admin(ru).realmRolesHint).toMatch(/во всех проектах/);
    expect(admin(en).realmRolesHint).toMatch(/all projects/);
  });

  it('карточка выводит пояснение', () => {
    const src = USERS_SRC['./UsersTab.tsx'];
    expect(src).toContain("t('lore.admin.realmRolesHint'");
  });
});
