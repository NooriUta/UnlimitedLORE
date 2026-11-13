// «Цель к сроку» в паспорте спринта (SPRINT_UXR_POLISH_UAT_1113/PU-10): вердикт в строке,
// график по кнопке. Подставная сеть; первый шаг — строка burn-down нарисована (положительный контроль).
import { expect, test } from '@playwright/test';

const S = 'SPRINT_UXR_TARGET';
const SPRINT = { sprint_id: S, name: 'Спринт с целью', status_raw: '🔄 IN PROGRESS', planned_start_date: '2026-11-01', planned_end_date: '2026-11-04', valid_from: '2026-11-01T00:00:00Z', context_md: 'текст' };
const created = ['A', 'B', 'C', 'D'].map(k => ({ task_uid: `${S}/${k}`, valid_from: '2026-11-01T00:00:00Z' }));
const done = [{ task_uid: `${S}/A`, valid_from: '2026-11-03T00:00:00Z' }];

test('паспорт спринта: вердикт и график «Цель к сроку»', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'одна проекция');
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    const name = p.split('/').pop();
    const body = name === 'task_created_dates' ? { rows: created }
      : name === 'task_done_dates' ? { rows: done }
      : name === 'sprints' ? { rows: [SPRINT] }
      : name === 'tasks_of_sprint' ? { rows: ['A', 'B', 'C', 'D'].map((k, i) => ({ task_uid: `${S}/${k}`, task_id: k, title: 'Задача ' + k, order_index: i, phase_uid: null, status_raw: k === 'A' ? '✅ DONE' : '📋 PLANNED', effort_days: 1 })) }
      : p.includes('/slice/') ? { rows: [] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`/?sec=sprint&open=${S}&tab=tasks`);
  const line = page.getByTestId('sprint-burn');
  await expect(line).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('sprint-burn-verdict')).toContainText('Не успеваем');
  await page.getByRole('button', { name: /Цель к сроку/ }).click();
  await expect(page.locator('[data-series="deadline"]')).toHaveCount(1);
  await expect(page.locator('[data-series="forecast"]')).toHaveCount(1);
  await page.screenshot({ path: 'e2e/.results/sprint-target.png', clip: { x: 806, y: 90, width: 474, height: 460 } });
});
