// «+ Новая» по всем типам на стенде под TEST-учётками (SPRINT_LORE_ADMIN_POLISH/AP-06).
//
// CR-00 — опись: какие типы модели стенда (/lore/model) человек может создать в v2, а какие нет.
//   Путь создания ищется на самом стенде под test-sa (у super-admin прав больше всех): паспорт `_new`
//   разрешает создать ИЛИ в разделе типа видна кнопка «+ Новая». Список типов без пути — в отчёт
//   (create-coverage.md / .json в папке отчёта и строкой в журнале).
// CR-<тип> — для каждого типа с формой в приложении, под каждой TEST-учёткой: право сервера (`_new`
//   perms.can_create), кнопка в списке (видна ⇔ право), форма черновика, пустой черновик не сохраняется
//   и причина названа. Исход ячейки — src/standSmoke/createCoverage.ts (проверено vitest-ом).
//
// ЗАПИСИ НЕТ. Стенд — только чтение (writeGuard.ts: *.seidrstudio.pro и ci-server), а пути удаления
// записей в UI нет (AP-01): заведённая TEST-запись осталась бы на стенде. Сохранение, появление в
// списке и SCD2-версия — «не выполнено» до решения владелицы (копия с заглушкой входа или удаление).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, type Browser, type Page } from '@playwright/test';
import { authFileFor, RBAC_ACCOUNTS } from '../../src/standSmoke/rbac.ts';
import {
  createCoverage, judgeCreateCell, modelTypesOf, renderCells, STAND_CREATE_TYPES, typeOutcome, type CreateCell, type CreateProbe,
} from '../../src/standSmoke/createCoverage.ts';
import { REPORT_DIR } from './paths.ts';
import { asAccount, requireStandUrl, shot } from './stand.ts';

const AUTH_DIR = process.env.LORE_STAND_AUTH_DIR?.trim() || 'e2e/stand/.auth';
const ACCOUNTS = Object.values(RBAC_ACCOUNTS);

interface Api { status: number | null; body: Record<string, unknown> | null }

/** GET токеном вошедшей учётки (токен берёт приложение); сеть упала — status null. */
async function get(page: Page, path: string): Promise<Api> {
  return page.evaluate(async path => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const token = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    try {
      const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      let body: Record<string, unknown> | null = null;
      try { body = (await res.json()) as Record<string, unknown>; } catch { /* не JSON */ }
      return { status: res.status, body };
    } catch { return { status: null, body: null }; }
  }, path);
}

interface Perm { status: number | null; can: boolean; reason: string | null }

async function permOf(page: Page, type: string): Promise<Perm> {
  const r = await get(page, `/lore/record/${encodeURIComponent(type)}/_new`);
  const perms = (r.body?.perms ?? {}) as { can_create?: unknown; reason?: unknown };
  return { status: r.status, can: perms.can_create === true, reason: typeof perms.reason === 'string' ? perms.reason : null };
}

/** Раздел типа открыт; видна ли «+ Новая» (право спрашивается после списка — ждём до `waitMs`). */
/**
 * Типы, которые заводятся в админке, а не в общем списке (D-2026-MIG-REPOSITORY-ORGANIZATION; владелица 21.11:
 * «в админке кроме организации…»). Смоук 39054: CR-organization искал «+ Новая» на ?sec=organization — там
 * её нет по замыслу, кнопка на экране админки «Организации» (тот же адрес, что у M5).
 */
const ADMIN_CREATE_SECTION: Record<string, string> = { organization: 'adm-orgs' };

async function newButtonVisible(page: Page, type: string, waitMs: number): Promise<boolean> {
  await page.goto(ADMIN_CREATE_SECTION[type] ? `/?mod=admin&sec=${ADMIN_CREATE_SECTION[type]}` : `/?sec=${encodeURIComponent(type)}`);
  const btn = page.locator('[data-testid="list-new"]');
  try { await btn.first().waitFor({ state: 'visible', timeout: waitMs }); return true; } catch { return false; }
}

async function withAccount<T>(browser: Browser, account: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const page = await asAccount(browser, authFileFor(AUTH_DIR, account), account);
  try { return await fn(page); } finally {
    await shot(page, test.info()).catch(() => undefined);
    await page.context().close().catch(() => undefined);
  }
}

function writeReport(name: string, data: unknown, md: string): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(resolve(REPORT_DIR, `${name}.json`), JSON.stringify(data, null, 2));
  writeFileSync(resolve(REPORT_DIR, `${name}.md`), md);
}

test.beforeEach(() => requireStandUrl());

