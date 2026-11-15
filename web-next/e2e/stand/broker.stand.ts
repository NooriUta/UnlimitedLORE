// Брокеринг seer → omilore на стенде (просьба CICDGitHub 15.11.2026, SPRINT_LORE_OWN_HOST/OH-13,
// D-2026-BROKERING-LINK-BY-EMAIL-TEST-STANDS): первый вход через «Войти через AIDA» должен
// молча связать учётку по почте — без экранов «учётка уже существует / подтвердите /
// обновите профиль», под той же тестовой учёткой и с её прежними ролями.
//
// Учётка и пароль В seerPreprod — из LORE_STAND_BROKER_ACCOUNTS_JSON (тот же формат, что
// LORE_STAND_ACCOUNTS_JSON; только TEST*; берётся первая по алфавиту). Нет секрета —
// «не выполнен». Сохранённые входы здесь не годятся: они сделаны прямым входом.
import { expect, test, type Page } from '@playwright/test';
import { parseStandAccounts } from './accounts.ts';
import { requireStandUrl, shot } from './stand.ts';

const where = (page: Page): string => { try { const u = new URL(page.url()); return `${u.host}${u.pathname}`; } catch { return '?'; } };

/**
 * Вход через провайдера seer. Возвращает null при успехе или текст стопа (экран KC / причина).
 * Кнопка — #social-seer (замер KC omilorePreprod 15.11.2026: <a id="social-seer">«Войти через
 * AIDA»</a>). Признак успеха — сессия oidc.user:* на домене стенда, как у автологина: строк
 * ленты у учётки без проектов нет, а «Новости» живут без оболочки (прогоны 7847/7853).
 */
async function brokerLogin(page: Page, login: string, password: string): Promise<string | null> {
  const stand = new URL(process.env.LORE_STAND_URL!.trim()).host;
  await page.goto('/news');
  const provider = page.locator('#social-seer');
  try { await provider.waitFor({ timeout: 45_000 }); } catch {
    return `кнопки «Войти через AIDA» (#social-seer) нет; страница ${where(page)} «${(await page.title().catch(() => '')).slice(0, 60)}»`;
  }
  await provider.click();
  try { await page.locator('#username').waitFor({ timeout: 45_000 }); } catch {
    return `формы входа seerPreprod нет; страница ${where(page)}`;
  }
  await page.locator('#username').fill(login);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  const kcStop = page.locator('#kc-page-title, .kc-feedback-text, #input-error');
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const onStand = (() => { try { return new URL(page.url()).host === stand; } catch { return false; } })();
    if (onStand && await page.evaluate(() => Object.keys(localStorage).some(k => k.includes('oidc.user:'))).catch(() => false)) return null;
    if (!onStand && await kcStop.first().isVisible().catch(() => false)) {
      return `экран KC: «${((await kcStop.first().textContent()) ?? '').trim().replace(/\s+/g, ' ').slice(0, 120)}» (${where(page)})`;
    }
    await page.waitForTimeout(500);
  }
  return `за 45 с сессии на стенде нет; страница ${where(page)}`;
}

async function whoami(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const token = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    const r = await fetch('/lore/whoami', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return r.ok ? r.json() : { status: r.status };
  });
}

const pickAccount = () => {
  const { accounts, error } = parseStandAccounts(process.env.LORE_STAND_BROKER_ACCOUNTS_JSON);
  test.skip(!!error, error ?? '');
  test.skip(accounts.length === 0, 'LORE_STAND_BROKER_ACCOUNTS_JSON не задан — пароля test-* в seerPreprod нет, проба не выполнена');
  return accounts[0];
};

test.beforeEach(() => requireStandUrl());

for (const [id, title] of [['BR-01', 'первый вход'], ['BR-02', 'повторный вход']] as const) {
  test(`${id} Брокеринг «Войти через AIDA» (${title}): сразу лента, та же учётка с ролями`, async ({ browser }, info) => {
    const acc = pickAccount();
    const ctx = await browser.newContext({ baseURL: process.env.LORE_STAND_URL!.trim() });
    const page = await ctx.newPage();
    try {
      const stop = await brokerLogin(page, acc.login, acc.password);
      expect(stop, `промежуточный экран Keycloak: «${stop}»`).toBeNull();
      const me = await whoami(page);
      info.annotations.push({ type: 'account', description: acc.login });
      expect(me.kind, 'вошёл человек').toBe('human');
      const identity = (me.identity ?? {}) as { name?: string; display_name?: string };
      expect([identity.name, identity.display_name], 'та же тестовая учётка, а не новый пользователь').toContain(acc.login);
      expect(((me.project_roles ?? []) as unknown[]).length, 'прежние проектные роли на месте').toBeGreaterThan(0);
    } finally {
      await shot(page, info);
      await ctx.close();
    }
  });
}
