// Раскладка оболочки v2 в настоящем браузере (дефект прода v1.17.7, владелица 09.11:
// «левое меню глючит и разворачивается во всю стену»).
//
// Корень: ручка границы меню (#1039) стоит в сетке явно — row 1 / col 1, в той же
// клетке, что колонка меню. Явно размещённые элементы сетка ставит первыми, и
// автоматически размещённое меню уезжало в колонку 2 (1fr, во всю ширину), а
// содержимое — в строку 2 узкой первой колонки. jsdom раскладку не считает,
// поэтому unit-тесты kit этого не видели.
import { test, expect } from '@playwright/test';

// Колонка меню есть только на широком экране; у владелицы окно 2080px — берём 1920.
test.use({ viewport: { width: 1920, height: 1080 } });

test('меню слева, содержимое справа в той же строке и шире меню', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'один прогон на широком окне');
  await page.goto('/');
  const side = page.locator('.sk-shell__side');
  const main = page.locator('.sk-shell__main');
  await expect(side).toBeVisible();
  const s = await side.boundingBox();
  const m = await main.boundingBox();
  expect(s && m).toBeTruthy();
  // Меню — узкая колонка у левого края, а не вся ширина окна.
  expect(s!.x).toBeLessThan(5);
  expect(s!.width).toBeLessThan(450);
  // Содержимое — справа от меню, в той же строке, и занимает остаток ширины.
  expect(m!.x).toBeGreaterThanOrEqual(s!.x + s!.width - 1);
  expect(Math.abs(m!.y - s!.y)).toBeLessThan(2);
  expect(m!.width).toBeGreaterThan(600);
  // Ручка границы — на правом крае меню.
  const r = await page.locator('.sk-shell__resize').boundingBox();
  expect(r).toBeTruthy();
  expect(Math.abs(r!.x + r!.width - (s!.x + s!.width))).toBeLessThan(8);
});
