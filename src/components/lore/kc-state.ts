// AL-31: у KC-моста ЧЕТЫРЕ разных исхода, и «пусто» — только один из них.
// 403 (отказ), 503 (мост не настроен) и сеть/5xx — НЕ пустой список: у каждого
// исхода своё состояние и свой экран (KcStateView). Вынесено из LoreAdminPanel
// ради vitest (AL-47): разбор исходов — чистая логика, тестируется без браузера.

import { authHeaders, sessionExpired } from '../../auth/session';

export type KcState<T> =
  | { k: 'loading' }
  | { k: 'ok'; rows: T[] }
  | { k: 'forbidden' }              // 403 — роль не пускает; записи могут существовать
  | { k: 'off'; detail: string }    // 503 — моста нет, состояние неизвестно
  | { k: 'error'; detail: string }; // сеть/5xx — то же, но без внятной причины

// AL-87: раньше здесь был жёстко зашитый {'X-Seer-Role':'admin'} — совпадал с
// authHeaders() только при AUTH_ENABLED=false (дев), маскируя баг. На проде
// authHeaders() несёт реальный Bearer-токен; без него бэкенд с OIDC отвечает
// 401 ПОСТОЯННО (не только при истёкшей сессии) — экран показывал «Keycloak
// не ответил» вместо «сессия истекла».
export async function loadKc<T>(path: string, fetchFn: typeof fetch = fetch): Promise<KcState<T>> {
  try {
    const r = await fetchFn(path, { headers: { ...authHeaders() } });
    if (r.status === 401) { sessionExpired(); return { k: 'error', detail: 'session expired' }; }
    if (r.status === 403) return { k: 'forbidden' };
    if (r.status === 503) {
      const body = await r.json().catch(() => ({} as { detail?: string }));
      return { k: 'off', detail: (body as { detail?: string }).detail ?? 'not configured' };
    }
    if (!r.ok) return { k: 'error', detail: `HTTP ${r.status}` };
    return { k: 'ok', rows: (await r.json()) as T[] };
  } catch (e) { return { k: 'error', detail: e instanceof Error ? e.message : String(e) }; }
}

export async function loadKcObj<T>(path: string, fetchFn: typeof fetch = fetch): Promise<T | null> {
  try {
    const r = await fetchFn(path, { headers: { ...authHeaders() } });
    if (r.status === 401) { sessionExpired(); return null; }
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}
