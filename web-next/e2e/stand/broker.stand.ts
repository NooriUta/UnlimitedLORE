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

async function brokerLogin(page: Page, login: string, password: string): Promise<string | null> {
  await page.goto('/news');
  const provider = page.locator('a[id^="social-"], a:has-text("AIDA")').first();
  await provider.waitFor({ timeout: 45_000 });
  await provider.click();
  await page.locator('#username').waitFor({ timeout: 45_000 });
  await page.locator('#username').fill(login);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  const app = page.locator('[data-testid^="news-row-"]');
  const kcTitle = page.locator('#kc-page-title, .kc-feedback-text, #input-error');
  await app.or(kcTitle).first().waitFor({ timeout: 45_000 });
  if (await app.first().isVisible().catch(() => false)) return null;
  return ((await kcTitle.first().textContent()) ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
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
