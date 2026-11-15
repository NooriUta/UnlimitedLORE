// Автологин тестовой учётки на стенде (AP-02, E2E-STAND): стенд → форма Keycloak →
// приложение → сохранённый вход Playwright в файл <логин>.json. Дальше тесты идут по
// сохранённым входам (rbac.stand.ts, smoke.stand.ts), как при входе руками.
//
// Форма KC (замер препрода 15.11.2026, realm omilorePreprod): #username, #password,
// кнопка #kc-login. Отказ KC (неверный пароль, учётки нет) — ошибка со словами KC,
// пароль в ней не появляется.
import type { Browser } from '@playwright/test';

export interface LoginResult { login: string; ok: boolean; reason: string | null }

export async function standLogin(browser: Browser, baseURL: string, login: string, password: string, file: string, timeoutMs = 45_000): Promise<LoginResult> {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  try {
    await page.goto('/news');
    const form = page.locator('#username');
    const app = page.locator('[data-testid^="news-row-"]');
    await form.or(app).first().waitFor({ timeout: timeoutMs });
    if (await form.isVisible().catch(() => false)) {
      await form.fill(login);
      await page.locator('#password').fill(password);
      await page.locator('#kc-login').click();
      const kcError = page.locator('#input-error, .kc-feedback-text, .alert-error, [id^="input-error"]');
      await app.or(kcError).first().waitFor({ timeout: timeoutMs });
      if (await kcError.first().isVisible().catch(() => false)) {
        const text = (await kcError.first().textContent() ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
        return { login, ok: false, reason: `Keycloak отказал: ${text || 'без текста'}` };
      }
    }
    await app.first().waitFor({ timeout: timeoutMs });
    await ctx.storageState({ path: file });
    return { login, ok: true, reason: null };
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0].slice(0, 160);
    return { login, ok: false, reason: `вход не завершён: ${msg}` };
  } finally {
    await ctx.close();
  }
}
