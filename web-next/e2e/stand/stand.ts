// Общие шаги смоука стенда (E2E-STAND): допуск к запуску, открытие страницы с
// распознаванием протухшего входа, скрин в отчёт.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { preflightFromEnv, readBuild, REPORT_DIR } from './paths.ts';
import { isForbiddenStandUrl } from '../../src/standSmoke/summary.ts';
import { parseStandAccounts } from './accounts.ts';
import { standLogin } from './login.ts';
import { storedSecondsLeft } from './tokens.ts';

/** Запас до конца входа, при котором смоук входит заново (сценарий идёт до 8 мин). */
export const RELOGIN_LEFT_SEC = 600;

/**
 * Вход смоука не истекает посреди прогона (E2E-STAND, прогон 9033 19.11.2026: набор шёл 31 мин на входе,
 * который живёт ~15; всё после истечения падало «Вы не опознаны» / «нет прав» — не поломка стенда).
 * Перед сценарием: если входу осталось меньше RELOGIN_LEFT_SEC, входим той же учёткой заново и пишем файл.
 * Учёток нет (локальный прогон) — ничего не делаем: истёкший вход сценарий честно назовёт «не выполнен».
 */
export async function keepLoginFresh(browser: Browser, file = process.env.LORE_STAND_STORAGE_STATE?.trim(), login?: string): Promise<void> {
  const url = process.env.LORE_STAND_URL?.trim();
  if (!file || !url || !existsSync(file)) return;
  let left: number | null;
  try { left = storedSecondsLeft(JSON.parse(readFileSync(file, 'utf8')), Date.now() / 1000); } catch { return; }
  if (left === null || left > RELOGIN_LEFT_SEC) return;
  const { accounts } = parseStandAccounts(process.env.LORE_STAND_ACCOUNTS_JSON);
  const a = login ? accounts.find(x => x.login === login)
    : accounts.find(x => x.login === 'test-sa') ?? accounts.find(x => x.login === 'test-admin');
  if (!a) return;
  const r = await standLogin(browser, url, a.login, a.password, file);
  console.log(r.ok ? `[stand] вход ${a.login} обновлён: оставалось ${Math.round(left)} с` : `[stand] вход ${a.login} обновить не удалось: ${r.reason}`);
}

/** Нет входа / адреса / адрес ведёт на прод — сценарий «не выполнен», с причиной. */
export function requireStand(): void {
  const pre = preflightFromEnv();
  test.skip(!pre.run, pre.reason ?? 'смоук не выполнен');
  const build = readBuild();
  test.skip(build?.refused === true, build?.error ?? 'адрес ведёт на прод — смоук на проде запрещён');
}

/**
 * Допуск для прогонов под несколькими учётками (RBAC): нужен только адрес стенда —
 * вход у каждой учётки свой (asAccount). Прод отвергается, как и в смоуке.
 */
export function requireStandUrl(): void {
  const url = process.env.LORE_STAND_URL?.trim();
  test.skip(!url, 'LORE_STAND_URL не задан — прогон не выполнен');
  test.skip(isForbiddenStandUrl(url!), 'адрес прода — прогон на проде запрещён');
  const build = readBuild();
  test.skip(build?.refused === true, build?.error ?? 'адрес ведёт на прод — прогон на проде запрещён');
}

/**
 * Новая вкладка с сохранённым входом учётки `account` (файл делает человек, README).
 * Нет файла — сценарий «не выполнен» с именем учётки; вход истёк — тоже «не выполнен».
 */
export async function asAccount(browser: Browser, file: string, account: string): Promise<Page> {
  test.skip(!existsSync(file), `нет сохранённого входа ${account} (${file}) — сценарий не выполнен`);
  await keepLoginFresh(browser, file, account);
  const baseURL = process.env.LORE_STAND_URL!.trim();
  const ctx = await browser.newContext({ storageState: file, baseURL, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await openStand(page, '/news', page.locator('[data-testid^="news-row-"]'));
  return page;
}

const EXPIRED ='сохранённый вход истёк или отвергнут (страница входа) — обновить LORE_STAND_STORAGE_STATE; смоук не выполнен';

/**
 * Открыть страницу стенда и дождаться `target`. Если вместо приложения показали вход
 * (свой экран входа или уход на Keycloak) — сценарий «не выполнен», а не упавший:
 * проверить стенд мы не смогли, и это не то же самое, что «стенд сломан».
 */
export async function openStand(page: Page, path: string, target: Locator, timeoutMs = 30_000): Promise<void> {
  await page.goto(path);
  const base = new URL(test.info().project.use.baseURL ?? process.env.LORE_STAND_URL ?? page.url()).origin;
  const auth = page.locator('.sk-auth__card');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (new URL(page.url()).origin !== base) test.skip(true, EXPIRED);
    if (await auth.isVisible().catch(() => false)) test.skip(true, EXPIRED);
    if (await target.first().isVisible().catch(() => false)) return;
    if (Date.now() > deadline) return; // дальше сценарий упадёт на своём expect с понятным текстом
    await page.waitForTimeout(250);
  }
}

/** Скрин сценария в папку отчёта + вложение `screenshot` (его подхватывает репортёр). */
export async function shot(page: Page, info: TestInfo): Promise<void> {
  if (page.url() === 'about:blank') return;
  const id = info.title.split(' ')[0];
  const path = resolve(REPORT_DIR, `${id}.png`);
  try {
    await page.screenshot({ path, fullPage: false });
    await info.attach('screenshot', { path, contentType: 'image/png' });
  } catch { /* страница закрыта — без скрина, сценарий от этого не меняется */ }
}

export interface SprintPick { id: string; done: number; total: number }

/**
 * Спринт, у которого СПИСОК говорит «задачи есть» (x/y, y > 0). Именно на таком
 * ловится регресс «список говорит, что задач нет, а они есть» (откат #1005): итог
 * строки и раскрытие строки должны сходиться.
 */
export async function pickSprintWithTasks(page: Page): Promise<SprintPick | null> {
  // Итоги догружаются после списка: ждём, пока ни одна ячейка не «…».
  await page.waitForFunction(() => {
    const ps = [...document.querySelectorAll('[data-record-id] [data-progress]')];
    return ps.length > 0 && ps.every(p => p.getAttribute('data-progress') !== 'loading');
  }, undefined, { timeout: 30_000 }).catch(() => undefined);
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-record-id]')]
      .filter(r => !r.closest('[data-nested]') && !r.hasAttribute('data-child-of'));
    for (const r of rows) {
      const m = /(\d+)\s*\/\s*(\d+)/.exec(r.querySelector('[data-progress] .sk-progress__text')?.textContent ?? '');
      if (m && Number(m[2]) > 0 && r.querySelector('.sk-list__xbtn')) {
        return { id: r.getAttribute('data-record-id')!, done: Number(m[1]), total: Number(m[2]) };
      }
    }
    return null;
  });
}

export const attr = (v: string) => JSON.stringify(v);

/**
 * Текст первого совпадения для подписи к проверке — сразу '', если совпадений нет. Подпись к expect
 * вычисляется ДО проверки: текст первого совпадения (innerText без срока) при 0 совпадений ждал бы элемент до конца
 * сценария (прогоны 37831, 19.11.2026: UI-LISTS 24 мин, RFD-AP01 6 мин).
 */
export async function textOf(loc: Locator, max = 160): Promise<string> {
  if ((await loc.count().catch(() => 0)) === 0) return '';
  return (await loc.first().innerText({ timeout: 2_000 }).catch(() => '')).replace(/s+/g, ' ').trim().slice(0, max);
}
