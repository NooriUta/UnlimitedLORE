// @vitest-environment jsdom
// Переназначенная клавиша доходит до списка, «?» открывает панель
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11). Урок «написано ≠ подключено»
// (kit/src/wired.test.ts): панель, которая пишет раскладку, ничего не стоит,
// если список продолжает реагировать на умолчание.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from '../list/ListView';
import { KeymapHost } from './KeymapPanel';
import { memoryKeymapStore, setKeymapStore } from './keymapOverrides';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string): KitRecord => ({ id, kind: 'task', title: `Запись ${id}`, status: 'todo', fields: {} });
const cfg: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list'], columns: ['title+id', 'status'] },
};
const data: KitData = { records: [rec('A'), rec('B')], edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z', total: 2 } };
const row = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-record-id="${id}"]`)!;

afterEach(() => { setKeymapStore(memoryKeymapStore()); });

describe('S4-11 · переназначение доходит до списка', () => {
  it('после переназначения E → G список реагирует на G, а E больше не действует', () => {
    const store = memoryKeymapStore();
    store.write({ edit: 'G' });
    setKeymapStore(store);
    const run = vi.fn();
    const { container } = render(<ListView config={cfg} data={data} urlState={false} rowActions={[{ id: 'edit', title: 'Править', icon: 'quill-ink', hotkey: 'E', run }]} />);
    row(container, 'A').focus();
    fireEvent.keyDown(row(container, 'A'), { code: 'KeyE', key: 'e' });
    expect(run).not.toHaveBeenCalled();
    fireEvent.keyDown(row(container, 'A'), { code: 'KeyG', key: 'g' });
    expect(run).toHaveBeenLastCalledWith(['A']);
    // Подсказка у кнопки — тоже новая клавиша, а не умолчание.
    expect(within(row(container, 'A')).getByRole('button', { name: 'Править' }).getAttribute('aria-keyshortcuts')).toBe('G');
  });

  it('«?» в списке открывает панель «Горячие клавиши» с действиями этого списка', () => {
    setKeymapStore(memoryKeymapStore());
    const { container } = render(<>
      <ListView config={cfg} data={data} urlState={false} rowActions={[{ id: 'edit', title: 'Править', icon: 'quill-ink', hotkey: 'E', run: vi.fn() }]} />
      <KeymapHost />
    </>);
    row(container, 'A').focus();
    act(() => { fireEvent.keyDown(row(container, 'A'), { code: 'Slash', key: '?', shiftKey: true }); });
    const dialog = screen.getByRole('dialog', { name: 'Горячие клавиши' });
    expect(within(dialog).getByText('Править')).toBeTruthy();
  });

  it('сохранение в панели сразу меняет клавишу в списке', () => {
    setKeymapStore(memoryKeymapStore());
    const run = vi.fn();
    const { container } = render(<>
      <ListView config={cfg} data={data} urlState={false} rowActions={[{ id: 'edit', title: 'Править', icon: 'quill-ink', hotkey: 'E', run }]} />
      <KeymapHost />
    </>);
    row(container, 'A').focus();
    act(() => { fireEvent.keyDown(row(container, 'A'), { code: 'Slash', key: '?', shiftKey: true }); });
    const dialog = screen.getByRole('dialog', { name: 'Горячие клавиши' });
    const r = within(dialog).getByText('Править').closest('[data-keymap-row]') as HTMLElement;
    fireEvent.click(within(r).getByRole('button', { name: 'Изменить: Править' }));
    fireEvent.keyDown(within(r).getByRole('button', { name: /Нажмите сочетание/ }), { code: 'KeyG', key: 'g' });
    act(() => { fireEvent.click(within(r).getByRole('button', { name: 'Сохранить' })); });
    fireEvent.keyDown(row(container, 'A'), { code: 'KeyG', key: 'g' });
    expect(run).toHaveBeenLastCalledWith(['A']);
  });
});

// Хост панели стоит в оболочке: без него «?» и пункт меню ничего бы не открыли
// в настоящем приложении — панель была бы только в тестах.
describe('S4-11 · панель живёт в оболочке', () => {
  it('KitShell рисует панель «Горячие клавиши» по openKeymapPanel()', async () => {
    const { KitShell, createSafeStorage } = await import('../index');
    const { openKeymapPanel, closeKeymapPanel } = await import('./keymapOverrides');
    const mem = new Map<string, string>();
    const storage = createSafeStorage(() => ({ getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } } as unknown as Storage));
    render(<KitShell config={{ ...cfg, modules: [{ id: 'm', title: 'LORE', icon: 'scroll-quill' }] }} storage={storage} narrow={false} />);
    act(() => { openKeymapPanel(); });
    expect(screen.getByRole('dialog', { name: 'Горячие клавиши' })).toBeTruthy();
    act(() => { closeKeymapPanel(); });
  });
});
