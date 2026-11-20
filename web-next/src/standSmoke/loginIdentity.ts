// AP-02: чья сессия сохранена — preferred_username из записи oidc.user:* (профиль, который приложение
// получило от Keycloak). Нужен, чтобы вход одной учётки не сохранился под именем другой.

export function sessionLogin(oidcUserJson: string | null | undefined): string | null {
  if (!oidcUserJson) return null;
  try {
    const v = JSON.parse(oidcUserJson) as { profile?: { preferred_username?: unknown } };
    const u = v?.profile?.preferred_username;
    return typeof u === 'string' && u ? u : null;
  } catch {
    return null;
  }
}

export function sameLogin(expected: string, actual: string | null): boolean {
  return !!actual && expected.trim().toLowerCase() === actual.trim().toLowerCase();
}
