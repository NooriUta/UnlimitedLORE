// AP-02 (20.11.2026): .auth/test-admin.json и test-viewer.json несли вход test-sa — повторный вход внутри
// раннера (keepLoginFresh) открывал контекст с use.storageState (stand.json = test-sa), KC отдавал код без
// формы, и «вошла» срабатывало на чужой сессии. Правило: вход сохраняется, только если сессия — та учётка.
import { describe, expect, it } from 'vitest';
import { sessionLogin, sameLogin } from './loginIdentity';

describe('sessionLogin — чья сессия oidc.user:*', () => {
  it('preferred_username из профиля сессии', () => {
    expect(sessionLogin(JSON.stringify({ profile: { preferred_username: 'test-sa', sub: 's' } }))).toBe('test-sa');
  });
  it('нет профиля или не JSON — null', () => {
    expect(sessionLogin(JSON.stringify({ access_token: 'x' }))).toBeNull();
    expect(sessionLogin('мусор')).toBeNull();
    expect(sessionLogin(null)).toBeNull();
  });
});

describe('sameLogin — та ли учётка', () => {
  it('регистр не важен (KC хранит логин строчными)', () => {
    expect(sameLogin('TEST-admin', 'test-admin')).toBe(true);
  });
  it('чужая или неизвестная — нет', () => {
    expect(sameLogin('test-admin', 'test-sa')).toBe(false);
    expect(sameLogin('test-admin', null)).toBe(false);
  });
});
