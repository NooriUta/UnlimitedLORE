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

/**
 * Сколько секунд осталось жить сохранённому входу (expires_at записи `*oidc.user:*`, секунды UNIX).
 * null — записи или срока нет: не знаем — не трогаем. E2E-STAND, прогон 9033: набор шёл 31 мин на входе,
 * который живёт ~15, и всё после истечения падало «Вы не опознаны».
 */
export function storedSecondsLeft(state: StorageStateLike, nowSec: number): number | null {
  for (const o of state.origins ?? []) {
    for (const e of o.localStorage ?? []) {
      if (!e.name.includes('oidc.user:')) continue;
      try {
        const at = (JSON.parse(e.value) as { expires_at?: unknown }).expires_at;
        if (typeof at === 'number' && Number.isFinite(at)) return at - nowSec;
      } catch { /* битая запись — ищем дальше */ }
    }
  }
  return null;
}
