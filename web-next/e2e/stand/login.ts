// Автологин тестовой учётки на стенде (AP-02, E2E-STAND): стенд → форма Keycloak →
// приложение → сохранённый вход Playwright в файл <логин>.json. Дальше тесты идут по
// сохранённым входам (rbac.stand.ts, smoke.stand.ts), как при входе руками.
//
// Форма KC (замер препрода 15.11.2026, realm omilorePreprod): #username, #password,
// кнопка #kc-login. Отказ KC (неверный пароль, учётки нет) — ошибка со словами KC,
// пароль в ней не появляется. Сбой — с ШАГОМ и адресом страницы (хост и путь, без
// query: там бывают state/code), иначе «таймаут 45 с» не объясняет, где встало
// (прогон 7846: шесть одинаковых таймаутов без следа).
import type { Browser, Page } from '@playwright/test';

export interface LoginResult { login: string; ok: boolean; reason: string | null }

const where = (page: Page): string => {
  try { const u = new URL(page.url()); return `${u.host}${u.pathname}`; } catch { return page.url().slice(0, 80); }
};

export async function standLogin(browser: Browser, baseURL: string, login: string, password: string, file: string, timeoutMs = 45_000): Promise<LoginResult> {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  let step = 'открыть стенд';
  try {
    const resp = await page.goto('/news', { timeout: timeoutMs }).catch(e => { throw new Error(`goto: ${(e as Error).message.split('\n')[0]}`); });
    step = `ждать форму входа или приложение (HTTP ${resp?.status() ?? '—'})`;
    const form = page.locator('#username');
    const app = page.locator('[data-testid^="news-row-"]');
    await form.or(app).first().waitFor({ timeout: timeoutMs });
    if (await form.isVisible().catch(() => false)) {
      step = 'ввести учётку в форму KC';
      await form.fill(login);
      await page.locator('#password').fill(password);
      await page.locator('#kc-login').click();
      step = 'ждать приложение после входа';
      const kcError = page.locator('#input-error, .kc-feedback-text, .alert-error, [id^="input-error"]');
      await app.or(kcError).first().waitFor({ timeout: timeoutMs });
      if (await kcError.first().isVisible().catch(() => false)) {
        const text = (await kcError.first().textContent() ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
        return { login, ok: false, reason: `Keycloak отказал: ${text || 'без текста'}` };
      }
    }
    step = 'ждать ленту';
    await app.first().waitFor({ timeout: timeoutMs });
    await ctx.storageState({ path: file });
    return { login, ok: true, reason: null };
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0].slice(0, 160);
    const title = await page.title().catch(() => '');
    return { login, ok: false, reason: `шаг «${step}»: ${msg}; страница ${where(page)}${title ? ` «${title.slice(0, 60)}»` : ''}` };
  } finally {
    await ctx.close();
  }
}
