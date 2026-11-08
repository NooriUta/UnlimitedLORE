// Боевой менеджер OIDC для createAuthSession (SPRINT_UXR_S3_V2_INFRA/S3-18):
// oidc-client-ts, Authorization Code + PKCE S256 (у oidc-client-ts PKCE для
// response_type=code включён всегда), тихое продление по refresh-токену.
// Хранилище даёт приложение: у v2 к localStorage обращается только его
// каталог storage/ (гард S3-08), а ключи — под префиксом lore.v2.*.
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import type { UserManagerLike } from './session';

export interface OidcConfig {
  /** Issuer Keycloak, например https://…/kc/realms/omilore. */
  issuer: string;
  clientId: string;
  /** Полный redirect_uri (он же callback-маршрут), должен быть разрешён в клиенте KC. */
  redirectUri: string;
  postLogoutRedirectUri: string;
  /** Хранилище сессии и state входа (localStorage приложения). */
  store: Storage;
  /** Префикс ключей хранилища, например «lore.v2.oidc.». */
  prefix: string;
  scope?: string;
}

export function createOidcManager(cfg: OidcConfig): UserManagerLike {
  const store = new WebStorageStateStore({ store: cfg.store, prefix: cfg.prefix });
  return new UserManager({
    authority: cfg.issuer,
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    post_logout_redirect_uri: cfg.postLogoutRedirectUri,
    response_type: 'code',
    scope: cfg.scope ?? 'openid profile',
    userStore: store,
    stateStore: store,
    automaticSilentRenew: true,
  }) as unknown as UserManagerLike;
}
