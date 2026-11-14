// Общие шаги смоука стенда (E2E-STAND): допуск к запуску, открытие страницы с
// распознаванием протухшего входа, скрин в отчёт.
import { resolve } from 'node:path';
import { test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { preflightFromEnv, readBuild, REPORT_DIR } from './paths.ts';

/** Нет входа / адреса / адрес ведёт на прод — сценарий «не выполнен», с причиной. */
export function requireStand(): void {
  const pre = preflightFromEnv();
  test.skip(!pre.run, pre.reason ?? 'смоук не выполнен');
  const build = readBuild();
  test.skip(build?.refused === true, build?.error ?? 'адрес ведёт на прод — смоук на проде запрещён');
}

const EXPIRED = 'сохранённый вход истёк или отвергнут (страница входа) — обновить LORE_STAND_STORAGE_STATE; смоук не выполнен';

/**
 * Открыть страницу стенда и дождаться `target`. Если вместо приложения показали вход
 * (свой экран входа или уход на Keycloak) — сценарий «не выполнен», а не упавший:
 * проверить стенд мы не смогли, и это не то же самое, что «стенд сломан».
 */
export async function openStand(page: Page, path: string, target: Locator, timeoutMs = 30_000): Promise<void> {
  await page.goto(path);
  const base = new URL(test.info().project.use.baseURL ?? page.url()).origin;
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
