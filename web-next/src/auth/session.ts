// Вход LORE v2 (SPRINT_UXR_S3_V2_INFRA/S3-18): одна сессия на приложение,
// механика — общий модуль kit (`@seidr/kit/auth`). Конфиг — build-args образа
// (web-next/Dockerfile), как у v1 и бэкенда:
//   VITE_LORE_AUTH_ENABLED=true  — вход включён (пусто/false — прежний dev-режим);
//   VITE_OIDC_ISSUER             — https://…/kc/realms/omilore;
//   VITE_OIDC_CLIENT_ID          — клиент Keycloak, по умолчанию lore-app.
// redirect_uri — корень origin («/»): он разрешён в клиенте lore-app для
// new.lore; возврат из Keycloak распознаётся по ?code&state на корне.
import { createAuthSession, createOidcManager, type AuthSession } from '@seidr/kit/auth';
import { OIDC_PREFIX, oidcStore } from '../storage/oidcSession';
import { resolveOidc, runtimeAuthConfig } from './runtimeAuthConfig';

export const AUTH_ENABLED = import.meta.env.VITE_LORE_AUTH_ENABLED === 'true';
const REDIRECT_PATH = '/';

export const v2Auth: AuthSession = createAuthSession({
  enabled: AUTH_ENABLED,
  redirectPath: REDIRECT_PATH,
  // Вход выключен — dev-роль, как шлёт v1 (K-14: заголовок — предметность LORE, не kit).
  devHeaders: { 'X-Seer-Role': 'admin' },
  manager: () => {
    // Realm — настройка среды: адрес входа от бэкенда своей среды (/lore/auth/config), сборка — запасной путь.
    const { issuer, clientId } = resolveOidc({
      issuer: import.meta.env.VITE_OIDC_ISSUER as string | undefined,
      clientId: import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined,
    }, runtimeAuthConfig());
    if (!issuer) throw new Error('VITE_LORE_AUTH_ENABLED=true, но адрес входа не пришёл ни от бэкенда (/lore/auth/config), ни из сборки');
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
