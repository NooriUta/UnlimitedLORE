// Чтение access_token из сохранённого входа Playwright. Тест лежит рядом с модулем в e2e/stand,
// а не в src: образ фронта копирует только src, и импорт ../../e2e ронял tsc сборки (PR #1412).
import { describe, expect, it } from 'vitest';
import { storedAccessToken, storedSecondsLeft } from './tokens';

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

// E2E-STAND · прогон 9033 (19.11.2026): набор идёт 31 мин, вход живёт ~15 — всё после ~15-й минуты падало
// «Вы не опознаны» / «нет прав». Смоук должен знать, сколько жить его входу, чтобы войти заново заранее.
describe('storedSecondsLeft', () => {
  const state = (value: unknown) => ({ origins: [{ localStorage: [{ name: 'lore.v2.oidc.user:kc:lore-app', value: JSON.stringify(value) }] }] });
  it('секунды до конца по expires_at записи oidc.user', () => {
    expect(storedSecondsLeft(state({ access_token: 'T', expires_at: 1000 }), 400)).toBe(600);
  });
  it('истёкший вход — отрицательное число', () => {
    expect(storedSecondsLeft(state({ access_token: 'T', expires_at: 1000 }), 1100)).toBe(-100);
  });
  it('нет записи или срока — null (не знаем, значит не трогаем)', () => {
    expect(storedSecondsLeft({}, 0)).toBeNull();
    expect(storedSecondsLeft(state({ access_token: 'T' }), 0)).toBeNull();
  });
});
