// @vitest-environment jsdom
// Множественный выбор привязок в «Свойствах» (компоненты, проекты) — SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24.
// Владелица 11.11.2026: «не сделано редактирование множественного выбора привязок
// (компоненты, проекты)»; «подсмотри у первой версии» — в v1 (LoreSprintDetail
// toggleComp) щелчок привязывает или отвязывает по одному, у чипа — крестик снятия.
// В v2 тот же путь: hooks.onRelation add/remove; добавить — выбором с поиском
// (hooks.relationOptions). Унаследованное значение (от спринта) — не своё ребро:
// крестика у него нет.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../index';
import { RecordView } from './RecordView';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec: KitRecord = {
  id: 'T-1', kind: 'task', title: 'Задача', status: '', fields: {
    components: [
      { id: 'FORSETI', label: 'Forseti', inherited_from: null },
      { id: 'SEIDRKIT', label: 'Seiðr-kit', inherited_from: { type: 'sprint', id: 'S_A' } },
    ],
  },
};
const ctx = (hooks: KitConfig['hooks'], canEdit = true): KitCtx => ({
  config: {
    modules: [], menu: { groups: [] }, statuses: { items: [] },
    roles: { editor: { canEdit, canStatus: true } },
    kinds: { task: { title: 'Задача', icon: 'task', fields: [{ key: 'components', title: 'Компоненты', type: 'ref', relation: { rel: 'BELONGS_TO', dir: 'out' } }] } },
    hooks,
  },
  data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } },
  role: 'editor', href: id => '#' + id, esc: s => s, md: s => s,
});
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const show = (hooks: KitConfig['hooks'], canEdit = true) =>
  render(<RecordView record={rec} ctx={ctx(hooks, canEdit)} tab="props" onTab={() => {}} narrow />);

describe('свойства: связь-атрибут правится выбором', () => {
  it('у своего значения — «Отвязать», у унаследованного от спринта — нет', () => {
    show({ onRelation: async () => {}, relationOptions: async () => [] });
    expect(screen.getByRole('button', { name: /Отвязать.*FORSETI/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Отвязать.*SEIDRKIT/ })).toBeNull();
  });

  it('«Отвязать» зовёт onRelation remove; поиск и щелчок по найденному — add', async () => {
    const onRelation = vi.fn(async () => {});
    const relationOptions = vi.fn(async () => [{ id: 'ODIN', title: 'Odin' }, { id: 'FORSETI', title: 'Forseti' }]);
    show({ onRelation, relationOptions });
    fireEvent.click(screen.getByRole('button', { name: /Отвязать.*FORSETI/ }));
    await settle();
    expect(onRelation).toHaveBeenLastCalledWith({ type: 'task', id: 'T-1', rel: 'BELONGS_TO', dir: 'out', target: 'FORSETI', action: 'remove' });
    fireEvent.change(screen.getByRole('searchbox', { name: /Компоненты/ }), { target: { value: 'od' } });
    await settle();
    // Уже привязанное в найденном не предлагается.
    expect(screen.queryByRole('button', { name: /Привязать.*FORSETI/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Привязать.*ODIN/ }));
    await settle();
    expect(onRelation).toHaveBeenLastCalledWith({ type: 'task', id: 'T-1', rel: 'BELONGS_TO', dir: 'out', target: 'ODIN', action: 'add' });
  });

  it('отказ сервера — причина словами рядом', async () => {
    show({ onRelation: async () => { throw new Error('нет прав'); }, relationOptions: async () => [] });
    fireEvent.click(screen.getByRole('button', { name: /Отвязать.*FORSETI/ }));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('нет прав');
  });

  it('нет права править — только чтение, без кнопок', () => {
    show({ onRelation: async () => {}, relationOptions: async () => [] }, false);
    expect(screen.queryByRole('button', { name: /Отвязать/ })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
