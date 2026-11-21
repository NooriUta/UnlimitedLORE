// @vitest-environment jsdom
// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Связь с обязательной причиной (у LORE — «зависит от»: владелица 20.11.2026,
// «хорошо бы с причиной, мы её теряем»). Признак — от приложения (`reasonRequired` у связи в KindConfig,
// у LORE — `reason_required` связи модели), а не имя ребра: kit типов записей не знает.
// «Привязать» у такой связи открывает тот же ReasonDialog, что «Применить…» экрана «Модель»; причина уходит в
// hooks.onRelation вместе с целью. Отвязать — без причины. Без признака — прежнее поведение, без диалога.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

const r = (id: string, kind: string, title: string): KitRecord => ({ id, kind, title, status: 'planned', fields: {} });
const sprint = r('S-1', 'sprint', 'Спринт');
const records = [sprint, r('S-2', 'sprint', 'Другой спринт'), r('S-3', 'sprint', 'Третий')];
const edges = [{ from: 'S-1', to: 'S-2', type: 'DEPENDS_ON' }];

const config = (onRelation: NonNullable<KitConfig['hooks']>['onRelation'], reasonRequired: boolean): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint', fields: [], relations: [
    { key: 'dependsOn', label: 'Зависит от', relation: 'association', rel: 'DEPENDS_ON', dir: 'out', manageable: true, ...(reasonRequired ? { reasonRequired: true } : {}) },
    { key: 'blocks', label: 'От неё зависят', relation: 'association', rel: 'DEPENDS_ON', dir: 'in', manageable: true, ...(reasonRequired ? { reasonRequired: true } : {}) },
  ] } },
  statuses: { items: [{ code: 'planned', title: 'запланировано', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  roles: { reader: { canEdit: true, canStatus: false } },
  hooks: { onRelation },
});
const ctxOf = (cfg: KitConfig): KitCtx => ({ config: cfg, data: { records, edges, journal: [], meta: { generated_at: '2026-11-20T00:00:00Z' } }, role: 'reader', href: id => `#${id}`, esc: s => s, md: s => s });
const view = (cfg: KitConfig) => render(<RecordView record={sprint} ctx={ctxOf(cfg)} tab="rel:association" onTab={() => {}} placement="bottom" />);

const typeTarget = (label: string, id: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: `Привязать: ${label}` }), { target: { value: id } });
  const group = screen.getByRole('group', { name: label });
  fireEvent.click(group.querySelector('button[type="submit"]')!);
};

describe('связь с обязательной причиной: «Привязать» → диалог причины → причина уходит в onRelation', () => {
  it('привязать — сначала диалог; без причины кнопка не нажимается; с причиной — вызов с reason', async () => {
    const onRelation = vi.fn(async () => {});
    view(config(onRelation, true));
    await act(async () => { typeTarget('Зависит от', 'S-3'); });
    expect(onRelation).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    const confirm = dialog.querySelector<HTMLButtonElement>('.sk-btn--primary')!;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(dialog.querySelector('input,textarea')!, { target: { value: '   ' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(dialog.querySelector('input,textarea')!, { target: { value: ' ждём схему базы ' } });
    expect(confirm.disabled).toBe(false);
    await act(async () => { fireEvent.click(confirm); });
    expect(onRelation).toHaveBeenCalledWith({ type: 'sprint', id: 'S-1', rel: 'DEPENDS_ON', dir: 'out', target: 'S-3', action: 'add', reason: 'ждём схему базы' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('отмена диалога — ничего не пишется', async () => {
    const onRelation = vi.fn(async () => {});
    view(config(onRelation, true));
    await act(async () => { typeTarget('От неё зависят', 'S-3'); });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onRelation).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('отказ сервера — словами в диалоге, диалог не закрывается', async () => {
    const onRelation = vi.fn(async () => { throw new Error('зависимость замкнёт цикл'); });
    view(config(onRelation, true));
    await act(async () => { typeTarget('Зависит от', 'S-3'); });
    const dialog = screen.getByRole('dialog');
    fireEvent.change(dialog.querySelector('input,textarea')!, { target: { value: 'причина' } });
    await act(async () => { fireEvent.click(dialog.querySelector('.sk-btn--primary')!); });
    expect(screen.getByRole('dialog').textContent).toContain('зависимость замкнёт цикл');
  });

  it('отвязать — без причины; без признака reasonRequired — прежний путь без диалога', async () => {
    const onRelation = vi.fn(async () => {});
    view(config(onRelation, true));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отвязать: Другой спринт' })); });
    expect(onRelation).toHaveBeenCalledWith({ type: 'sprint', id: 'S-1', rel: 'DEPENDS_ON', dir: 'out', target: 'S-2', action: 'remove' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('без признака — привязка сразу, reason не передаётся', async () => {
    const onRelation = vi.fn(async () => {});
    view(config(onRelation, false));
    await act(async () => { typeTarget('Зависит от', 'S-3'); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onRelation).toHaveBeenCalledWith({ type: 'sprint', id: 'S-1', rel: 'DEPENDS_ON', dir: 'out', target: 'S-3', action: 'add' });
  });
});
