// Применение миграции «релиз → репозиторий» ([[adr:ADR-LORE-066]], фаза А) на ПРЕПРОДЕ — тестовой учёткой стенда.
//
// Слово владелицы 28.11.2026: «да применяй» (после отчёта сухого прогона RR-DRY: 627 релизов, 0 спорных).
// Пишет в базу (POST …/migrate?apply=true), поэтому идёт ТОЛЬКО при ручном запуске lore-stand-e2e с
// input rr_apply=preprod и только на адресе препрода. В обычном прогоне стенда (push в preprod) — пропуск.
// Повтор безопасен: стоящие рёбра не дублируются (IF NOT EXISTS). Отчёт — артефакт и сводка в журнал.
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { requireStand, keepLoginFresh } from './stand.ts';

const PREPROD = 'https://preprod.lore.odal.seidrstudio.pro';
const armed = process.env.LORE_RR_APPLY === 'preprod';

test.beforeEach(() => requireStand());
test.beforeEach(({ browser }) => keepLoginFresh(browser));

test('RR-APPLY: применить «релиз → репозиторий» на препроде (только по флагу rr_apply=preprod)', async ({ page }) => {
  test.skip(!armed, 'запись только по ручному запуску с rr_apply=preprod (слово владелицы)');
  const stand = (process.env.LORE_STAND_URL ?? '').replace(/\/+$/, '');
  expect(stand, 'применение — только на препроде').toBe(PREPROD);
  await page.goto('/news');
  const r = await page.evaluate(async () => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const token = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    try {
      const res = await fetch('/lore/release-repository/migrate?apply=true', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      return { status: res.status, text: await res.text() };
    } catch (e) { return { status: 0, text: String(e) }; }
  });
  mkdirSync('e2e/.stand-report', { recursive: true });
  writeFileSync('e2e/.stand-report/release-repository-apply.json', r.text);
  console.log(`[RR-APPLY] HTTP ${r.status}`);
  expect([200, 207], `POST …/migrate?apply=true: ${r.text.slice(0, 300)}`).toContain(r.status);
  const out = JSON.parse(r.text) as Record<string, unknown>;
  console.log('[RR-APPLY] ' + ['resolved', 'created', 'failed', 'already', 'unresolved_count', 'unchecked_count'].map(k => `${k}=${String(out[k])}`).join(' '));
  if (Array.isArray(out.failed_items) && out.failed_items.length) console.log('[RR-APPLY] failed_items ' + JSON.stringify(out.failed_items).slice(0, 4000));
  expect(out.dry_run, 'POST apply=true — запись, не сухой прогон').toBe(false);
});
