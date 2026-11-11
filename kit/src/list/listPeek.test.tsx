// @vitest-environment jsdom
// Peek из списка (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10, D-2026-LORE-PEEK-ONE-CARD, P3а/P4а): пробел на строке
// открывает панель справа с карточкой, J/K и стрелки двигают курсор — панель показывает текущую строку
// (как Linear), Esc и ✕ закрывают; позиция списка не сбивается (панель поверх). Ширина панели
// тянется и запоминается. Содержимое — от приложения (render), kit не знает, что в карточке.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import type { ListPeek } from './ListView';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { try { localStorage.clear(); } catch { /* нет хранилища */ } });

const rec = (id: string): KitRecord => ({ id, kind: 'task', title: `Запись ${id}`, status: 'todo', fields: {} });
const cfg: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list'], filters: ['status'], columns: ['title+id', 'status'] },
};
const data: KitData = { records: [rec('A'), rec('B'), rec('C')], edges: [], journal: [], meta: { generated_at: 'x', total: 3 } };
const peek: ListPeek = { render: id => <div>карточка {id}</div>, title: id => `Запись ${id}` };
const row = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-record-id="${id}"]`)!;
const press = (el: Element, code: string, key = '?') => fireEvent.keyDown(el, { code, key });
const panel = () => document.querySelector<HTMLElement>('.sk-peek-panel');

describe('Peek из списка', () => {
  it('пробел на строке — панель с карточкой этой строки; ещё раз пробел — закрыта', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} peek={peek} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'Space', ' ');
    expect(panel()?.textContent).toContain('карточка A');
    press(row(container, 'A'), 'Space', ' ');
    expect(panel()).toBeNull();
  });
  it('J/↓ при открытой панели — панель показывает следующую строку', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} peek={peek} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'Space', ' ');
    press(row(container, 'A'), 'KeyJ', 'о');
    expect(panel()?.textContent).toContain('карточка B');
    press(row(container, 'B'), 'ArrowDown', 'ArrowDown');
    expect(panel()?.textContent).toContain('карточка C');
  });
  it('Esc закрывает панель (а не только выделение)', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} peek={peek} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'Space', ' ');
    press(row(container, 'A'), 'Escape', 'Escape');
    expect(panel()).toBeNull();
  });
  it('✕ в панели закрывает; у панели доступное имя', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} peek={peek} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'Space', ' ');
    expect(screen.getByRole('complementary', { name: 'Запись A' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Закрыть просмотр/ }));
    expect(panel()).toBeNull();
  });
  it('ширина панели запоминается между открытиями', () => {
    localStorage.setItem('sk.peek.width', '480');
    const { container } = render(<ListView config={cfg} data={data} urlState={false} peek={peek} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'Space', ' ');
    expect(panel()?.style.width).toBe('480px');
  });
  it('ширину тянут ручкой с клавиатуры (← шире, → уже) и она сохраняется', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} peek={peek} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'Space', ' ');
    const grip = screen.getByRole('separator', { name: /Ширина просмотра/ });
    const before = parseInt(panel()!.style.width, 10);
    fireEvent.keyDown(grip, { key: 'ArrowLeft', code: 'ArrowLeft' });
    expect(parseInt(panel()!.style.width, 10)).toBeGreaterThan(before);
    expect(Number(localStorage.getItem('sk.peek.width'))).toBe(parseInt(panel()!.style.width, 10));
  });
  it('без peek пробел ничего не открывает (список как раньше)', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} />);
    row(container, 'A').focus();
    press(row(container, 'A'), 'Space', ' ');
    expect(panel()).toBeNull();
  });
});
