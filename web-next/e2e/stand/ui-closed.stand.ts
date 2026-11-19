// UI-регресс по задачам, закрытым 11–16.11.2026 (владелица 16.11.2026: «возьми задачи закрытые
// за последние 5 дней … если они обновились к ui — и тоже сделай тесты»). Один сценарий — один
// экран; в заголовке — задачи, чью правку он сторожит (код сценария — первое слово заголовка).
// Сценарии только читают стенд: ничего не создают и не применяют.
//
// Общие признаки поломки (screenHealth) — каждый закрывал свою задачу:
//   «Часть сведений не загрузилась»  — SPRINT_UXR_POLISH_UAT_1113/PU-02, SPRINT_UXR_MOBILE_POLISH/MP2-07-PASSPORT-SLICE-FAIL
//   «BAD_PARAMS» в счётчиках фасетов — SPRINT_UXR_POLISH_UAT_1113/PU-01
//   «вне словаря: ∅»                 — SPRINT_UXR_POLISH_V11717/P-05-CARDS-EMPTY-STATUS
//   сырой JSON {"…": в тексте        — SPRINT_UXR_POLISH_UAT_1113/PU-16
//   «Failed to fetch dynamically imported module» — SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STALE-CHUNK
//   горизонтальная прокрутка страницы на телефоне — SPRINT_UXR_MOBILE_POLISH/MP2-*, S4-MOBILE-EDGE
import { expect, test, type Page } from '@playwright/test';
import { openStand, requireStand, shot, keepLoginFresh, textOf } from './stand.ts';

test.beforeEach(() => requireStand());
// Вход не истекает посреди прогона (E2E-STAND, прогон 9033): до создания страницы сценария.
test.beforeEach(({ browser }) => keepLoginFresh(browser));
test.afterEach(async ({ page }, info) => shot(page, info));

const BROKEN: [RegExp, string][] = [
  [/Часть сведений не загрузилась/, 'PU-02 / MP2-07: «Часть сведений не загрузилась»'],
  [/BAD_PARAMS/, 'PU-01: BAD_PARAMS в интерфейсе'],
  [/вне словаря: ∅/, 'P-05: «вне словаря: ∅»'],
  [/\{"[a-z_]+":/, 'PU-16: сырой JSON в тексте'],
  [/Failed to fetch dynamically imported module/, 'S4-STALE-CHUNK: старый чанк после выкатки'],
];

/** Текст экрана без признаков известных поломок; на телефоне — без прокрутки вбок. */
async function screenHealth(page: Page, where: string, mobile = false): Promise<void> {
  // Без тел записей и кода: спеки и доки законно упоминают BAD_PARAMS и показывают JSON.
  const text = await page.evaluate(() => {
    const c = document.body.cloneNode(true) as HTMLElement;
    c.querySelectorAll('pre, code, textarea, [class*="prose"], [class*="Prose"], [class*="sk-md"], iframe').forEach(n => n.remove());
    return c.innerText;
  }).catch(() => '');
  const hits = BROKEN.filter(([re]) => re.test(text)).map(([, why]) => why);
  expect(hits, `${where}: признаки закрытых поломок`).toEqual([]);
  if (mobile) {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `${where}: страница шире экрана телефона на ${over}px`).toBeLessThanOrEqual(1);
  }
}

/** Экран раздела дошёл до строк или до честного «пусто» — не до ошибки. */
async function openSection(page: Page, sec: string): Promise<string | null> {
  const rows = page.locator('[data-record-id]');
  const settled = rows.or(page.locator('.sk-empty, [role="alert"]'));
  await openStand(page, `/?sec=${sec}`, settled);
  await expect(settled.first(), `раздел ${sec} загрузился`).toBeVisible({ timeout: 30_000 });
  const alert = page.locator('[role="alert"]').filter({ hasText: /ошибк|не удалось|error|403|500/i });
  const alertText = await textOf(alert);
  expect(await alert.count(), `раздел ${sec}: ошибка вместо списка — ${alertText}`).toBe(0);
  return rows.first().getAttribute('data-record-id').catch(() => null);
}

