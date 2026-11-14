// @vitest-environment jsdom
// SPRINT_UXR_POLISH_UAT_1113/PU-23 (правило владелицы 14.11.2026): «список при наличии дочернего
// элемента встроит его дочернюю таблицу — так же, как список со своими полями, маппингами и
// отображениями, — если объекты разные». Дети ДРУГОГО типа под раскрытой строкой — вложенная
// таблица со СВОИМ конфигом (колонки, подписи, статусы), компактная: без поиска, фильтров и шапки.
// Загрузка, сбой с «Повторить» и «нет вложенных» — своими состояниями.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListNestedTable, ListView } from './ListView';

beforeAll(() => { registerGameIcons(gameIcons); });

const statuses: KitConfig['statuses'] = {
  items: [
    { code: 'active', title: 'в работе', category: 'active', icon: 'progression', color: 'var(--inf)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'check-mark', color: 'var(--suc)' },
  ],
};
const parentCfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринты', icon: 'sprint', fields: [{ key: 'tasks', title: 'Задачи', type: 'number' }] } },
  statuses,
  list: { views: ['list'], columns: ['id', 'title', 'progress:tasks', 'status'] },
};
const childCfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'task', fields: [{ key: 'executor', title: 'Исполнитель', type: 'text' }] } },
  statuses,
  // Как у раздела «Задачи»: закрытые скрыты, есть поиск, фасеты и «Быстро».
  list: {
    views: ['list', 'cards'], showClosed: 'hide', columns: ['id', 'title', 'status', 'fields.executor'],
    filters: ['status'], quick: [{ id: 'active', title: 'В работе', filter: { status: 'active' } }],
  },
};
const sprint: KitRecord = { id: 'S1', kind: 'sprint', title: 'Спринт S1', status: 'active', fields: { tasks: { done: 1, total: 2 } } };
const kids: KitRecord[] = [
  { id: 'S1/T1', kind: 'task', title: 'Задача один', status: 'active', fields: { executor: 'Ольга' } },
  { id: 'S1/T2', kind: 'task', title: 'Задача два', status: 'done', fields: { executor: 'Агент' } },
];
const data: KitData = { records: [sprint], edges: [], journal: [], meta: { generated_at: '2026-11-14T00:00:00Z', total: 1 } };

describe('PU-23 · вложенная таблица дочернего типа', () => {
  it('колонки и подписи — из конфига ребёнка, а не родителя; без поиска и полосы управления', () => {
    render(<ListNestedTable config={childCfg} rows={{ state: 'ok', records: kids }} label="Задачи спринта S1" />);
    const table = screen.getByRole('table');
    const heads = within(table).getAllByRole('columnheader').map(h => h.textContent);
    expect(heads).toContain('Исполнитель');
    expect(heads).not.toContain('Задачи');
    expect(within(table).getByText('Ольга')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByTestId('kit-list-controls')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Быстро' })).toBeNull();
  });

  it('все дети видны: режим «закрытые скрыты» раздела во вложенной таблице не действует', () => {
    render(<ListNestedTable config={childCfg} rows={{ state: 'ok', records: kids }} />);
    expect(document.querySelectorAll('tr[data-record-id]').length).toBe(2);
    expect(screen.getByText('Задача два')).toBeTruthy();
  });

  it('ссылка на паспорт записи и подмена ячейки (смена статуса) — через пропсы', () => {
    const cellOf = vi.fn((col: string, r: KitRecord) => (col === 'status' ? <button type="button">Статус {r.id}</button> : undefined));
    render(<ListNestedTable config={childCfg} rows={{ state: 'ok', records: kids }} href={id => `#open=${id}`} cellOf={cellOf} />);
    expect(screen.getByRole('link', { name: 'Задача один' }).getAttribute('href')).toBe('#open=S1/T1');
    expect(screen.getByRole('button', { name: 'Статус S1/T2' })).toBeTruthy();
  });

  it('загрузка, сбой с «Повторить» и «нет вложенных» — каждое своим состоянием', () => {
    const onRetry = vi.fn();
    const { rerender, container } = render(<ListNestedTable config={childCfg} rows={{ state: 'loading', records: [] }} />);
    expect(container.querySelector('.sk-skel, [aria-busy="true"]')).not.toBeNull();
    rerender(<ListNestedTable config={childCfg} rows={{ state: 'error', records: [], error: 'HTTP 502', onRetry }} />);
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<ListNestedTable config={childCfg} rows={{ state: 'ok', records: [] }} />);
    expect(screen.getByText('Вложенных записей нет')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('внутри раскрытой строки родителя: своя таблица, родительская шапка «Задачи» в неё не попадает', () => {
    render(<ListView config={parentCfg} data={data} urlState={false}
      expand={{ render: () => <ListNestedTable config={childCfg} rows={{ state: 'ok', records: kids }} /> }} />);
    fireEvent.click(screen.getByRole('button', { name: /Раскрыть/ }));
    const nested = document.querySelector('tr[data-expand-of="S1"] [data-nested]') as HTMLElement;
    expect(nested).not.toBeNull();
    const heads = within(nested).getAllByRole('columnheader').map(h => h.textContent);
    expect(heads).toContain('Исполнитель');
    expect(heads).not.toContain('Задачи');
    expect(document.querySelector('tr[data-child-of]')).toBeNull();
  });
});
