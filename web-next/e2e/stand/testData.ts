// Тестовые данные препрода (владелица 21.11.2026: «у нас же есть тестовые пользователи, пусть заводят тестовые
// проекты»). Заводятся идемпотентно: повторный прогон переиспользует то, что уже есть. Удаления проекта и
// организации в API нет — эти записи постоянные тестовые, с кодом на TEST-. Писать — только после
// preprodTestWriteRefusal(...) === null (writeGuard.ts).
import { expect, type Page } from '@playwright/test';

export const TEST_PROJECT_A = 'TEST-proj-a';
export const TEST_PROJECT_B = 'TEST-proj-b';
export const TEST_ORG = 'TEST-org-smoke';

export interface Answer { status: number | null; body: Record<string, unknown> | null; text: string }

/** Запрос токеном вошедшей в `page` учётки (Bearer из хранилища OIDC страницы). */
export async function call(page: Page, method: string, path: string, body?: unknown): Promise<Answer> {
  return page.evaluate(async ({ method, path, body }) => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const token = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* не JSON */ }
      return { status: res.status, body: parsed, text: text.slice(0, 400) };
    } catch (e) { return { status: null, body: null, text: String(e) }; }
  }, { method, path, body });
}

/** Завести TEST-проект или подтвердить, что он есть (POST /lore/project — upsert по slug, только super-admin). */
export async function ensureTestProject(page: Page, slug: string): Promise<string> {
  expect(slug, 'только TEST-проект').toMatch(/^TEST-/);
  const r = await call(page, 'POST', '/lore/project', { slug, name: `Тестовый проект ${slug} (смоук стенда)` });
  expect(r.status, `завести ${slug}: ${r.text}`).toBe(200);
  return String(r.body?.outcome ?? '');
}
