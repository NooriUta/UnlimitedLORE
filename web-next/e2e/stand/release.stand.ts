// Проверки выпуска на стенде — шлагбаум между препродом и продом (SPRINT_UXR_S11_TEST_OPT/E2E-STAND).
//
// Владелица 19.11.2026, канал: «если playwright работает пиши все тесты на него и включай в проверку между
// преподом и продом для новой версии». Каждый пункт её ручной проверки стенда — сценарий здесь; PR
// preprod → main не сливается, пока смоук на его голове не зелёный (release-guard.yml).
// Сценарии только читают стенд. Первое слово заголовка — код сценария в отчёте (R1…).
import { expect, test } from '@playwright/test';
import { openStand, pickSprintWithTasks, requireStand, shot } from './stand.ts';

test.beforeEach(() => requireStand());
test.afterEach(async ({ page }, info) => shot(page, info));

test('R1 Стенд на v2: оболочка v2, а не v1 (SPRINT_UXR_S8_SWITCH/S8-02)', async ({ page }) => {
  // v1 снят со стенда (#1590): главный адрес обязан отдавать оболочку v2 — её узнаём по каркасу kit.
  await openStand(page, '/?sec=sprint', page.locator('[data-record-id]'));
  await expect(page.locator('.sk-shell').first(), 'на стенде оболочка v2 (kit .sk-shell)').toBeVisible({ timeout: 30_000 });
});

test('R2 Телефон 412: вкладки паспорта не наезжают на фильтры, карточки не шире экрана (MP2-PASSPORT-TABS-OVERLAP)', async ({ page }) => {
  // Спринт выбираем на ширине компьютера: на телефоне колонки «x/y» в списке нет, выбрать не по чему.
  await openStand(page, '/?sec=sprint', page.locator('[data-record-id]'));
  const sprint = await pickSprintWithTasks(page);
  expect(sprint, 'в списке есть спринт с задачами').not.toBeNull();
  await page.setViewportSize({ width: 412, height: 915 });
  // Вкладка «Задачи» паспорта — как её открывает человек (вид списка задач паспорт выбирает сам).
  const rows = page.locator('.sk-rec-reader .sk-cards__card, .sk-rec-reader [data-task]');
  await openStand(page, `/?sec=sprint&open=${encodeURIComponent(sprint!.id)}&tab=tasks`, rows);
  await expect(rows.first(), `${sprint!.id}: на вкладке «Задачи» есть задачи`).toBeVisible({ timeout: 30_000 });
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    // Карточки (если вид — карточки) и сама панель паспорта не шире экрана; таблица скроллится внутри себя.
    const boxes = [...document.querySelectorAll<HTMLElement>('.sk-rec-reader .sk-cards__card, .sk-rec-reader, .sk-dock__panel')];
    const right = Math.max(...boxes.map(c => c.getBoundingClientRect().right));
    const tabs = document.querySelector<HTMLElement>('.sk-rec-reader [role="tablist"], .sk-dock__panel [role="tablist"]')?.getBoundingClientRect() ?? null;
    const filt = [...document.querySelectorAll<HTMLElement>('[data-testid="kit-ctlbar"]')].pop()?.getBoundingClientRect() ?? null;
    const overlap = !!(tabs && filt && tabs.bottom > filt.top + 1 && tabs.top < filt.bottom - 1);
    return { vw, right, overlap, scrollX: document.documentElement.scrollWidth - innerWidth };
  });
  expect(m.right, `правый край панели паспорта и карточек ${m.right} px — не шире экрана ${m.vw} px`).toBeLessThanOrEqual(m.vw + 1);
  expect(m.overlap, 'полоса вкладок паспорта не лежит поверх фильтров').toBe(false);
  expect(m.scrollX, 'у страницы нет горизонтальной прокрутки').toBeLessThanOrEqual(1);
});

test('R3 Поле-ссылка в карточке — ссылка на свою запись (#1595)', async ({ page }) => {
  const links = page.locator('.sk-cards__card a.sk-list__reflink');
  await openStand(page, '/?sec=task&lv=cards', links);
  await expect(links.first(), 'в карточках задач поле-ссылка (спринт) — ссылка').toBeVisible({ timeout: 30_000 });
  const href = await links.first().getAttribute('href');
  expect(href ?? '', 'ссылка ведёт на запись (open=…)').toMatch(/open=/);
});
