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
import { sameLogin, sessionLogin } from '../../src/standSmoke/loginIdentity.ts';

export interface LoginResult { login: string; ok: boolean; reason: string | null }

const where = (page: Page): string => {
  try { const u = new URL(page.url()); return `${u.host}${u.pathname}`; } catch { return page.url().slice(0, 80); }
};

export async function standLogin(browser: Browser, baseURL: string, login: string, password: string, file: string, timeoutMs = 45_000): Promise<LoginResult> {
  // AP-02 (20.11.2026): только чистый контекст. Внутри раннера browser.newContext() подставляет
  // use.storageState (stand.json = test-sa): KC отдавал код без формы, и в файл test-admin/test-viewer
  // ложилась сессия test-sa — whoami «superadmin» (прогон 9441). Тот же урок, что broker.stand.ts (7861).
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  let step = 'открыть стенд';
  try {
    const resp = await page.goto('/news', { timeout: timeoutMs }).catch(e => { throw new Error(`goto: ${(e as Error).message.split('\n')[0]}`); });
    step = `ждать форму входа или приложение (HTTP ${resp?.status() ?? '—'})`;
    const form = page.locator('#username');
    // Признак «вошла» — запись сессии oidc.user:* в хранилище браузера на ДОМЕНЕ СТЕНДА
    // (её пишет приложение после обмена кодом), а не элемент страницы. Прогоны 7847/7853:
    // KC пустил все шесть учёток и вернул на /news «LORE v2», но ни строк ленты (пусто при
    // пустом проектном скоупе), ни .sk-shell__side (страница «Новости» живёт без оболочки)
    // там нет — элемент страницы признаком входа быть не может.
    const signedIn = (): Promise<boolean> => page.evaluate(() =>
      Object.keys(localStorage).some(k => k.includes('oidc.user:'))).catch(() => false);
    const until = async (cond: () => Promise<boolean>): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) { if (await cond()) return true; await page.waitForTimeout(500); }
      return false;
    };
    const stand = new URL(baseURL).host;
    const onStand = () => { try { return new URL(page.url()).host === stand; } catch { return false; } };
    await until(async () => (await form.isVisible().catch(() => false)) || (onStand() && await signedIn()));
    if (await form.isVisible().catch(() => false)) {
      step = 'ввести учётку в форму KC';
      await form.fill(login);
      await page.locator('#password').fill(password);
      await page.locator('#kc-login').click();
      step = 'ждать сессию после входа';
      const kcError = page.locator('#input-error, .kc-feedback-text, .alert-error, [id^="input-error"]');
      await until(async () => (await kcError.first().isVisible().catch(() => false)) || (onStand() && await signedIn()));
      if (await kcError.first().isVisible().catch(() => false)) {
        const text = (await kcError.first().textContent() ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
        return { login, ok: false, reason: `Keycloak отказал: ${text || 'без текста'}` };
      }
    }
    if (!(onStand() && await signedIn())) throw new Error(`за ${timeoutMs / 1000} с сессия oidc.user:* на стенде не появилась`);
    // Чья сессия: вход сохраняется только под той учёткой, что входила — иначе громкий отказ.
    step = 'сверить учётку сессии';
    const raw = await page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.includes('oidc.user:')); return k ? localStorage.getItem(k) : null; });
    const who = sessionLogin(raw);
    if (!sameLogin(login, who)) return { login, ok: false, reason: `вошла не та учётка: сессия ${who ?? 'без имени'} вместо ${login} — вход не сохранён` };
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
