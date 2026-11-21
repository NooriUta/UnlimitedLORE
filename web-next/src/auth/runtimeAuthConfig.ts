// Настройки входа — настройка ЗАПУСКА, а не сборки (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE;
// раньше — OH-REALM-PER-ENV, владелица 15.11.2026: «вынеси realm настройкой для каждой среды»).
//
// Корень: Vite впекает import.meta.env в бандл при сборке. Образ фронта собирается на препроде, прод везёт
// ТОТ ЖЕ образ — и v1.17.21fix отправлял вход на проде в realm препрода; чужая установка с нашим образом
// шла бы в наш Keycloak. Правило: в образе и бандле нет ни одного нашего имени хоста.
//
// Источники по старшинству, поле за полем (пустое значение — «не задано», решает следующий):
//   1. /config.json — собирает скрипт старта образа (docker/40-lore-runtime-config.sh) из env контейнера
//      веба: LORE_AUTH_ENABLED, LORE_OIDC_ISSUER, LORE_OIDC_CLIENT_ID;
//   2. GET /lore/auth/config — бэкенд своей среды (открытый путь, только публичное);
//   3. import.meta.env (VITE_*) — ТОЛЬКО в dev (vite serve); в собранном бандле не читается вовсе.
// Ничего не сказало — вход включён, адреса нет: AuthGate рисует «вход не настроен», а не наш адрес.
export interface OidcSettings { issuer?: string; clientId?: string }
export interface AuthSettings extends OidcSettings { enabled?: boolean }

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const flag = (v: unknown): boolean | undefined => {
  if (typeof v === 'boolean') return v;
  const s = text(v)?.toLowerCase();
  return s === 'true' ? true : s === 'false' ? false : undefined;
};

/** /config.json образа; null — файла нет (dev, старый образ) или это не JSON (SPA-фолбэк nginx). */
export async function loadFrontConfig(fetchImpl: typeof fetch = fetch): Promise<AuthSettings | null> {
  try {
    const r = await fetchImpl('/config.json', { cache: 'no-store', credentials: 'omit' });
    if (!r.ok || !(r.headers.get('Content-Type') ?? '').includes('json')) return null;
    const b = await r.json() as Record<string, unknown>;
    return { enabled: flag(b.auth_enabled), issuer: text(b.oidc_issuer), clientId: text(b.oidc_client_id) };
  } catch {
    return null;
  }
}

/** Ответ бэкенда своей среды; null — не ответил. */
export async function loadRuntimeAuthConfig(fetchImpl: typeof fetch = fetch): Promise<AuthSettings | null> {
  try {
    const r = await fetchImpl('/lore/auth/config', { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) return null;
    const b = await r.json() as Record<string, unknown>;
    return { enabled: flag(b.auth_enabled), issuer: text(b.issuer), clientId: text(b.client_id) };
  } catch {
    return null;
  }
}

export interface ResolveInput {
  front: AuthSettings | null;
  backend: AuthSettings | null;
  /** Значения сборки (VITE_*) — учитываются только при dev=true. */
  build: AuthSettings;
  dev: boolean;
}

export interface ResolvedAuth { enabled: boolean; issuer?: string; clientId: string }

export function resolveAuth({ front, backend, build, dev }: ResolveInput): ResolvedAuth {
  const chain = [front, backend, dev ? build : null];
  const pick = <K extends keyof AuthSettings>(k: K): AuthSettings[K] | undefined => {
    for (const s of chain) if (s && s[k] !== undefined) return s[k];
    return undefined;
  };
  return {
    // Никто не сказал — считаем включённым: без адреса это честное «вход не настроен», а не тихий dev-режим.
    enabled: pick('enabled') ?? true,
    issuer: pick('issuer'),
    clientId: pick('clientId') ?? 'lore-app',
  };
}

let resolved: ResolvedAuth | null = null;

/** Загружено до v2Auth.init() (main.tsx). */
export async function primeRuntimeAuthConfig(fetchImpl?: typeof fetch): Promise<ResolvedAuth> {
  const [front, backend] = await Promise.all([loadFrontConfig(fetchImpl), loadRuntimeAuthConfig(fetchImpl)]);
  resolved = resolveAuth({
    front,
    backend,
    // Ветка под import.meta.env.DEV вырезается из собранного бандла целиком — значения сборки туда не попадают.
    build: import.meta.env.DEV ? {
      enabled: flag(import.meta.env.VITE_LORE_AUTH_ENABLED),
      issuer: text(import.meta.env.VITE_OIDC_ISSUER),
      clientId: text(import.meta.env.VITE_OIDC_CLIENT_ID),
    } : {},
    dev: import.meta.env.DEV === true,
  });
  return resolved;
}

/** Итог после primeRuntimeAuthConfig; null — ещё не загружен. */
export function runtimeAuth(): ResolvedAuth | null { return resolved; }

/**
 * Включён ли вход сейчас. До загрузки конфига в собранном бандле — «включён» (запрос без токена не уйдёт);
 * в dev и тестах — флаг сборки VITE_LORE_AUTH_ENABLED (vitest задаёт его false).
 */
export function authEnabledNow(): boolean {
  if (resolved) return resolved.enabled;
  return !(import.meta.env.DEV && flag(import.meta.env.VITE_LORE_AUTH_ENABLED) === false);
}
