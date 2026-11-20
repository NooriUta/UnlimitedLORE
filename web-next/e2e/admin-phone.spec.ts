// Админка 1.18 на телефоне 390×844 (дефекты по снимкам с ryzenai, сборка 8d6098da): страница не уезжала вбок,
// но таблицы были шире экрана и резали колонки — «Агенты» 374→1294 px (HARNESS обрезан), «Флаги и версия»
// 374→525/628, «MCP» 374→510/623 и все 423 отказа одной простынёй (~31 000 px), «Журнал действий» 374→1036,
// фильтры разной высоты; «Доступ к машинам» — harness и проект многоточием; «Словари» — подсказки полей
// обрезаны («новый тип: relea»), последняя колонка одной буквой. На ноутбуке 1280 полоса модулей 552→610:
// вкладка «Админка» обрезана («А…») и уходит под выбор проекта.
//
// Правило проверки одно на все разделы: ни одна колонка, клетка или подсказка не обрезана; таблица не в режиме
// карточек — не шире своего контейнера. Подставная сеть — данные по форме срезов сервера.
import { expect, test, type Page, type Route } from '@playwright/test';

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
const HOUR = 3_600_000;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const HARNESS = [
  { dict_type: 'harness', code: 'claude-code', label_ru: 'Claude Code', label_en: 'Claude Code', sort_order: 1, is_active: true },
  { dict_type: 'harness', code: 'kimi-code', label_ru: 'Kimi Code', label_en: 'Kimi Code', sort_order: 2, is_active: true },
  { dict_type: 'harness', code: 'codex', label_ru: 'Codex', label_en: 'Codex', sort_order: 3, is_active: true },
];
const DICT = [
  ...HARNESS,
  { dict_type: 'area', code: 'core', label_ru: 'Ядро платформы', label_en: 'Platform core', color: 'var(--acc)', icon: 'gears', sort_order: 10, is_active: true, is_extensible: true },
  { dict_type: 'area', code: 'ui', label_ru: 'Интерфейс и оболочка', label_en: 'UI and shell', color: null, icon: null, sort_order: 20, is_active: true, is_extensible: true },
  { dict_type: 'area', code: 'release-engineering', label_ru: 'Выпуск и доставка', label_en: 'Release engineering', color: null, icon: null, sort_order: 30, is_active: false, is_extensible: true },
  { dict_type: 'task_status', code: 'READY_FOR_DEPLOY', label_ru: 'Готово к выкатке', label_en: 'Ready for deploy', sort_order: 40, is_active: true, is_extensible: false },
];
const AGENTS = [
  { actor_id: 'AG-1', name: 'Claude Code (full) на ryzenai', client_id: 'minilore-link-ryzenai-claude-code-full', agent_role: 'full', harness: 'claude-code', machine_id: 'ryzenai', owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'] },
  { actor_id: 'AG-2', name: 'Kimi', client_id: 'lore-mcp-full_kimi', agent_role: 'full', harness: 'kimi-code', machine_id: 'ar-matebook', owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'] },
  { actor_id: 'AG-3', name: 'Codex reviewer', client_id: 'lore-mcp-reviewer_codex', agent_role: 'reviewer', harness: 'codex', machine_id: null, owner_kc_sub: [], owner_display_name: [] },
];
const ACL = [
  {
    actor_id: 'AG-1', client_id: 'minilore-link-ryzenai-claude-code-full', machine_id: 'ryzenai', name: 'ryzenai',
    owner_kc_sub: ['u-ar'], owner_display_name: ['arharaga'],
    grant_kc_subs: ['u-fro', 'u-li'], grant_display_names: ['frolova', 'lisa'],
    grant_roles: ['actor', 'viewer'], grant_projects: [['AIDA/miniLore_serverside', 'NooriUta/UnlimitedLORE'], ['AIDA/miniLore_serverside']],
    grant_harnesses: [['claude-code', 'kimi-code'], ['codex']], grant_granted_by: ['u-ar', 'u-ar'],
    grant_granted_at: ['2026-11-10T10:00:00Z', '2026-11-11T09:00:00Z'],
    projects: ['NooriUta/UnlimitedLORE-preprod-stand', 'AIDA/miniLore_serverside'], harnesses: ['claude-code', 'kimi-code'], can_write: true,
  },
];
const MATRIX = [
  { kc_sub: 'u-ar', display_name: 'arharaga', projects: ['AIDA/miniLORE', 'NooriUta/UnlimitedLORE'], roles: ['owner', 'owner'] },
  { kc_sub: 'u-fro', display_name: 'frolova', projects: ['AIDA/miniLORE'], roles: ['reader'] },
  { kc_sub: 'u-li', display_name: 'lisa', projects: ['AIDA/miniLore_serverside'], roles: ['reader'] },
];
const FLAGS = {
  version: { commit: '8d6098da1c2b3e4f', built_at: '2026-11-19T09:00:00Z', schema_version: 'model b93dbe66805f2a4d' },
  flags: [
    { key: 'lore.scope.enforce.read.projects', value: false, default: false, overridden: false, meaning: 'проектный read-скоуп: агент видит только проекты своих владельцев и грантов машины' },
    { key: 'lore.stats.enabled', value: true, default: true, overridden: false, meaning: 'телеметрия запросов в AgentActionLog' },
    { key: 'lore.model.schema.adapter', value: true, default: false, overridden: true, meaning: 'переходник чтения новой схемы (status_raw → status)' },
  ],
  overridden: 1,
};
const CONN = [
  { caller: 'lore-mcp-full', calls: 26180, last_seen: NOW - 5 * 60_000 },
  { caller: 'lore-mcp-reviewer_codex', calls: 40, last_seen: NOW - 3 * 24 * HOUR },
];
const FAIL = [{ caller: 'lore-mcp-full', failures: 423, last_failure: NOW - HOUR }];
const FAIL_ROWS = Array.from({ length: 423 }, (_, i) => ({
  ts: NOW - i * 60_000, family: i % 2 ? 'task' : 'project-actor', entity_id: `SPRINT_LORE_MODEL_DOCS_TIDY/MIG-${i}`,
  caller: 'lore-mcp-full', status: i % 3 ? 422 : 409, client: 'minilore-link-ryzenai-claude-code-full', machine: 'ryzenai',
}));
const BATCH = 'rb-1762767074000-ab12cd34';
const ACTIONS = {
  rows: Array.from({ length: 12 }, (_, i) => ({
    ts: NOW - i * 1000, family: i % 2 ? 'project-actor' : 'user', entity_id: i % 3 ? `SPRINT_LORE_MODEL_DOCS_TIDY/MIG-0${i}` : BATCH,
    caller: 'minilore-link-ryzenai-claude-code-full', axis: i % 2 ? 'agent' : 'human', status: i % 4 ? 200 : 403,
    batch_id: i % 3 ? null : BATCH, client: 'minilore-link-ryzenai-claude-code-full', machine: 'ryzenai',
  })),
  shown: 12, total: 37, total_state: 'exact', truncated: false, limit: 200, filters: {},
};

async function mockLore(page: Page) {
  await page.route('**/lore/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const slice = p.startsWith('/lore/slice/') ? p.slice('/lore/slice/'.length) : null;
    if (p === '/lore/whoami') return json(route, { auth_enabled: false });
    if (slice === 'dictionary') {
      const type = url.searchParams.get('dict_type');
      return json(route, { rows: type ? DICT.filter(d => d.dict_type === type) : DICT });
    }
    if (slice === 'agent_owners') return json(route, { rows: AGENTS });
    if (slice === 'machine_acl') return json(route, { rows: ACL });
    if (slice === 'role_matrix') return json(route, { rows: MATRIX });
    if (slice === 'mcp_connections') return json(route, { rows: CONN });
    if (slice === 'mcp_failures') return json(route, { rows: FAIL });
    if (slice === 'mcp_failure_rows') return json(route, { rows: FAIL_ROWS });
    if (slice === 'components') return json(route, { rows: [{ component_id: 'C1', area: 'core' }] });
    if (slice) return json(route, { rows: [] });
    if (p === '/lore/admin/flags') return json(route, FLAGS);
    if (p === '/lore/version') return json(route, { commit: '8d6098da', release: 'v1.18.0-rc' });
    if (p === '/lore/admin/actions') return json(route, ACTIONS);
    if (p === '/lore/kc/denials') return json(route, { rows: [], total: 0 });
    if (p === '/lore/kc/agent-orphans') return json(route, { orphans: [] });
    return json(route, {});
  });
}

interface Clip { what: string; scroll: number; client: number }

/**
 * Обрезка в разделе: таблица шире контейнера (если она не карточками), клетка/текст с многоточием или скрытым
 * переполнением, подсказка поля шире поля. Возвращает список нарушений словами.
 */
async function clipped(page: Page): Promise<{ problems: string[]; tables: number; cards: number }> {
  return page.evaluate(() => {
    const root = document.querySelector('.sk-shell__main') ?? document.body;
    const problems: string[] = [];
    const name = (el: Element) => {
      const id = el.getAttribute('data-testid');
      const txt = (el.textContent ?? '').trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} «${txt}»`;
    };
    let tables = 0, cards = 0;
    for (const t of Array.from(root.querySelectorAll('table'))) {
      if ((t as HTMLElement).offsetParent === null) continue;
      tables++;
      const card = getComputedStyle(t).display !== 'table';
      if (card) { cards++; continue; }
      const box = t.parentElement!;
      if (t.getBoundingClientRect().width > box.getBoundingClientRect().width + 1)
        problems.push(`таблица шире контейнера: ${Math.round(t.getBoundingClientRect().width)} > ${Math.round(box.getBoundingClientRect().width)} ${name(t)}`);
    }
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      // невидимое и «только для чтеца экрана» (sk-sr: клип 1×1) — не обрезка
      if (el.offsetParent === null || el.clientWidth <= 1 || el.closest('.sk-sr')) continue;
      const cs = getComputedStyle(el);
      const hides = cs.textOverflow === 'ellipsis'
        || (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && (el.children.length === 0 || el.tagName === 'TD' || el.tagName === 'TH');
      if (hides && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? '').trim())
        problems.push(`обрезано: ${el.scrollWidth} > ${el.clientWidth} ${name(el)}`);
      // клетка таблицы, вылезшая за правый край экрана
      if ((el.tagName === 'TD' || el.tagName === 'TH') && el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        problems.push(`клетка за краем экрана: ${name(el)}`);
    }
    const ctx = document.createElement('canvas').getContext('2d')!;
    for (const inp of Array.from(root.querySelectorAll<HTMLInputElement>('input[placeholder]'))) {
      if (inp.offsetParent === null || !inp.placeholder || inp.value) continue;
      const cs = getComputedStyle(inp);
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const need = ctx.measureText(inp.placeholder).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      if (need > inp.clientWidth + 1) problems.push(`подсказка обрезана: «${inp.placeholder}» ${Math.round(need)} > ${inp.clientWidth}`);
    }
    return { problems, tables, cards };
  });
}

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const SECTIONS: { sec: string; ready: string; shot?: boolean; noTables?: boolean }[] = [
  { sec: 'adm-agents', ready: '[data-testid="adm-agents"]', shot: true },
  { sec: 'adm-machines', ready: 'text=ryzenai', noTables: true },
  { sec: 'adm-dicts', ready: 'table', shot: true },
  { sec: 'adm-flags', ready: 'table' },
  { sec: 'adm-mcp', ready: '[data-testid="adm-mcp-fails-table"]', shot: true },
  { sec: 'adm-log', ready: '[data-testid="adm-log"]' },
];

for (const s of SECTIONS) {
  test(`телефон 390: «${s.sec}» — ничего не обрезано, таблицы не шире контейнера`, async ({ page }, info) => {
    test.skip(info.project.name !== 'admin-390', 'только телефон 390×844');
    await mockLore(page);
    await page.goto(`/?mod=admin&sec=${s.sec}`);
    await expect(page.locator(s.ready).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(300);
    const shotDir = process.env.ADMIN_SHOTS;
    if (shotDir) await page.screenshot({ path: `${shotDir}/${s.sec}-390.png`, fullPage: true });
    const r = await clipped(page);
    expect(r.problems, `${s.sec}: обрезка на 390`).toEqual([]);
    if (!s.noTables) expect(r.tables, `${s.sec}: таблицы нашлись`).toBeGreaterThan(0);
    expect(await pageOverflow(page), 'горизонтальная прокрутка страницы').toBeLessThanOrEqual(0);
  });
}

test('телефон 390: «MCP» — отказы постранично, первые 50 и «Показать ещё»', async ({ page }, info) => {
  test.skip(info.project.name !== 'admin-390', 'только телефон 390×844');
  await mockLore(page);
  await page.goto('/?mod=admin&sec=adm-mcp');
  const table = page.getByTestId('adm-mcp-fails-table');
  await expect(table).toBeVisible({ timeout: 20_000 });
  await expect(table.locator('tbody tr')).toHaveCount(50);
  await page.getByTestId('adm-mcp-fails-more').click();
  await expect(table.locator('tbody tr')).toHaveCount(100);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(h, 'страница не простыня на десятки тысяч пикселей').toBeLessThan(31_000);
});

test('телефон 390: «Журнал действий» — фильтры одной высоты', async ({ page }, info) => {
  test.skip(info.project.name !== 'admin-390', 'только телефон 390×844');
  await mockLore(page);
  await page.goto('/?mod=admin&sec=adm-log');
  await expect(page.locator('.adm-filters')).toBeVisible({ timeout: 20_000 });
  const hs = await page.locator('.adm-filters .adm-input, .adm-filters .adm-select').evaluateAll(
    els => els.map(e => Math.round(e.getBoundingClientRect().height)));
  expect(hs.length).toBeGreaterThan(4);
  expect(new Set(hs).size, `высоты полей: ${hs.join(', ')}`).toBe(1);
});

// У владелицы на 1280 полоса получала 552 px при 610 нужных (выбор проекта и поиск справа шире, чем в подставной
// сети), поэтому проверяем и уже: 1280, 1100 и 900 — на любой ширине шапки вкладка «Админка» целиком и не под соседом.
test('ноутбук 1280 и уже: полоса модулей — вкладка «Админка» целиком и не под выбором проекта', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'только ноутбук');
  await mockLore(page);
  for (const width of [1280, 1100, 900]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?mod=admin&sec=adm-home');
    const tab = page.locator('.sk-shell__mods .sk-shell__mod[aria-current="page"]');
    await expect(tab).toHaveCount(1, { timeout: 20_000 });
    await expect(tab).toHaveAttribute('aria-label', /Админ/);
    await page.waitForTimeout(300);
    const shotDir = process.env.ADMIN_SHOTS;
    if (shotDir) await page.screenshot({ path: `${shotDir}/modules-${width}.png`, clip: { x: 0, y: 0, width, height: 60 } });
    const r = await tab.evaluate(el => {
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.right - 4, b.top + b.height / 2);
      const label = el.querySelector('.sk-shell__label') as HTMLElement | null;
      return {
        covered: !top || !el.contains(top),
        labelShown: !!label && label.getBoundingClientRect().width > 0 && label.scrollWidth <= label.clientWidth + 1,
      };
    });
    expect(r.labelShown, `${width}: подпись текущего модуля видна целиком`).toBe(true);
    expect(r.covered, `${width}: вкладку перекрывает соседний элемент или она за краем полосы`).toBe(false);
    const strip = await page.locator('.sk-shell__mods').evaluate(n => ({ sw: n.scrollWidth, cw: n.clientWidth }));
    expect(strip.sw, `${width}: полоса модулей шире своего места ${JSON.stringify(strip)}`).toBeLessThanOrEqual(strip.cw + 1);
  }
});
