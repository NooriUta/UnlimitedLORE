// Чеклист включения аутентификации (SPRINT_UXR_S7B_ADMIN/S7B-31 п.4, решение 4а):
// из старой вкладки v1 «Настройки» (AL-35) — на Главную админки карточками.
//
// Источник один — GET /lore/kc/auth-preflight: сервер сам считает число
// админов в Keycloak, жив ли мост, включён ли OIDC и работает ли проверка
// agent_scope. Клиент не угадывает: admin_count=-1 — «не смогли проверить»
// (мост не настроен или не ответил), а не «админов нет».
import { getJson, type FetchOptions } from './actions';

export interface Preflight {
  auth_enabled: boolean;
  kc_configured: boolean;
  kc_reachable: boolean;
  kc_error: string;
  /** -1 — неизвестно (мост не настроен или не ответил). */
  admin_count: number;
  agent_scope_enforced: boolean;
  can_enable_auth: boolean;
  /** Подсказка сервера: что сделать, чтобы можно было включить auth. */
  hint: string;
}

type Obj = Record<string, unknown>;

function bool(b: Obj, k: string): boolean {
  if (typeof b[k] !== 'boolean') throw new Error(`malformed answer: ${k}`);
  return b[k] as boolean;
}

export function parsePreflight(raw: unknown): Preflight {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Obj;
  const n = typeof b.admin_count === 'number' && Number.isFinite(b.admin_count) ? b.admin_count : -1;
  return {
    auth_enabled: bool(b, 'auth_enabled'),
    kc_configured: bool(b, 'kc_configured'),
    kc_reachable: bool(b, 'kc_reachable'),
    kc_error: typeof b.kc_error === 'string' ? b.kc_error : '',
    admin_count: n,
    agent_scope_enforced: bool(b, 'agent_scope_enforced'),
    can_enable_auth: bool(b, 'can_enable_auth'),
    hint: typeof b.hint === 'string' ? b.hint : '',
  };
}

export async function fetchPreflight(opts: FetchOptions = {}): Promise<Preflight> {
  return parsePreflight(await getJson('/lore/kc/auth-preflight', opts));
}

export type CheckState = 'ok' | 'fail' | 'unknown';

export type PreflightCheck =
  | { id: 'admins'; state: CheckState; n: number }
  | { id: 'kc'; state: CheckState; why: 'ok' | 'off' | 'down'; error: string }
  | { id: 'scope'; state: CheckState }
  | { id: 'enable'; state: CheckState; hint: string };

/** Проверки в порядке v1: админы · Keycloak · agent_scope · можно ли включать. */
export function preflightChecks(pf: Preflight): PreflightCheck[] {
  const kcWhy = !pf.kc_configured ? 'off' : pf.kc_reachable ? 'ok' : 'down';
  return [
    { id: 'admins', state: pf.admin_count < 0 ? 'unknown' : pf.admin_count > 0 ? 'ok' : 'fail', n: pf.admin_count },
    { id: 'kc', state: kcWhy === 'ok' ? 'ok' : 'fail', why: kcWhy, error: pf.kc_error },
    { id: 'scope', state: pf.agent_scope_enforced ? 'ok' : 'fail' },
    { id: 'enable', state: pf.can_enable_auth ? 'ok' : 'fail', hint: pf.hint },
  ];
}
