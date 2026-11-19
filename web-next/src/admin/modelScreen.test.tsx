// @vitest-environment jsdom
// SPRINT_LORE_MODEL_AS_CONFIG/MC-06 — экран «Модель»: правка → дифф → «Проверить» (dry_run, 422 с
// причиной) → «Применить…» с обязательным «что и зачем»; откат — новая версия с содержимым старой.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { ModelScreen } from './ModelScreen';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const DOC = {
  format: 'lore-model/1',
  types: [
    { type: 'product', label: 'Продукт', icon: 'bullseye', fields: [
      { key: 'title', label: 'Название', kind: 'text', group: 'head', required: true },
      { key: 'code', label: 'Код', kind: 'text', group: 'head' },
    ] },
  ],
  nav: [{ id: 'product', labelKey: 'shell.grp.product', items: [{ section: 'product' }] }],
  audience: { product: 'everywhere' },
};
const OLD = { ...DOC, audience: { product: 'admin' } };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Put { body: Record<string, unknown> }
function fake(o: { put?: (b: Record<string, unknown>) => Response; cfgStatus?: number; schema?: unknown } = {}) {
  const puts: Put[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/lore/model/config' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      puts.push({ body });
      return o.put ? o.put(body) : json({ ok: true, dry_run: body.dry_run === true, hash: 'h2', changed: true, types_changed: ['product'] });
    }
    if (url === '/lore/model/config') return o.cfgStatus ? json({ error: 'FORBIDDEN', detail: 'нужна роль admin' }, o.cfgStatus)
      : json({ config_id: 'lore-model', source: 'lore', hash: 'h1', seed_drift: false, warning: null, content: JSON.stringify(DOC) });
    if (url === '/lore/model/config/11111111-1111-1111-1111-111111111111') return json({ state_uid: 'x', content: JSON.stringify(OLD) });
    if (url === '/lore/model') return json(o.schema ?? { missing: ['types'] });
    if (url.startsWith('/lore/slice/model_config_history')) return json({ rows: [
      { state_uid: '22222222-2222-2222-2222-222222222222', valid_from: '2026-11-19T10:00:00Z', valid_to: null, content_hash: 'h1', reason: 'семя', changed_by: 'seed' },
      { state_uid: '11111111-1111-1111-1111-111111111111', valid_from: '2026-11-13T18:02:00Z', valid_to: '2026-11-19T10:00:00Z', content_hash: 'h0', reason: 'видимость', changed_by: 'omiloreadmin' },
    ] });
    return json({ error: 'NOPE' }, 404);
  }) as unknown as typeof fetch;
  return { f, puts };
}
const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><ModelScreen fetchImpl={f} /></KitLangProvider>);

