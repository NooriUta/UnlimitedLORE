// K-14 (SPRINT_UXR_S7B_ADMIN/S7B-23_2): строки kit — нейтральные, словарь приложения
// (у LORE: «спринт», «агент», «Keycloak») подставляется снаружи через setKitStrings.
import { afterEach, describe, expect, it } from 'vitest';
import { kitT, kitPlural, setKitStrings, resetKitStrings } from './index';

afterEach(() => resetKitStrings());

describe('setKitStrings — словарь приложения поверх строк kit', () => {
  it('без словаря приложения — нейтральная строка kit', () => {
    expect(kitT('ru', 'kit.auth.loggedOut')).not.toMatch(/LORE/);
  });
  it('переопределение действует для своего языка и только для него', () => {
    setKitStrings('ru', { 'kit.auth.loggedOut': 'Вы вышли из Приложения.' });
    expect(kitT('ru', 'kit.auth.loggedOut')).toBe('Вы вышли из Приложения.');
    expect(kitT('en', 'kit.auth.loggedOut')).not.toBe('Вы вышли из Приложения.');
  });
  it('подстановки {name} работают и в переопределённой строке', () => {
    setKitStrings('ru', { 'kit.record.history.partialRows': '{shown} из {total}' });
    expect(kitT('ru', 'kit.record.history.partialRows', { shown: 2, total: 5 })).toBe('2 из 5');
  });
  it('числовые формы берут переопределение', () => {
    setKitStrings('ru', { 'kit.list.chipsMore.one': 'ещё {n} штука' });
    expect(kitPlural('ru', 'kit.list.chipsMore', 1)).toBe('ещё 1 штука');
  });
  it('лишний ключ — отказ словами (опечатка не проходит молча)', () => {
    expect(() => setKitStrings('ru', { 'kit.nope': 'x' } as never)).toThrow(/kit\.nope/);
  });
  it('resetKitStrings возвращает строки kit', () => {
    setKitStrings('ru', { 'kit.auth.loggedOut': 'X' });
    resetKitStrings();
    expect(kitT('ru', 'kit.auth.loggedOut')).not.toBe('X');
  });
});
