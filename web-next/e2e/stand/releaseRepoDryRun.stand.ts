// Сухой прогон миграции «релиз → репозиторий» ([[adr:ADR-LORE-066]], фаза А) на стенде — тестовой учёткой.
//
// Почему здесь, а не в migrate-release-of-repository.yml: эндпоинт открыт только admin, а у служебной учётки
// проб CD роли admin нет (28.11: 403). Владелица: «у тебя есть для этого тестовые учётки» — учётки стенда test-*
// уже входят как super-admin (AP-02). Сценарий ТОЛЬКО читает: GET …/migrate — план, в базу не пишет ничего.
// Применение (POST apply=true) — не здесь и только по слову владелицы.
//
// Отчёт: e2e/.stand-report/release-repository-dryrun.json (артефакт stand-report) и сводка в журнал джобы.
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { requireStand, keepLoginFresh } from './stand.ts';

test.beforeEach(() => requireStand());
test.beforeEach(({ browser }) => keepLoginFresh(browser));

test('RR-DRY: сухой прогон «релиз → репозиторий» читается и не пишет', async ({ page }) => {
  await page.goto('/news');
  const r = await page.evaluate(async () => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const token = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    try {
      const res = await fetch('/lore/release-repository/migrate', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      return { status: res.status, text: await res.text() };
    } catch (e) { return { status: 0, text: String(e) }; }
  });
  mkdirSync('e2e/.stand-report', { recursive: true });
  writeFileSync('e2e/.stand-report/release-repository-dryrun.json', r.text);
  expect(r.status, `GET /lore/release-repository/migrate: ${r.text.slice(0, 300)}`).toBe(200);
  const plan = JSON.parse(r.text) as Record<string, unknown>;
  expect(plan.dry_run, 'GET — только сухой прогон').toBe(true);
  const keys = ['resolved', 'to_create', 'already', 'ambiguous_count', 'unresolved_count', 'unchecked_count', 'missing_in_lore_count'];
  console.log('[RR-DRY] ' + keys.map(k => `${k}=${String(plan[k])}`).join(' '));
  console.log('[RR-DRY] by_basis ' + JSON.stringify(plan.by_basis));
  console.log('[RR-DRY] by_repository ' + JSON.stringify(plan.by_repository));
  for (const k of ['ambiguous', 'unresolved', 'unchecked', 'missing_in_lore', 'unchecked_repositories'])
    console.log(`[RR-DRY] ${k} ` + JSON.stringify(plan[k]));
});