describe('экран «Модель»: правка → дифф → проверка → применение', () => {
  it('правка подписи подсвечивает строку и попадает в дифф; «Применить» без «Проверить» недоступно', async () => {
    const { f } = fake();
    mount(f);
    const input = await screen.findByLabelText('Подпись title');
    expect(screen.queryByTestId('adm-model-diff')).toBeNull();
    fireEvent.change(input, { target: { value: 'Имя продукта' } });
    expect(screen.getByTestId('adm-model-field-title').hasAttribute('data-changed')).toBe(true);
    const diff = screen.getByTestId('adm-model-diff');
    expect(diff.textContent).toContain('types[product].fields[title].label');
    expect(diff.textContent).toContain('Имя продукта');
    expect((screen.getByTestId('adm-model-apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('несогласованная правка — 422 с причиной словами сервера, «Применить» закрыто', async () => {
    const { f, puts } = fake({ put: () => json({ error: 'MODEL_INCONSISTENT', problems: ['product.title: поле названия обязано быть в группе head'], written: false }, 422) });
    mount(f);
    fireEvent.change(await screen.findByLabelText('Группа title'), { target: { value: 'props' } });
    fireEvent.click(screen.getByTestId('adm-model-check'));
    const out = await screen.findByText(/обязано быть в группе head/);
    expect(out.closest('[data-state]')?.getAttribute('data-state')).toBe('bad');
    expect(puts[0].body).toMatchObject({ dry_run: true, expected_hash: 'h1' });
    expect((screen.getByTestId('adm-model-apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('согласованная правка: проверка → «Применить…» требует «что и зачем» → PUT с reason', async () => {
    const { f, puts } = fake();
    mount(f);
    fireEvent.change(await screen.findByLabelText('Подпись code'), { target: { value: 'Шифр' } });
    fireEvent.click(screen.getByTestId('adm-model-check'));
    await waitFor(() => expect((screen.getByTestId('adm-model-apply') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('adm-model-apply'));
    const ok = await screen.findByTestId('adm-model-apply-ok');
    expect((ok as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('adm-model-why'), { target: { value: 'подпись кода' } });
    fireEvent.click(ok);
    await waitFor(() => expect(puts.length).toBe(2));
    expect(puts[1].body).toMatchObject({ dry_run: false, reason: 'подпись кода', expected_hash: 'h1' });
    expect(JSON.parse(String(puts[1].body.content)).types[0].fields[1].label).toBe('Шифр');
  });

  it('видимость раздела правится во вкладке «Меню и видимость», вкладка — в адресе', async () => {
    const { f } = fake();
    window.history.replaceState(null, '', '/?mtab=nav');
    mount(f);
    fireEvent.click(await screen.findByTestId('adm-model-aud-product-admin'));
    expect(screen.getByTestId('adm-model-diff').textContent).toContain('audience.product');
  });

  it('403 на чтение модели — «нет прав», а не пустой экран', async () => {
    const { f } = fake({ cfgStatus: 403 });
    mount(f);
    expect(await screen.findByTestId('adm-model-forbidden')).toBeTruthy();
  });

  it('гигиена: схема не прочиталась — «не смогли проверить», а не «замечаний нет»', async () => {
    const { f } = fake();
    window.history.replaceState(null, '', '/?mtab=hyg');
    mount(f);
    const table = await screen.findByTestId('adm-model-hyg');
    expect(within(table).getByText('не смогли проверить')).toBeTruthy();
    expect(screen.queryByTestId('adm-model-hyg-empty')).toBeNull();
  });
});

describe('экран «Модель»: история и откат', () => {
  it('откат: dry_run с содержимым старой версии → окно с обязательной причиной → новая версия', async () => {
    const { f, puts } = fake();
    window.history.replaceState(null, '', '/?mtab=hist');
    mount(f);
    fireEvent.click(await screen.findByTestId('adm-model-rollback-11111111-1111-1111-1111-111111111111'));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0].body).toMatchObject({ dry_run: true, content: JSON.stringify(OLD), expected_hash: 'h1' });
    const ok = await screen.findByTestId('adm-model-apply-ok');
    fireEvent.change(screen.getByTestId('adm-model-why'), { target: { value: 'вернуть видимость' } });
    fireEvent.click(ok);
    await waitFor(() => expect(puts.length).toBe(2));
    expect(puts[1].body).toMatchObject({ dry_run: false, content: JSON.stringify(OLD) });
    expect(String(puts[1].body.reason)).toMatch(/^откат к версии .+: вернуть видимость$/);
  });

  it('дифф версии — что вернёт откат', async () => {
    const { f } = fake();
    window.history.replaceState(null, '', '/?mtab=hist');
    mount(f);
    fireEvent.click(await screen.findByTestId('adm-model-verdiff-11111111-1111-1111-1111-111111111111'));
    const box = await screen.findByTestId('adm-model-verdiff');
    expect(box.textContent).toContain('audience.product');
  });

  it('откат, который не сходится со схемой, — 422 с причиной, окно не открывается', async () => {
    const { f } = fake({ put: () => json({ error: 'MODEL_INCONSISTENT', problems: ['product: ребра «X» в схеме графа нет'], written: false }, 422) });
    window.history.replaceState(null, '', '/?mtab=hist');
    mount(f);
    fireEvent.click(await screen.findByTestId('adm-model-rollback-11111111-1111-1111-1111-111111111111'));
    expect(await screen.findByText(/ребра «X» в схеме графа нет/)).toBeTruthy();
    expect(screen.queryByTestId('adm-model-apply-ok')).toBeNull();
  });
});