test('CR-00 Опись: типы модели стенда с путём создания и без него (test-sa)', async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const sa = RBAC_ACCOUNTS.superAdmin;
  test.skip(!existsSync(authFileFor(AUTH_DIR, sa)), `нет сохранённого входа ${sa} — опись не выполнена`);
  await withAccount(browser, sa, async page => {
    const model = await get(page, '/lore/model');
    test.skip(model.status !== 200, `/lore/model ответил ${model.status ?? 'сетью'} — опись не выполнена`);
    const { types, create } = modelTypesOf(model.body);
    const found: string[] = [];
    const rows: { type: string; perm: Perm; button: boolean }[] = [];
    for (const type of [...new Set(types)].sort()) {
      const perm = await permOf(page, type);
      const button = await newButtonVisible(page, type, perm.can ? 15_000 : 4_000);
      rows.push({ type, perm, button });
      if (perm.can || button) found.push(type);
    }
    const cov = createCoverage(types, found, create);
    const md = [
      '# «+ Новая» на стенде — опись типов (CR-00)', '',
      `Стенд: ${process.env.LORE_STAND_URL}; учётка ${sa}.`, '',
      `- С путём создания (${cov.withPath.length}): ${cov.withPath.join(', ') || '—'}`,
      `- **Без пути создания (${cov.withoutPath.length}): ${cov.withoutPath.join(', ') || '—'}**`,
      `- Блок create модели есть, а пути на стенде нет: ${cov.modelOnly.join(', ') || '—'}`,
      `- Форма есть в коде ветки, но не на стенде: ${STAND_CREATE_TYPES.filter(t => !found.includes(t)).join(', ') || '—'}`, '',
      '| тип | /_new | can_create | кнопка |', '|---|---|---|---|',
      ...rows.map(r => `| ${r.type} | ${r.perm.status ?? 'сеть'} | ${r.perm.can ? 'да' : 'нет'} | ${r.button ? 'да' : 'нет'} |`),
    ].join('\n');
    writeReport('create-coverage', { coverage: cov, rows }, md);
    console.log(`[create] CR-00 с путём: ${cov.withPath.join(', ')}`);
    console.log(`[create] CR-00 БЕЗ пути создания: ${cov.withoutPath.join(', ')}`);
    test.info().annotations.push({ type: 'without-path', description: cov.withoutPath.join(', ') });
  });
});

for (const type of STAND_CREATE_TYPES) {
  test(`CR-${type} «+ Новая» для типа ${type} под TEST-учётками: право, кнопка, форма, валидация (без записи)`, async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const cells: CreateCell[] = [];
    for (const account of ACCOUNTS) {
      if (!existsSync(authFileFor(AUTH_DIR, account))) {
        cells.push({ account, outcome: 'not-run', reason: 'нет сохранённого входа' });
        continue;
      }
      const probe = await withAccount(browser, account, async (page): Promise<CreateProbe> => {
        const me = await get(page, '/lore/whoami');
        const perm = await permOf(page, type);
        const p: CreateProbe = {
          account, seerRole: typeof me.body?.seer_role === 'string' ? me.body.seer_role : null,
          permStatus: perm.status, canCreate: perm.can, permReason: perm.reason, buttonVisible: false,
        };
        if (perm.status !== 200) return p;
        p.buttonVisible = await newButtonVisible(page, type, perm.can ? 20_000 : 6_000);
        if (!p.buttonVisible || !perm.can) return p;
        await page.locator('[data-testid="list-new"]').first().click();
        const form = page.locator('[data-testid="kit-record-create"]');
        p.formOpened = await form.first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false);
        if (!p.formOpened) return p;
        const save = form.locator('.sk-rec-create__foot button[type="submit"]');
        p.saveBlocked = await save.isDisabled().catch(() => false);
        p.whyText = (await form.locator('.sk-rec-create__why').first().innerText({ timeout: 2_000 }).catch(() => '')).trim();
        return p;
      });
      cells.push(judgeCreateCell(probe));
    }
    const line = renderCells(cells);
    console.log(`[create] CR-${type}: ${line}`);
    writeReport(`CR-${type}`, cells, `# CR-${type}\n\n${cells.map(c => `- ${c.account}: ${c.outcome} — ${c.reason}`).join('\n')}\n`);
    const outcome = typeOutcome(cells);
    test.skip(outcome === 'not-run', `ни одна учётка не проверена: ${line}`);
    if (outcome === 'fail') throw new Error(`CR-${type}: ${cells.filter(c => c.outcome === 'fail').map(c => `${c.account}: ${c.reason}`).join('; ')}`);
  });
}
