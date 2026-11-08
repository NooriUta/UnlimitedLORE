// Чтение сохранённой OIDC-сессии для клиента v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Только чтение и только ключи `oidc.user:*`: их пишет вход v1 (oidc-client-ts)
// на том же ориджине. Своих ключей сессии v2 не заводит — гард S3-08 требует,
// чтобы к хранилищу браузера обращался только этот каталог.

/** Минимум Storage, нужный для поиска сессии. */
export interface StorageLike {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
}

/** Хранилище с сессией входа; недоступно (приватный режим, запрет) — null. */
export function oidcSessionStorage(): StorageLike | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
