// Учётки автологина стенда (AP-02, E2E-STAND): разбор секрета LORE_STAND_ACCOUNTS_JSON.
// Владелица 15.11.2026: «доработай тесты, чтобы он сам подставлял тестовые учётки».
import { describe, expect, it } from 'vitest';
import { parseStandAccounts } from './accounts';

describe('parseStandAccounts', () => {
  it('нет переменной — учёток нет, это не ошибка (вход руками остаётся)', () => {
    expect(parseStandAccounts(undefined)).toEqual({ accounts: [], error: null });
    expect(parseStandAccounts('  ')).toEqual({ accounts: [], error: null });
  });

  it('объект «логин → пароль» и массив {login,password} — оба читаются, порядок фиксирован', () => {
    const a = parseStandAccounts(JSON.stringify({ 'test-viewer': 'p2', 'test-sa': 'p1' }));
    expect(a.error).toBeNull();
    expect(a.accounts.map(x => x.login)).toEqual(['test-sa', 'test-viewer']);
    const b = parseStandAccounts(JSON.stringify([{ login: 'test-admin', password: 'p' }]));
    expect(b.accounts).toEqual([{ login: 'test-admin', password: 'p' }]);
  });

  it('не тестовая учётка — отказ всей пачки, без входа под реальными людьми', () => {
    const r = parseStandAccounts(JSON.stringify({ 'test-sa': 'p1', omiloreadmin: 'secret' }));
    expect(r.accounts).toEqual([]);
    expect(r.error).toMatch(/omiloreadmin/);
    expect(r.error).toMatch(/тестов/);
  });

  it('пароль в текст ошибки не попадает никогда', () => {
    const bad = [
      JSON.stringify({ 'test-sa': '' }),
      JSON.stringify({ realuser: 'TOP-SECRET-1' }),
      '{"test-sa": "TOP-SECRET-2"',
    ];
    for (const raw of bad) {
      const r = parseStandAccounts(raw);
      expect(r.error).not.toBeNull();
      expect(r.error).not.toMatch(/TOP-SECRET/);
    }
  });

  it('битый JSON — понятная ошибка, а не исключение', () => {
    expect(parseStandAccounts('{').error).toMatch(/JSON/);
  });
});