const SECTIONS = ['news', 'sprint', 'task', 'milestone', 'release', 'quality_gate', 'adr', 'decision', 'spec', 'doc',
  'runbook', 'question', 'product', 'feature', 'actor', 'pain', 'gain', 'job', 'project', 'component', 'tech'] as const;

test('UI-LISTS Все разделы v2 открываются без ошибок (S4-V2-SECTIONS, S4-MODEL-PASSPORT-LIST, S4-PRODUCTS-NODE, PU-01, PU-07, P-04, P-05, MINI-04)', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const failed: string[] = [];
  for (const sec of SECTIONS.filter(s => s !== 'news')) {
    try {
      await openSection(page, sec);
      await screenHealth(page, `раздел ${sec}`);
    } catch (e) {
      failed.push(`${sec}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  expect(failed, 'разделы с ошибкой').toEqual([]);
});

const PASSPORTS = ['sprint', 'task', 'adr', 'decision', 'spec', 'doc', 'milestone', 'release'] as const;

test('UI-PASSPORT Паспорта записей открываются целиком (PU-02, PU-16, MP2-07, P-01, S4-29, S4-36, S4-37, S5-DOC-PASSPORT, MINI-06)', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const failed: string[] = [];
  for (const sec of PASSPORTS) {
    try {
      const id = await openSection(page, sec);
      if (!id) continue; // пустой раздел — паспорт открыть нечем
      await openStand(page, `/?sec=${sec}&open=${encodeURIComponent(id)}`, page.getByText(id, { exact: false }));
      await expect(page.getByText(id, { exact: false }).first(), `паспорт ${sec} ${id} показан`).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500); // дать догрузиться блокам паспорта
      await screenHealth(page, `паспорт ${sec} ${id}`);
    } catch (e) {
      failed.push(`${sec}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  expect(failed, 'паспорта с ошибкой').toEqual([]);
});

test('UI-SPRINT-TASKS Задачи спринта: статусы не «?», фазы названием (PU-22, PU-23, PU-24, PU-25, S4-SPRINT-TASKS-CONTROLS, S9-07, AP-04)', async ({ page }) => {
  await openSection(page, 'sprint');
  // Итоги x/y догружаются после строк: читать сразу — значит видеть «…» у всех (ryzenai 19.11.2026: сразу 50 из 50
  // «загружается», через 2 с у 41 строки больше трёх задач). Ждём, как pickSprintWithTasks в S1.
  await page.waitForFunction(() => {
    const ps = [...document.querySelectorAll('[data-record-id] [data-progress]')];
    return ps.length > 0 && ps.every(p => p.getAttribute('data-progress') !== 'loading');
  }, undefined, { timeout: 30_000 }).catch(() => undefined);
  // Спринт с задачами — по счётчику x/y в строке (как S1).
  const id = await page.evaluate(() => {
    for (const r of document.querySelectorAll<HTMLElement>('[data-record-id]')) {
      const m = /(\d+)\s*\/\s*(\d+)/.exec(r.innerText);
      if (m && Number(m[2]) > 3) return r.getAttribute('data-record-id');
    }
    return null;
  });
  expect(id, 'в списке есть спринт с задачами').not.toBeNull();
  const rows = page.locator('tr[data-task]');
  await openStand(page, `/?sec=sprint&open=${encodeURIComponent(id!)}&tab=tasks&tview=table`, rows);
  await expect(rows.first(), `${id}: строки задач`).toBeVisible({ timeout: 30_000 });
  const bad = await rows.evaluateAll(trs => trs.map(tr => tr.innerText.replace(/\s+/g, ' ').trim())
    .filter(t => /(^|\s)\?(\s|$)/.test(t)).slice(0, 5));
  expect(bad, `${id}: строки со статусом «?» (PU-25)`).toEqual([]);
  const phaseIds = await page.locator('body').innerText().then(t => (t.match(/\bPHASE_[A-Z0-9_]+\b/g) ?? []).slice(0, 5));
  expect(phaseIds, `${id}: фаза показана кодом, а не названием (PU-22)`).toEqual([]);
  await screenHealth(page, `задачи спринта ${id}`);
});

const ADMIN = ['adm-home', 'adm-wiz', 'adm-agents', 'adm-machines', 'adm-who', 'adm-projects', 'adm-roles', 'adm-dicts',
  'adm-rules', 'adm-tidy', 'adm-flags', 'adm-mcp', 'adm-log'] as const;

test('UI-ADMIN Все разделы админки открываются под super-admin (S7B-01…31, S7B-ACL-*, PU-03, PU-04, PU-05, PU-13, PU-20, AP-08, AP-09)', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const failed: string[] = [];
  for (const sec of ADMIN) {
    try {
      const body = page.locator('main, [role="main"]').first();
      await openStand(page, `/?mod=admin&sec=${sec}`, page.locator('[data-testid^="adm-"]'));
      await expect(page.locator('[data-testid^="adm-"]').first(), `${sec} показан`).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      // «Нет прав» — экран kit Forbidden (AdminForbidden, data-state="forbidden"). Прежняя проверка смотрела на
      // adm-home-403 — это карточка «отказы 403 за сутки» (Home403Card), она есть на главной всегда и валила сценарий
      // под любой ролью (ryzenai 19.11.2026: видна и под admin, и под superadmin).
      expect(await page.locator('[data-state="forbidden"]').count(), `${sec}: «нет прав» у super-admin`).toBe(0);
      const text = await body.innerText().catch(() => '');
      if (sec === 'adm-log') expect(text, 'PU-03: «время не записано» в журнале').not.toMatch(/время не записано/);
      expect(text, 'AP-09: «Вы не опознаны» у заведённой учётки').not.toMatch(/Вы не опознаны/);
      await screenHealth(page, sec);
    } catch (e) {
      failed.push(`${sec}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  expect(failed, 'разделы админки с ошибкой').toEqual([]);
});

/**
 * Личные настройки — в меню аватара (S4-02): раздел «Настройки» на них только указывает. Выбор в них — kit Segmented,
 * это role="group" с подписью, а не radiogroup: прежний поиск radiogroup не совпадал ни с чем (ryzenai 19.11.2026:
 * 0 совпадений и на странице, и в открытом меню).
 */
async function openPersonalSettings(page: Page): Promise<void> {
  const avatar = page.locator('button[aria-haspopup="dialog"]').last();
  await openStand(page, '/?sec=settings&view=settings', avatar);
  await avatar.click();
  await expect(page.getByRole('group', { name: 'Тема' }), 'личные настройки показаны (выбор темы)').toBeVisible({ timeout: 30_000 });
}

test('UI-SETTINGS Настройки открываются целиком, без поломок (S4-16, P-08, P-10, PU-08)', async ({ page }) => {
  await openPersonalSettings(page);
  await screenHealth(page, 'настройки');
});

test.describe('телефон 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('UI-MOBILE Списки, паспорт, новости и настройки не шире экрана (MP2-01…14, S4-MOBILE-EDGE, S4-MOBILE-COMPARE, S9-04, P-09, AP-SESSION-BANNER-NARROW)', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    const failed: string[] = [];
    const check = async (where: string, fn: () => Promise<void>) => {
      try { await fn(); await screenHealth(page, where, true); } catch (e) { failed.push(`${where}: ${(e as Error).message.split('\n')[0]}`); }
    };
    let sprint: string | null = null;
    await check('спринты', async () => { sprint = await openSection(page, 'sprint'); });
    await check('задачи', async () => { await openSection(page, 'task'); });
    await check('новости', async () => {
      const rows = page.locator('[data-testid^="news-row-"]');
      await openStand(page, '/news', rows, 45_000);
      await expect(rows.first(), 'лента на телефоне').toBeVisible({ timeout: 15_000 });
    });
    await check('паспорт спринта', async () => {
      if (!sprint) return;
      // Код — в шапке паспорта: первое совпадение по тексту на телефоне — плашка строки списка под паспортом
      // (sk-pill--id, ширина 0), она невидима, хотя паспорт открыт (ryzenai 19.11.2026).
      const head = page.locator('[data-testid="kit-rec-head"]');
      await openStand(page, `/?sec=sprint&open=${encodeURIComponent(sprint)}`, head);
      await expect(head.first(), 'шапка паспорта спринта').toContainText(sprint, { timeout: 30_000 });
    });
    await check('настройки', async () => { await openPersonalSettings(page); });
    expect(failed, 'экраны телефона с поломкой').toEqual([]);
  });
});
