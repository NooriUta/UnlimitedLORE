// Проверка задач в 🚀 READY FOR DEPLOY на стенде (владелица 16.11.2026: «напиши тесты по
// задачам в статусе rfd через playwright»). По сценарию на задачу; код сценария — первое слово
// заголовка (RFD-…), задача — в заголовке парой спринт/код. Сценарии ничего не пишут: удаление
// тестового агента проверяется планом (dry_run), без «Применить».
//
// Не здесь: SPRINT_LORE_OWN_HOST/OH-22 (LLM на ryzenai — инфраструктура, без UI LORE) и
// SPRINT_VIZ_EMBED/VE-8 (проверка подписи — внутри Völva, её репо и её CI).
import { expect, test, type Page } from '@playwright/test';
import { openStand, requireStand, shot } from './stand.ts';

test.beforeEach(() => requireStand());
test.afterEach(async ({ page }, info) => shot(page, info));

/** GET под токеном сохранённого входа — как S0. */
async function apiGet(page: Page, path: string): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async (p) => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const token = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    const res = await fetch(p, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    return { status: res.status, body: await res.json().catch(() => null) };
  }, path);
}

const TEST_AGENT_CLIENT = /^lore-mcp-[a-z_-]+_Test[A-Za-z0-9._-]*$/;

test('RFD-AP01 Агенты: «Удалить» есть только у тестового агента и показывает план (SPRINT_LORE_ADMIN_POLISH/AP-01)', async ({ page }) => {
  const table = page.locator('[data-testid="adm-agents"]');
  await openStand(page, '/?mod=admin&sec=adm-agents', table);
  await expect(table, 'таблица агентов показана').toBeVisible({ timeout: 30_000 });
  const { status, body } = await apiGet(page, '/lore/slice/agent_owners?limit=1000');
  expect(status, 'срез agent_owners').toBe(200);
  const rows = ((body as { rows?: { actor_id?: string; client_id?: string | null }[] })?.rows ?? [])
    .filter(r => r.actor_id && r.client_id);
  const testRow = rows.find(r => TEST_AGENT_CLIENT.test(r.client_id!));
  const realRow = rows.find(r => !TEST_AGENT_CLIENT.test(r.client_id!) && r.client_id!.startsWith('lore-mcp-'));
  expect(realRow, 'есть реальный агент lore-mcp-* для отрицательной проверки').toBeTruthy();

  // Реальный агент: раскрыть — кнопки удаления нет («реальные — только выключить»).
  await page.locator(`[data-testid="adm-agent-proj-btn-${realRow!.actor_id}"]`).click();
  await expect(page.locator(`[data-testid="adm-agent-row-${realRow!.actor_id}"]`)).toBeVisible({ timeout: 15_000 });
  expect(await page.locator(`[data-testid="adm-testdel-open-${realRow!.client_id}"]`).count(),
    `у реального ${realRow!.client_id} нет «Удалить»`).toBe(0);

  test.skip(!testRow, 'тестового агента lore-mcp-*_Test* на стенде нет — положительная часть не выполнена');
  await page.locator(`[data-testid="adm-agent-proj-btn-${testRow!.actor_id}"]`).click();
  const open = page.locator(`[data-testid="adm-testdel-open-${testRow!.client_id}"]`);
  await expect(open, `у тестового ${testRow!.client_id} есть «Удалить»`).toBeVisible({ timeout: 15_000 });
  await open.click();
  const panel = page.locator(`[data-testid="adm-testdel-${testRow!.client_id}"]`);
  const err = panel.locator('[data-testid="adm-testdel-error"]');
  const plan = panel.locator('[data-testid^="kit-diff-row-"], [data-testid="adm-testdel-blocked"]');
  await expect(err.or(plan).first(), 'план удаления (dry_run) показан').toBeVisible({ timeout: 30_000 });
  expect(await err.count(), `план не построился: ${await err.first().innerText().catch(() => '')}`).toBe(0);
  // Не применяем: закрыть.
  await panel.locator('[data-testid="adm-testdel-close"]').click().catch(() => {});
});

test('RFD-VE7 Встройка Völva отвечает родителю: высота или ошибка с кодом, не молчание (SPRINT_VIZ_EMBED/VE-7)', async ({ page }) => {
  const box = page.locator('[data-embed-state]');
  await openStand(page, '/?sec=sprint&lav=volva', box.or(page.locator('[data-record-id]')));
  // Вид Völva есть только при charts.layer=volva и настроенной подписи; иначе проверять нечего.
  test.skip(!(await box.first().isVisible().catch(() => false)) && await page.locator('[data-record-id]').first().isVisible().catch(() => false),
    'вида Völva на стенде нет (charts.layer ≠ volva или подпись не настроена) — не выполнен');
  // Ждём конечное состояние: ready (рамка) / embed_error / silent / прочее.
  await expect.poll(async () => box.first().getAttribute('data-embed-state'), { timeout: 40_000 })
    .not.toBe('loading');
  const st = await box.first().getAttribute('data-embed-state');
  expect(st, 'встройка не молчит (silent = за 15 с ни frame, ни error)').not.toBe('silent');
  if (st === 'ready') {
    // Высота по metabase.frame: рамка выросла с minHeight 320 (приёмка 14.11 — осталась 320).
    await expect.poll(async () => box.locator('iframe').evaluate(f => (f as HTMLIFrameElement).getBoundingClientRect().height),
      { timeout: 20_000, message: 'высота рамки пришла от встройки (≠ 320)' }).not.toBe(320);
  } else {
    expect(st, 'ошибка встройки показана с кодом (embed_error), а не общим сбоем').toBe('embed_error');
    await expect(box.locator('.sk-embed__code')).toBeVisible();
  }
});

test('RFD-QGBR Гейт «ветки ↔ статусы задач» запускался и отдал метрики веток (SPRINT_QG_REBUILD/QG-BRANCH-TASK-STATUS)', async ({ page }) => {
  await openStand(page, '/news', page.locator('[data-testid^="news-row-"]'));
  const { status, body } = await apiGet(page, '/lore/slice/routine_last_run?routine_name=qg-branch-task-status');
  expect(status, 'срез routine_last_run').toBe(200);
  const rows = (body as { rows?: Record<string, unknown>[] })?.rows ?? [];
  expect(rows.length, 'у рутины qg-branch-task-status есть запуск (первый — через минуту после старта)').toBeGreaterThan(0);
  const metrics = await apiGet(page, '/lore/slice/qg_metrics_latest');
  const keys = ((metrics.body as { rows?: { routine_name?: string; metric_key?: string }[] })?.rows ?? [])
    .filter(m => m.routine_name === 'qg-branch-task-status').map(m => m.metric_key ?? '');
  expect(keys.join(', '), 'метрики branch_<ветка>_tasks_not_accepted записаны').toMatch(/branch_[a-z]+_tasks_not_accepted/);
});
