// Хранилище сессии входа v2 (SPRINT_UXR_S3_V2_INFRA/S3-18).
// Свой вход v2 (kit auth, oidc-client-ts) держит пользователя и state входа в
// localStorage под префиксом lore.v2.oidc.* — по правилу S3-08 все ключи v2
// начинаются с lore.v2., а к хранилищу браузера обращается только этот каталог.
// Ключи v1 (`oidc.user:*`) v2 больше не читает: они живут на origin v1, а на
// new.lore их нет вовсе (S3-18: все запросы получали 401).
import { V2_PREFIX } from './storage';

export const OIDC_PREFIX = `${V2_PREFIX}oidc.`;

/** Хранилище сессии входа; недоступно (приватный режим, запрет) — ошибка входа, а не тихий аноним. */
export function oidcStore(): Storage {
  const s = globalThis.localStorage;
  if (!s) throw new Error('localStorage недоступен — сессию входа негде хранить');
  return s;
}
