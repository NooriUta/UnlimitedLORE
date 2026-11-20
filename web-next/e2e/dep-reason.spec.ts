// Зависимость с причиной в паспорте спринта (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13). Владелица 20.11.2026: причина у
// «зависит от» обязательна. Форма «Привязать» у связи с признаком модели reason_required открывает kit ReasonDialog
// (тот же, что «Применить…» экрана «Модель»); причина уходит в запись связи. Подставная сеть: фасад записи с
// признаком, варианты выбора из срезов спринтов и вех, запись связи ловится и проверяется.
import { expect, test } from '@playwright/test';

const S = 'SPRINT_DEP_A';
const RECORD = {
  contract: 'lore.record/1',
  record: { type: 'sprint', id: S, title: 'Спринт с зависимостями', status: 'planned', version: '2026-11-20T10:00:00Z' },
  values: { title: 'Спринт с зависимостями' },
  parts: [],
  links: [{ rel: 'DEPENDS_ON', dir: 'out', id: 'SPRINT_DEP_B', type: 'sprint', title: 'Схема базы', status: 'planned', fromKind: 'sprint', toKind: 'sprint', values: { kind: 'blocks', reason: 'без схемы нечего писать' } }],
  perms: { can_edit: true, can_status: true, can_create: true, status_next: [], reason: null },
  facts: {},
  schema: { type: 'sprint', label: 'Спринт', label_key: 'rec.sprint', icon: 'sprint',
    fields: [{ key: 'title', label: 'Название', label_key: 'f.title', kind: 'text', group: 'head', required: true, editable: false }],
    layout: {},
    relations: [
      { key: 'dependsOn', label: 'Зависит от', relation: 'association', rel: 'DEPENDS_ON', dir: 'out', target_type: 'any', place: 'link_tab', manageable: true,
        props: [{ key: 'kind', label: 'Вид', dict: 'dependency_kind' }, { key: 'reason', label: 'Причина' }], reason_required: true, target_types: ['task', 'phase', 'sprint', 'milestone'] },
      { key: 'blocks', label: 'От неё зависят', relation: 'association', rel: 'DEPENDS_ON', dir: 'in', target_type: 'any', place: 'link_tab', manageable: true,
        props: [{ key: 'kind', label: 'Вид', dict: 'dependency_kind' }, { key: 'reason', label: 'Причина' }], reason_required: true, target_types: ['task', 'phase', 'sprint', 'milestone'] },
    ] },
  meta: { facade: 'server', sources: {}, data_state: [] },
};

for (const w of [1280, 390]) {
  test(`паспорт спринта: зависимость добавляется с причиной на ${w}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1280', 'ширину задаёт сам тест');
    await page.setViewportSize({ width: w, height: 900 });
    const posted: unknown[] = [];
    await page.route('**/lore/**', async route => {
      const req = route.request();
      const p = new URL(req.url()).pathname;
      if (req.method() === 'POST' && p.endsWith('/relation')) {
        posted.push({ path: p, body: req.postDataJSON() });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, outcome: 'created' }) });
      }
      const name = p.split('/').pop();
      const body = p.includes('/record/') && p.includes(S) ? RECORD
        : name === 'sprints' ? { rows: [{ sprint_id: S, name: 'Спринт с зависимостями', status_raw: '📋 PLANNED' }, { sprint_id: 'SPRINT_DEP_C', name: 'Доступ к базе', status_raw: '📋 PLANNED' }] }
        : name === 'milestones' ? { rows: [{ milestone_id: 'M-DEP', label: 'Доступ открыт' }] }
        : p.includes('/slice/') ? { rows: [] } : {};
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`/?mod=forseti&sec=sprint&open=${S}&place=full&tab=rel:association`);
    // положительный контроль: связь с видом и причиной уже показана
    await expect(page.getByText('без схемы нечего писать')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('searchbox', { name: 'Привязать: Зависит от' }).fill('Доступ');
    await page.getByRole('button', { name: 'Привязать SPRINT_DEP_C' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Привязать' });
    await expect(confirm).toBeDisabled();
    expect(posted).toHaveLength(0);
    await dialog.getByTestId('kit-reason-input').fill('нужен доступ к базе до миграции');
    await expect(confirm).toBeEnabled();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `e2e/.results/dep-reason-dialog-${w}.png` });
    await confirm.click();
    await expect(dialog).toBeHidden();
    expect(posted).toEqual([{ path: `/lore/record/sprint/${S}/relation`,
      body: { rel: 'DEPENDS_ON', dir: 'out', target: 'SPRINT_DEP_C', action: 'add', reason: 'нужен доступ к базе до миграции' } }]);
  });
}
