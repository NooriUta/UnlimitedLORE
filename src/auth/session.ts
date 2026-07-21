// ── LORE OIDC session (A2) ─────────────────────────────────────────────────
// Feature-flagged: VITE_LORE_AUTH_ENABLED mirrors the backend's LORE_AUTH_ENABLED.
// Off (default, today) → authHeaders() returns the same hardcoded
// { 'X-Seer-Role': 'admin' } every write call already sent — zero behavior
// change until both sides of the flag are flipped together.
// On → the backend's SeerRoleFromTokenFilter derives the role from a verified
// JWT and ignores/strips any client-sent X-Seer-Role, so once enabled we send
// Authorization: Bearer <token> instead and stop sending the role header at all.
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

export const AUTH_ENABLED = import.meta.env.VITE_LORE_AUTH_ENABLED === 'true';

const OIDC_ISSUER    = import.meta.env.VITE_OIDC_ISSUER as string | undefined;
const OIDC_CLIENT_ID = (import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined) ?? 'lore-app';

let manager: UserManager | null = null;
let currentUser: User | null = null;
const listeners = new Set<() => void>();

function notify(): void { listeners.forEach(fn => fn()); }

export function getUserManager(): UserManager {
  if (manager) return manager;
  if (!OIDC_ISSUER) {
    throw new Error('VITE_LORE_AUTH_ENABLED=true but VITE_OIDC_ISSUER is not set');
  }
  manager = new UserManager({
    authority: OIDC_ISSUER,
    client_id: OIDC_CLIENT_ID,
    redirect_uri: `${location.origin}/auth/callback`,
    post_logout_redirect_uri: `${location.origin}/`,
    response_type: 'code',
    scope: 'openid profile',
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: true,
  });
  manager.events.addUserLoaded(u => { currentUser = u; notify(); });
  manager.events.addUserUnloaded(() => { currentUser = null; notify(); });
  manager.events.addSilentRenewError(() => { currentUser = null; sessionLost = true; notify(); });
  return manager;
}

/**
 * Поднимает сохранённую сессию на старте — вызывать один раз до первого рендера.
 *
 * ВАЖНО: `getUser()` отдаёт сохранённого пользователя ДАЖЕ с истёкшим сроком —
 * сама по себе запись в localStorage не означает «вошли». Раньше протухший
 * пользователь попадал в `currentUser`, `AuthGate` видел `!= null` и считал вход
 * состоявшимся: приложение рендерилось, но каждый запрос уходил без токена и
 * получал 401. Получался белый экран, из которого пользователь не мог выйти даже
 * перезагрузкой — состояние самовоспроизводилось (прод-инцидент 2026-07-21,
 * AL-69: помогало только ручное удаление ключа `oidc.user:…` из localStorage).
 *
 * Поэтому истёкшего пользователя сначала пробуем продлить по refresh-токену и
 * только при неудаче считаем, что сессии нет — тогда `AuthGate` уведёт на вход.
 */
export async function initSession(): Promise<void> {
  if (!AUTH_ENABLED) return;
  const mgr = getUserManager();
  let user = await mgr.getUser();
  if (user?.expired) {
    try {
      user = await mgr.signinSilent();
    } catch {
      user = null; // продлить не вышло — уходим на полноценный вход
      sessionLost = true;
    }
  }
  currentUser = user && !user.expired ? user : null;
  notify();
}

export function getCurrentUser(): User | null { return currentUser; }

// Была ли сессия и отвалилась — или входа ещё не было.
//
// Экран входа говорит об этом разными словами не ради вежливости: «сессия
// истекла» и «вы не вошли» требуют от человека РАЗНОГО. В первом случае работа
// могла остаться несохранённой и объяснить надо, почему его выбросило; во
// втором объяснять нечего, нужна кнопка. Один общий текст обязательно врал бы
// в одну из сторон — а неверная причина отправляет искать поломку не там
// (ровно так инцидент 2026-07-21 сначала увели в HTTPS и сборку).
let sessionLost = false;

export function wasSessionLost(): boolean { return sessionLost; }

