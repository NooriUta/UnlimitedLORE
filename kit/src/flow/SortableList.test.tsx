// @vitest-environment jsdom
// SortableList — порядок строк перетаскиванием И кнопками (SPRINT_LORE_MODEL_AS_CONFIG/MC-06).
//
// Повод: экран «Модель» правит порядок полей и раздел паспорта; владелица 18.11.2026 — «строить на
// объектах kit; чего нет — доработка kit». Перетаскивание недоступно с клавиатуры и неудобно пальцем,
// поэтому у каждой строки есть «выше/ниже» с именем, а Alt+↑/↓ двигает строку в фокусе.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KitLangProvider } from '../i18n';
import { SortableList } from './SortableList';

const ITEMS = [{ id: 'a', label: 'Альфа' }, { id: 'b', label: 'Бета' }, { id: 'c', label: 'Гамма' }];

function mount(onMove = vi.fn(), extra: Partial<Parameters<typeof SortableList>[0]> = {}) {
  render(
    <KitLangProvider lang="ru">
      <SortableList label="Порядок" items={ITEMS} onMove={onMove} {...extra} />
    </KitLangProvider>,
  );
  return onMove;
}

describe('SortableList', () => {
  it('строки в порядке items, у списка имя', () => {
    mount();
    const list = screen.getByRole('list', { name: 'Порядок' });
    expect([...list.querySelectorAll('[data-sortable-id]')].map(e => e.getAttribute('data-sortable-id'))).toEqual(['a', 'b', 'c']);
  });

  it('кнопки «выше/ниже» с именем строки; у краёв — недоступны', () => {
    const onMove = mount();
    expect((screen.getByRole('button', { name: 'Выше: Альфа' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Ниже: Гамма' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ниже: Альфа' }));
    expect(onMove).toHaveBeenCalledWith(0, 1);
    fireEvent.click(screen.getByRole('button', { name: 'Выше: Гамма' }));
    expect(onMove).toHaveBeenCalledWith(2, 1);
  });

  it('Alt+↑/↓ на строке двигает её', () => {
    const onMove = mount();
    const row = document.querySelector('[data-sortable-id="b"]') as HTMLElement;
    fireEvent.keyDown(row, { key: 'ArrowUp', altKey: true });
    expect(onMove).toHaveBeenCalledWith(1, 0);
    fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true });
    expect(onMove).toHaveBeenCalledWith(1, 2);
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    expect(onMove).toHaveBeenCalledTimes(2);
  });

  it('перетаскивание: бросок на строку ставит на её место', () => {
    const onMove = mount();
    const a = document.querySelector('[data-sortable-id="a"]') as HTMLElement;
    const c = document.querySelector('[data-sortable-id="c"]') as HTMLElement;
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(a, { dataTransfer });
    fireEvent.dragOver(c, { dataTransfer });
    fireEvent.drop(c, { dataTransfer });
    expect(onMove).toHaveBeenCalledWith(0, 2);
  });

  it('изменённая строка помечена; только чтение — без кнопок и перетаскивания', () => {
    mount(vi.fn(), { changed: new Set(['b']), readOnly: false });
    expect(document.querySelector('[data-sortable-id="b"]')!.hasAttribute('data-changed')).toBe(true);
  });

  it('readOnly — без кнопок, строки не перетаскиваются', () => {
    mount(vi.fn(), { readOnly: true });
    expect(screen.queryByRole('button', { name: /Выше/ })).toBeNull();
    expect(document.querySelector('[data-sortable-id="a"]')!.getAttribute('draggable')).not.toBe('true');
  });

  it('renderItem рисует содержимое строки', () => {
    mount(vi.fn(), { renderItem: it => <b data-testid={`r-${it.id}`}>{it.label}!</b> });
    expect(screen.getByTestId('r-b').textContent).toBe('Бета!');
  });

  it('английская локаль', () => {
    render(<KitLangProvider lang="en"><SortableList label="Order" items={ITEMS} onMove={vi.fn()} /></KitLangProvider>);
    expect(screen.getByRole('button', { name: 'Up: Бета' })).toBeTruthy();
  });
});
