// Адрес входа своей среды (владелица 15.11.2026: «вынеси realm настройкой для каждой среды»).
//
// Корень, ради которого это место есть: Vite впекает import.meta.env в бандл при сборке. Образ фронта
// собирается на препроде (VITE_OIDC_ISSUER=…/omilorePreprod), а прод по правилу везёт ТОТ ЖЕ образ —
// и v1.17.21fix отправлял вход на проде в realm препрода. Бэкенд же берёт issuer из окружения своей
// среды. Поэтому до старта сессии фронт спрашивает GET /lore/auth/config (открытый путь, только
// публичное), а значение сборки — запасной путь: бэкенд старой версии (404) или недоступен.
export interface OidcSettings { issuer?: string; clientId?: string }

/** Ответ бэкенда своей среды; null — не ответил, тогда решает значение сборки. */
export async function loadRuntimeAuthConfig(fetchImpl: typeof fetch = fetch): Promise<OidcSettings | null> {
  try {
    const r = await fetchImpl('/lore/auth/config', { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) return null;
    const b = await r.json() as { issuer?: string | null; client_id?: string | null };
    return { issuer: b.issuer || undefined, clientId: b.client_id || undefined };
  } catch {
    return null;
  }
}

/** Что брать: настройка среды главнее сборки; пустое значение среды сборку не затирает. */
export function resolveOidc(build: OidcSettings, runtime: OidcSettings | null): { issuer?: string; clientId: string } {
  return {
    issuer: runtime?.issuer || build.issuer,
    clientId: runtime?.clientId || build.clientId || 'lore-app',
  };
}

let runtime: OidcSettings | null = null;
/** Загружено до v2Auth.init() (main.tsx). */
export async function primeRuntimeAuthConfig(fetchImpl?: typeof fetch): Promise<void> {
  runtime = await loadRuntimeAuthConfig(fetchImpl);
}
export function runtimeAuthConfig(): OidcSettings | null { return runtime; }
