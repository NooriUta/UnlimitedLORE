// Чтение access_token из сохранённого входа Playwright. Тест лежит рядом с модулем в e2e/stand,
// а не в src: образ фронта копирует только src, и импорт ../../e2e ронял tsc сборки (PR #1412).
import { describe, expect, it } from 'vitest';
import { storedAccessToken } from './tokens';

describe('storedAccessToken', () => {
  const state = (key: string, value: string) => ({ cookies: [], origins: [{ origin: 'https://x', localStorage: [{ name: key, value }] }] });
  it('берёт access_token из oidc.user:* сохранённого входа', () => {
    expect(storedAccessToken(state('lore.v2.oidc.user:https://kc/realms/omilore:lore-app', JSON.stringify({ access_token: 'T' })))).toBe('T');
  });
  it('нет записи oidc.user — null', () => {
    expect(storedAccessToken(state('other', '{}'))).toBeNull();
  });
  it('битый JSON в записи — null', () => {
    expect(storedAccessToken(state('oidc.user:a', '{'))).toBeNull();
  });
  it('пустое состояние — null', () => {
    expect(storedAccessToken({})).toBeNull();
  });
});
