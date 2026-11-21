// Вход LORE v2 (SPRINT_UXR_S3_V2_INFRA/S3-18): одна сессия на приложение,
// механика — общий модуль kit (`@seidr/kit/auth`).
//
// Настройки входа — настройка ЗАПУСКА, а не сборки (SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE):
// env контейнера веба LORE_AUTH_ENABLED / LORE_OIDC_ISSUER / LORE_OIDC_CLIENT_ID → /config.json при старте
// (docker/40-lore-runtime-config.sh), затем бэкенд своей среды; VITE_* — только dev. Порядок — runtimeAuthConfig.ts.
// redirect_uri — корень origin («/»): возврат из Keycloak распознаётся по ?code&state на корне.
import { AuthNotConfiguredError, createAuthSession, createOidcManager, type AuthSession } from '@seidr/kit/auth';
import { OIDC_PREFIX, oidcStore } from '../storage/oidcSession';
import { authEnabledNow, runtimeAuth, type ResolvedAuth } from './runtimeAuthConfig';

const REDIRECT_PATH = '/';

/** Адрес входа или честное «вход не настроен» (AuthGate рисует его без кнопки «Войти»). */
export function oidcTarget(r: ResolvedAuth | null): { issuer: string; clientId: string } {
  if (!r?.issuer) throw new AuthNotConfiguredError('LORE_OIDC_ISSUER не задан: ни /config.json, ни бэкенд своей среды не сообщили адрес входа');
  return { issuer: r.issuer, clientId: r.clientId };
}

export const v2Auth: AuthSession = createAuthSession({
  // Фиксируется в init() — после загрузки /config.json (main.tsx).
  enabled: authEnabledNow,
  redirectPath: REDIRECT_PATH,
  // Вход выключен — dev-роль, как шлёт v1 (K-14: заголовок — предметность LORE, не kit).
  devHeaders: { 'X-Seer-Role': 'admin' },
  manager: () => {
    const { issuer, clientId } = oidcTarget(runtimeAuth());
    const origin = globalThis.location.origin;
    return createOidcManager({
      issuer,
      clientId,
      redirectUri: `${origin}${REDIRECT_PATH}`,
      postLogoutRedirectUri: `${origin}${REDIRECT_PATH}`,
      store: oidcStore(),
      prefix: OIDC_PREFIX,
    });
  },
});

/**
 * fetch приложения к /lore/*: Bearer своей сессии, без токена запрос не уходит,
 * 401 → «сессия истекла». Все клиенты v2 по умолчанию ходят через него.
 */
export const loreFetch: typeof fetch = (input, init) => v2Auth.wrapFetch()(input, init);
