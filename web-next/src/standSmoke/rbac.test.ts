// Помощники RBAC-прогона на стенде (SPEC-LORE-RBAC-ADMIN-TESTCASES): вход на учётку,
// разбор токена без подписи, срок токена.
import { describe, expect, it } from 'vitest';
import { authFileFor, expiredCopy, isExpired, jwtPayload, RBAC_ACCOUNTS } from './rbac';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: unknown) => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.sig`;

describe('jwtPayload', () => {
  it('читает claim-ы без проверки подписи', () => {
    expect(jwtPayload(jwt({ sub: 'u1', exp: 10 }))).toEqual({ sub: 'u1', exp: 10 });
  });
  it('мусор — null, а не исключение', () => {
    expect(jwtPayload('abc')).toBeNull();
    expect(jwtPayload('a.!!!.c')).toBeNull();
    expect(jwtPayload('')).toBeNull();
  });
  it('base64url с - и _ разбирается', () => {
    const p = { name: '??>>~~' };
    expect(jwtPayload(jwt(p))).toEqual(p);
  });
});

describe('isExpired', () => {
  it('exp в прошлом — истёк', () => expect(isExpired({ exp: 100 }, 101_000)).toBe(true));
  it('exp в будущем — жив', () => expect(isExpired({ exp: 100 }, 99_000)).toBe(false));
  it('без exp — не знаем, значит не «истёк»', () => expect(isExpired({}, 1)).toBe(false));
});

describe('authFileFor', () => {
  it('файл входа на учётку — <логин>.json в папке входов', () => {
    expect(authFileFor('e2e/stand/.auth', 'test-viewer').replace(/\\/g, '/')).toMatch(/e2e\/stand\/\.auth\/test-viewer\.json$/);
  });
  it('только тестовые учётки (правило D-2026-ONLY-TEST-PREFIXED-ACCOUNTS)', () => {
    expect(() => authFileFor('d', 'omiloreadmin')).toThrow(/тестов/);
    expect(() => authFileFor('d', '../test-sa')).toThrow();
  });
  it('все учётки прогона — тестовые', () => {
    for (const a of Object.values(RBAC_ACCOUNTS)) expect(a.toLowerCase().startsWith('test')).toBe(true);
  });
});

describe('expiredCopy — поддельный просроченный токен для RB-08', () => {
  it('exp в прошлом, прочие claim-ы и заголовок те же, подпись прежняя (значит, недействительна)', () => {
    const live = jwt({ sub: 'u1', exp: 2_000_000_000, iat: 1_900_000_000 });
    const old = expiredCopy(live, 1_800_000_000_000);
    expect(old).not.toBeNull();
    const p = jwtPayload(old!)!;
    expect(p.sub).toBe('u1');
    expect(isExpired(p, 1_800_000_000_000)).toBe(true);
    expect(old!.split('.')[0]).toBe(live.split('.')[0]);
    expect(old!.split('.')[2]).toBe('sig');
  });
  it('не JWT — null', () => {
    expect(expiredCopy('не токен', Date.now())).toBeNull();
  });
});
