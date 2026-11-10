// @vitest-environment jsdom
// S4-22 (владелица 08.11: «доделай»): переключатель видов над ОДНИМ набором данных —
// таблица, карточки, доска, дерево, лента, таймлайн. Раздел только перечисляет виды в list.views.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import { validateKitConfig } from '../core/validate';

const rec = (id: string, status: string, fields: Record<string, unknown>, updated_at?: string): KitRecord =>
  ({ id, kind: 'task', title: `Запись ${id}`, status, fields, ...(updated_at ? { updated_at } : {}) });
const base: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'checkbox-tree', fields: [{ key: 'start', title: 'Начало', type: 'date' }, { key: 'owner', title: 'Кто', type: 'text' }, { key: 'parent', title: 'Родитель', type: 'ref' }] } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: {
    views: ['list', 'cards', 'board', 'tree', 'feed', 'timeline'],
    columns: ['title+id', 'status', 'fields.owner'],
    groupings: ['status'],
    timeline: { start: 'start' },
    // Лента — вид там, где приложение НАЗВАЛО поле времени (K2-FEED-VIEW):
    // какое поле записи главное, kit не угадывает (K-14).
    feed: { timeField: 'updated_at' },
    tree: { parent: 'parent', order: 'title' },
    showClosed: 'all',
  },
};
const rs = [
  rec('a', 'todo', { start: '2026-11-01', owner: 'Аня' }, '2026-11-08T10:00:00Z'),
  rec('b', 'done', { start: '2026-11-03', owner: 'Боря', parent: 'a' }, '2026-11-07T09:00:00Z'),
  rec('c', 'todo', { start: '2026-11-05', owner: 'Вера' }, '2026-11-08T08:00:00Z'),
];
const data: KitData = { records: rs, edges: [], journal: [], meta: { generated_at: '2026-11-08T12:00:00Z', total: 3 } };
const pick = (name: string) => fireEvent.click(within(screen.getByRole('radiogroup', { name: /Вид/ })).getByRole('radio', { name: name }));

describe('S4-22: виды над одним набором данных', () => {
  it('контракт принимает все шесть видов и настройку таймлайна', () => {
    expect(validateKitConfig(base).errors.filter(e => e.path.startsWith('list'))).toEqual([]);
  });

  it('переключатель показывает все виды из list.views, по порядку', () => {
    render(<ListView config={base} data={data} urlState={false} />);
    const names = within(screen.getByRole('radiogroup', { name: /Вид/ })).getAllByRole('radio').map(r => r.textContent);
    expect(names).toEqual(['Список', 'Карточки', 'Доска', 'Дерево', 'Лента', 'Таймлайн']);
  });

  it('карточки: сетка, у карточки — название, ID, статус и поля колонок', () => {
    const { container } = render(<ListView config={base} data={data} urlState={false} />);
    pick('Карточки');
    const cards = container.querySelectorAll('.sk-cards [data-record-id]');
    expect(cards).toHaveLength(3);
    const a = container.querySelector('.sk-cards [data-record-id="a"]') as HTMLElement;
    expect(a.textContent).toContain('Запись a');
    expect(a.textContent).toContain('Аня');
    expect(a.querySelector('[data-status="todo"]')).not.toBeNull();
  });

  // K2-FEED-VIEW §3: группы ленты — не календарные дни, а ведра «сегодня ·
  // вчера · на этой неделе · раньше» относительно «сейчас» ИСТОЧНИКА
  // (meta.generated_at = 2026-11-08). Раньше здесь стояли сами дни; дни
  // остались в каждой строке, а заголовки стали ведрами, как в принятом
  // прототипе.
  it('лента: ведра времени, новые сверху', () => {
    const { container } = render(<ListView config={base} data={data} urlState={false} />);
    pick('Лента');
    const days = [...container.querySelectorAll('.sk-feed__day')].map(d => d.getAttribute('data-day'));
    expect(days).toEqual(['today', 'yesterday']);
    const first = [...container.querySelectorAll('.sk-feed__day[data-day="today"] [data-record-id]')].map(e => e.getAttribute('data-record-id'));
    expect(first).toEqual(['a', 'c']);
  });

  it('таймлайн: дорожки по полю начала из list.timeline', () => {
    const { container } = render(<ListView config={base} data={data} urlState={false} />);
    pick('Таймлайн');
    expect(container.querySelector('.sk-tl')).not.toBeNull();
  });

  it('дерево: иерархия по list.tree', () => {
    const { container } = render(<ListView config={base} data={data} urlState={false} />);
    pick('Дерево');
    expect(container.querySelector('.sk-tree')).not.toBeNull();
  });

  it('фильтр общий для всех видов: «Быстро»/поиск сужают и карточки', () => {
    const { container } = render(<ListView config={base} data={data} urlState={false} initial={{ text: 'Запись b' }} />);
    pick('Карточки');
    expect([...container.querySelectorAll('.sk-cards [data-record-id]')].map(e => e.getAttribute('data-record-id'))).toEqual(['b']);
  });
});