/**
 * Есть ли ДЕЙСТВИТЕЛЬНАЯ сессия — единственный корректный ответ на вопрос
 * «вошли ли мы». Проверять `getCurrentUser() != null` нельзя: протухший
 * пользователь тоже не `null`, и именно эта подмена дала белый экран (AL-69).
 */
export function hasValidSession(): boolean {
  return currentUser !== null && !currentUser.expired;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Бэкенд ответил 401 — сессия недействительна, что бы ни думал клиент.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ. Токен может протухнуть, а `automaticSilentRenew` —
 * не сработать (молчаливое продление ходит в KC скрытым запросом и обрывается
 * без единого следа в интерфейсе). Клиент при этом считает себя вошедшим,
 * `authHeaders()` не находит валидного токена и шлёт запрос БЕЗ заголовка, а
 * бэкенд отвечает 401. Экран показывает пустой список.
 *
 * Симптом получается «данных нет», хотя данные есть и дело в сессии. Владелец
 * поймала это 2026-07-20 на вкладке «Компоненты»: список пуст, при этом слайс
 * с токеном отдавал 25 КБ. Диагностика ушла в бэкенд и CORS — то есть ровно
 * туда, где всё было исправно.
 *
 * Сброс пользователя переводит `AuthGate` в состояние «нет сессии», и тот сам
 * уводит на вход. Механизм тот же, что уже используется при ошибке молчаливого
 * продления (`addSilentRenewError` ниже) — новая только точка входа в него.
 */
export function sessionExpired(): void {
  if (!AUTH_ENABLED || currentUser === null) return;
  currentUser = null;
  sessionLost = true;
  notify();
}

export function login(returnTo?: string): Promise<void> {
  return getUserManager().signinRedirect({ state: returnTo ?? location.pathname + location.search });
}

export async function logout(): Promise<void> {
  await getUserManager().signoutRedirect();
}

export async function handleLoginCallback(): Promise<string | undefined> {
  const user = await getUserManager().signinRedirectCallback();
  currentUser = user;
  notify();
  return typeof user.state === 'string' ? user.state : undefined;
}

/** Display name for the header badge — prefers preferred_username, falls back to sub. */
export function displayName(): string | null {
  const u = currentUser;
  if (!u) return null;
  const claims = u.profile as Record<string, unknown>;
  return (claims.preferred_username as string) ?? (claims.name as string) ?? u.profile.sub ?? null;
}

// ── Role (ADR-LORE-025 D8) ──────────────────────────────────────────────────
// The single verified-source role accessor: with auth ON the realm role comes
// from the token's seer_roles claim (super-admin→superadmin, admin, else
// viewer); with auth OFF (dev) — from config (default 'admin', today's
// behavior). Section gating (⚙ Admin LORE) must go through this, never a
// hand-rolled check.
export type SeerRole = 'superadmin' | 'admin' | 'viewer';

const DEV_ROLE = ((import.meta.env.VITE_LORE_ROLE as string | undefined) ?? 'admin') as SeerRole;

/** Pure claim→role mapping — unit-tested separately (AL-09). */
export function roleFromClaims(roles: string[]): SeerRole {
  if (roles.includes('super-admin')) return 'superadmin';
  if (roles.includes('admin')) return 'admin';
  return 'viewer';
}

export function getRole(): SeerRole {
  if (!AUTH_ENABLED) return DEV_ROLE;
  const u = currentUser;
  if (!u || u.expired) return 'viewer';
  const claims = u.profile as Record<string, unknown>;
  return roleFromClaims((claims.seer_roles as string[] | undefined) ?? []);
}

export function isAdmin(): boolean {
  const r = getRole();
  return r === 'admin' || r === 'superadmin';
}

export function authHeaders(): Record<string, string> {
  if (!AUTH_ENABLED) return { 'X-Seer-Role': 'admin' };
  if (currentUser && !currentUser.expired) return { Authorization: `Bearer ${currentUser.access_token}` };
  // No valid token — send nothing. The backend strips any X-Seer-Role once
  // OIDC is on, so a stale/missing token correctly reads as anonymous (401 on
  // writes) rather than silently keeping today's admin-by-default behavior.
  return {};
}
