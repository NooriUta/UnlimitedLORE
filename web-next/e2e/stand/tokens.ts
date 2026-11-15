// Чтение сохранённого входа Playwright (storageState) для RBAC-прогона.
// Лежит в e2e, а не в src: поле origins[].localStorage — формат файла Playwright,
// а сторож S3-08 (src/storage/storage.test.ts) правильно не пускает обращения к
// хранилищу браузера в исходники приложения.

interface StorageStateLike {
  origins?: { localStorage?: { name: string; value: string }[] }[];
}

/** access_token, записанный в сохранённом входе (запись `*oidc.user:*`). */
export function storedAccessToken(state: StorageStateLike): string | null {
  for (const o of state.origins ?? []) {
    for (const e of o.localStorage ?? []) {
      if (!e.name.includes('oidc.user:')) continue;
      try {
        const t = (JSON.parse(e.value) as { access_token?: unknown }).access_token;
        if (typeof t === 'string' && t) return t;
      } catch { /* битая запись — ищем дальше */ }
    }
  }
  return null;
}
