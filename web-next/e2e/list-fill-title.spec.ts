// SPRINT_UXR_S13_KIT4/K4-PASSPORT-NO-LIST-RESET — смоук стенда 22.11.2026, RFD2-K4RESET: «прокрутка списка не
// сброшена при смене паспорта — Expected < 40, Received 307». Тот же сценарий, что rfd2.stand.ts:423, но на подставной
// сети с моделью, где у заголовка показ «fill + многоточие» (shared/fixtures/model.json, как на стенде).
//
// Корень: заголовок записи — кнопка (display: -webkit-box) внутри nowrap-обёртки многоточия. У атомарного блока «…» нет,
// и кнопка вырастала до полной длины строки (382–637 px в ячейке 65 px): текст рубился посреди слова, а кнопка торчала за
// край списка. Щелчок Playwright (и фокус с клавиатуры) «показывает, если не видно» — центрирует её и сдвигает прокрутку
// списка под паспортом на ~300 px. Щелчок мышью по видимой середине ячейки прокрутку не трогал — значит, двигал не код
// списка, а вылезшая за ячейку кнопка.
//
//   cd web-next && npx playwright test e2e/list-fill-title.spec.ts --project=desktop-1280
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const WORDS = ['Методика', 'переноса:', 'модель', '«сейчас»,', 'модель', '«будет»', 'и', 'модель', 'сопоставления', 'между', 'ними', '—', 'правила', 'поля,', 'смена', 'слоя,', 'сверка'];
const rows = Array.from({ length: 300 }, (_, i) => ({
  spec_id: `SPEC-LORE-${String(i + 1).padStart(3, '0')}`,
  title: `${WORDS.slice(0, 6 + (i % 11)).join(' ')} ${i + 1}`,
  status: ['proposed', 'accepted', 'active'][i % 3],
  component_id: ['LORE', 'MINILORE', 'INFRA'][i % 3],
  version: '0.1',
  changed_at: new Date(Date.UTC(2026, 10, 22) - i * 3_600_000).toISOString(),
}));

function rec(id: string): unknown {
  const body = JSON.parse(readFileSync(new URL('../../shared/fixtures/record-adr.json', import.meta.url), 'utf8'));
  body.record = { ...body.record, type: 'spec', id, title: `Спека ${id}` };
  body.values = { ...body.values, title: `Спека ${id}` };
  body.schema = { ...body.schema, type: 'spec' };
  return body;
}

async function mock(page: Page) {
  const model = JSON.parse(readFileSync(new URL('../../shared/fixtures/model.json', import.meta.url), 'utf8'));
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/lore/whoami') return json(route, { auth_enabled: false, seer_role: 'superadmin' });
    if (p === '/lore/model') return json(route, model);
    if (p === '/lore/slice/specs') return json(route, { rows });
    if (p.startsWith('/lore/record/spec/')) return json(route, rec(decodeURIComponent(p.split('/').pop()!)));
    if (p.includes('/slice/')) return json(route, { rows: [] });
    return json(route, {});
  });
}

test('заголовок «fill + многоточие» не шире ячейки; смена паспорта не двигает прокрутку списка (RFD2-K4RESET)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'десктопная проекция');
  await page.setViewportSize({ width: 1440, height: 900 });
  await mock(page);
  const titles = page.locator('.sk-list .sk-list__title--btn');
  await page.goto('/?sec=spec');
  await expect(titles.first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.sk-list__td[data-w="fill"]').first(), 'показ колонок пришёл из модели').toBeAttached();

  const backdropTop = () => page.evaluate(() => document.querySelector('.sk-dock__backdrop')?.scrollTop ?? -1);
  const openParam = () => new URL(page.url()).searchParams.get('open');
  const visibleId = (not: string | null) => page.evaluate(skip => {
    const scope = document.querySelector('.sk-dock__backdrop');
    const box = scope ? scope.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    for (const b of document.querySelectorAll<HTMLElement>('.sk-list .sk-list__title--btn')) {
      const r = b.getBoundingClientRect();
      const id = b.closest('[data-record-id]')?.getAttribute('data-record-id');
      if (id && id !== skip && r.top > box.top + 60 && r.bottom < box.bottom - 60) return id;
    }
    return null;
  }, not);
  const titleOf = (id: string) => page.locator(`.sk-list [data-record-id=${JSON.stringify(id)}] .sk-list__title--btn`).first();

  await page.mouse.move(400, 500);
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
  const a = await visibleId(null);
  expect(a).not.toBeNull();
  await titleOf(a!).click();
  await expect(page.locator('[data-testid="kit-rec-dock"]')).toBeVisible({ timeout: 15_000 });
  await expect.poll(openParam).toBe(a);

  // Кнопка заголовка не вылезает за свою ячейку (в доке ячейка «fill» узкая).
  const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.sk-dock__backdrop .sk-list__title--btn')]
    .map(b => b.getBoundingClientRect().right - (b.closest('td')?.getBoundingClientRect().right ?? Infinity))
    .reduce((m, d) => Math.max(m, d), -Infinity));
  expect.soft(overflow, 'кнопка заголовка выступает за правый край ячейки, px').toBeLessThanOrEqual(1);

  const before = await backdropTop();
  const b = await visibleId(a);
  expect(b).not.toBeNull();
  await titleOf(b!).click();
  await expect.poll(openParam).toBe(b);
  await expect(page.locator('[data-testid="kit-rec-loaded"]').first()).toBeVisible({ timeout: 30_000 });
  expect(Math.abs((await backdropTop()) - before), 'прокрутка списка не сброшена при смене паспорта').toBeLessThan(40);
  await expect(titleOf(b!)).toBeInViewport();
});
