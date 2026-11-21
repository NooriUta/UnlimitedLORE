// Помощники RBAC-прогона на стенде (SPEC-LORE-RBAC-ADMIN-TESTCASES). Чистые функции —
// проверяются vitest-ом; сценарии лежат в e2e/stand/rbac.stand.ts.
//
// Учётки только тестовые (D-2026-ONLY-TEST-PREFIXED-ACCOUNTS): authFileFor откажет
// на любом другом логине, чтобы вход реального человека не попал в прогон даже по
// ошибке в имени файла.
import { resolve } from 'node:path';

/** Учётки KC (realm omilore), под которыми человек один раз сохраняет вход. */
export const RBAC_ACCOUNTS = {
  superAdmin: 'test-sa',
  admin: 'test-admin',
  viewer: 'test-viewer',
  user1: 'test-user-1',
  user2: 'test-user-2',
  user3: 'test-user-3',
} as const;

const SAFE_LOGIN = /^test[a-z0-9-]*$/i;

/** Файл сохранённого входа учётки: `<папка>/<логин>.json`. */
export function authFileFor(dir: string, login: string): string {
  if (!SAFE_LOGIN.test(login)) {
    throw new Error(`«${login}» — не тестовая учётка: прогон RBAC идёт только под логинами TEST*`);
  }
  return resolve(dir, `${login}.json`);
}

/** Claim-ы токена без проверки подписи (для отчёта и срока; доверия им нет). */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString('utf8');
    const v: unknown = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Истёк ли токен к моменту `nowMs`. Нет exp — не знаем, и это не «истёк». */
export function isExpired(payload: Record<string, unknown>, nowMs: number): boolean {
  return typeof payload.exp === 'number' && payload.exp * 1000 < nowMs;
}

/**
 * Копия токена с exp на час раньше `nowMs` (RB-08: сервер обязан отвергнуть просроченный токен). Заголовок и
 * прочие claim-ы — как были, подпись прежняя, то есть к новому телу она не подходит: сервер должен ответить 401
 * и по сроку, и по подписи. Не JWT — null.
 */
export function expiredCopy(token: string, nowMs: number): string | null {
  const parts = token.split('.');
  const payload = jwtPayload(token);
  if (parts.length !== 3 || !payload) return null;
  const body = { ...payload, exp: Math.floor(nowMs / 1000) - 3600 };
  const b64 = Buffer.from(JSON.stringify(body)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${parts[0]}.${b64}.${parts[2]}`;
}
