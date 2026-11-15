// Учётки автологина стенда (AP-02, E2E-STAND). Источник — переменная окружения
// LORE_STAND_ACCOUNTS_JSON (в CI — секрет из Infisical, его заводит CICDGitHub):
//   {"test-sa":"…","test-admin":"…"}  или  [{"login":"test-sa","password":"…"}]
//
// Только тестовые учётки (D-2026-ONLY-TEST-PREFIXED-ACCOUNTS): один не тестовый логин —
// отказ всей пачки, чтобы реальный человек не вошёл в прогон даже по ошибке в секрете.
// Пароль не печатается никогда — ни в ошибках, ни в отчёте.
import { authFileFor } from '../../src/standSmoke/rbac.ts';

export interface StandAccount { login: string; password: string }
export interface ParsedAccounts { accounts: StandAccount[]; error: string | null }

const isTestLogin = (login: string): boolean => {
  try { authFileFor('.', login); return true; } catch { return false; }
};

export function parseStandAccounts(raw: string | undefined): ParsedAccounts {
  if (!raw || !raw.trim()) return { accounts: [], error: null };
  let v: unknown;
  try { v = JSON.parse(raw); } catch {
    return { accounts: [], error: 'LORE_STAND_ACCOUNTS_JSON: не JSON (содержимое не показывается)' };
  }
  const pairs: [unknown, unknown][] = Array.isArray(v)
    ? v.map(x => [(x as { login?: unknown })?.login, (x as { password?: unknown })?.password])
    : v && typeof v === 'object' ? Object.entries(v as Record<string, unknown>) : [];
  if (pairs.length === 0) return { accounts: [], error: 'LORE_STAND_ACCOUNTS_JSON: нет ни одной учётки' };
  const accounts: StandAccount[] = [];
  for (const [login, password] of pairs) {
    if (typeof login !== 'string' || !login) return { accounts: [], error: 'LORE_STAND_ACCOUNTS_JSON: учётка без логина' };
    if (!isTestLogin(login)) return { accounts: [], error: `«${login}» — не тестовая учётка: автологин только под логинами TEST*` };
    if (typeof password !== 'string' || !password) return { accounts: [], error: `у «${login}» пустой пароль` };
    accounts.push({ login, password });
  }
  accounts.sort((a, b) => a.login.localeCompare(b.login));
  return { accounts, error: null };
}
