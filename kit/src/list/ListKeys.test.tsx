// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11 — клавиатура как слой в listView kit:
// курсор строки (↑/↓, J/K, Home/End), Enter открывает, X выделяет, Esc снимает
// выделение; действия строки и действия над выделением — по своей клавише.
// Клавиши — по e.code (русская раскладка), у каждой клавиши — кнопка с
// aria-keyshortcuts и видимой подсказкой Kbd. В поле ввода клавиши — это текст.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string, status: string): KitRecord => ({ id, kind: 'task', title: `Запись ${id}`, status, fields: {} });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: { views: ['list', 'board'], filters: ['status'], columns: ['select', 'title+id', 'status'] },
};

const data = (records: KitRecord[]): KitData =>
  ({ records, edges: [], journal: [], meta: { generated_at: '2026-11-07T00:00:00Z', total: records.length } });

const three = () => data([rec('A', 'todo'), rec('B', 'todo'), rec('C', 'done')]);
const row = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-record-id="${id}"]`)!;
// e.key — как в русской раскладке: клавиша обязана сработать по e.code.
const press = (el: Element, code: string, key = '?', mods: Record<string, boolean> = {}) =>
  fireEvent.keyDown(el, { code, key, ...mods });

describe('курсор строки', () => {
  it('строки — один таб-стоп (roving tabindex): первая 0, остальные −1', () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} />);
    expect(row(container, 'A').tabIndex).toBe(0);
    expect(row(container, 'B').tabIndex).toBe(-1);
    expect(row(container, 'C').tabIndex).toBe(-1);
  });

  it('↓ и J (русская «о») — следующая строка, ↑ и K («л») — предыдущая; фокус едет за курсором', () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'ArrowDown', 'ArrowDown');
    expect(document.activeElement).toBe(row(container, 'B'));
    expect(row(container, 'B').tabIndex).toBe(0);
    expect(row(container, 'A').tabIndex).toBe(-1);
    press(row(container, 'B'), 'KeyJ', 'о');
    expect(document.activeElement).toBe(row(container, 'C'));
    press(row(container, 'C'), 'KeyK', 'л');
    expect(document.activeElement).toBe(row(container, 'B'));
    press(row(container, 'B'), 'ArrowUp', 'ArrowUp');
    expect(document.activeElement).toBe(row(container, 'A'));
    press(row(container, 'A'), 'ArrowUp', 'ArrowUp');
    expect(document.activeElement).toBe(row(container, 'A'));
  });

  it('Home / End — первая и последняя строка', () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'End', 'End');
    expect(document.activeElement).toBe(row(container, 'C'));
    press(row(container, 'C'), 'Home', 'Home');
    expect(document.activeElement).toBe(row(container, 'A'));
  });

  it('щелчок/фокус по строке ставит курсор на неё', () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} />);
    fireEvent.focus(row(container, 'C'));
    expect(row(container, 'C').tabIndex).toBe(0);
    expect(row(container, 'A').tabIndex).toBe(-1);
  });

  it('доска — тот же курсор по карточкам', () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} initial={{ view: 'board' }} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'ArrowDown', 'ArrowDown');
    expect(document.activeElement).toBe(row(container, 'B'));
  });
});

describe('Enter, X, Esc', () => {
  it('Enter на строке открывает запись через onOpen', () => {
    const onOpen = vi.fn();
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} onOpen={onOpen} />);
    row(container, 'B').focus();
    press(row(container, 'B'), 'Enter', 'Enter');
    expect(onOpen).toHaveBeenCalledWith('B');
  });

  it('X («ч») выделяет строку под курсором и снимает повторно; кнопка-двойник — чекбокс с aria-keyshortcuts', () => {
    const onSel = vi.fn();
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} onSelectionChange={onSel} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'KeyX', 'ч');
    expect(onSel).toHaveBeenLastCalledWith(['A']);
    const box = within(row(container, 'A')).getByRole('checkbox');
    expect(box.getAttribute('aria-keyshortcuts')).toBe('X');
    press(row(container, 'A'), 'KeyX', 'ч');
    expect(onSel).toHaveBeenLastCalledWith([]);
  });

  it('Esc снимает выделение; у «Готово» (выход из выбора, S4-10) — aria-keyshortcuts и Kbd', () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'KeyX', 'ч');
    const clear = screen.getByRole('button', { name: /Готово/ });
    expect(clear.getAttribute('aria-keyshortcuts')).toBe('Escape');
    expect(clear.querySelector('.sk-kbd')).not.toBeNull();
    press(row(container, 'A'), 'Escape', 'Escape');
    expect(screen.queryByTestId('kit-list-selbar')).toBeNull();
  });

  it('в поле ввода клавиши — это текст: X в фильтре ничего не выделяет', () => {
    const onSel = vi.fn();
    render(<ListView config={cfg} data={three()} urlState={false} onSelectionChange={onSel} />);
    // Фильтр полей — фасеты (S4-05); поле ввода в строке фильтра — поиск по тексту.
    const input = screen.getByRole('searchbox');
    press(input, 'KeyX', 'ч');
    expect(onSel).toHaveBeenLastCalledWith([]);
  });
});

describe('действия строки и действия над выделением', () => {
  const rowActions = [
    { id: 'edit', title: 'Править', icon: 'quill-ink', hotkey: 'E', run: vi.fn() },
    { id: 'pin', title: 'Закрепить', icon: 'pin', run: vi.fn() },
  ];

  it('у строки — кнопки действий с именем и aria-keyshortcuts, Kbd рядом', () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} rowActions={rowActions} />);
    const r = row(container, 'A');
    const edit = within(r).getByRole('button', { name: 'Править' });
    expect(edit.getAttribute('aria-keyshortcuts')).toBe('E');
    expect(within(r).getByRole('button', { name: 'Закрепить' }).getAttribute('aria-keyshortcuts')).toBeNull();
    expect(r.querySelector('.sk-list__actions .sk-kbd')?.textContent).toBe('E');
  });

  it('клавиша действия («у» = KeyE) — над строкой под курсором; кнопка — то же', () => {
    const run = vi.fn();
    const { container } = render(
      <ListView config={cfg} data={three()} urlState={false} rowActions={[{ id: 'edit', title: 'Править', icon: 'quill-ink', hotkey: 'E', run }]} />,
    );
    row(container, 'B').focus();
    press(row(container, 'B'), 'KeyE', 'у');
    expect(run).toHaveBeenLastCalledWith(['B']);
    fireEvent.click(within(row(container, 'C')).getByRole('button', { name: 'Править' }));
    expect(run).toHaveBeenLastCalledWith(['C']);
  });

  it('действие над выделением — по своей клавише и только при непустом выделении', () => {
    const run = vi.fn();
    const { container } = render(
      <ListView config={cfg} data={three()} urlState={false} bulkActions={[{ id: 'close', title: 'Закрыть', hotkey: 'Shift+D', run }]} />,
    );
    row(container, 'A').focus();
    press(row(container, 'A'), 'KeyD', 'в', { shiftKey: true });
    expect(run).not.toHaveBeenCalled();
    press(row(container, 'A'), 'KeyX', 'ч');
    press(row(container, 'A'), 'ArrowDown', 'ArrowDown');
    press(row(container, 'B'), 'KeyX', 'ч');
    press(row(container, 'B'), 'KeyD', 'в', { shiftKey: true });
    expect(run).toHaveBeenCalledWith(['A', 'B']);
    const btn = screen.getByRole('button', { name: /Закрыть/ });
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('Shift+D');
    expect(btn.querySelector('.sk-kbd')?.textContent).toBe('ShiftD');
  });

  it('клавиша действия, занятая слоем списка (X) или повторённая, — громкая ошибка конфигурации', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(
      <ListView config={cfg} data={three()} urlState={false} rowActions={[{ id: 'x', title: 'Икс', icon: 'pin', hotkey: 'X', run: () => {} }]} />,
    )).toThrow(/X/);
    expect(() => render(
      <ListView
        config={cfg} data={three()} urlState={false}
        rowActions={[{ id: 'a', title: 'А', icon: 'pin', hotkey: 'E', run: () => {} }]}
        bulkActions={[{ id: 'b', title: 'Б', hotkey: 'E', run: () => {} }]}
      />,
    )).toThrow(/E/);
    err.mockRestore();
  });

  it('axe: строки с курсором и действиями — без нарушений', async () => {
    const { container } = render(<ListView config={cfg} data={three()} urlState={false} rowActions={rowActions} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
