// @vitest-environment jsdom
// SPRINT_UXR_POLISH_UAT_1113/PU-23 (владелица 14.11.2026, preprod: «в виде списка второй уровень
// почему не повторяет список верхнего уровня?»). Раскрытая строка спринта показывала задачи потоком
// «иконка · код · название» в одной широкой ячейке — колонки верхнего уровня во втором уровне не
// повторялись. Теперь kit умеет рисовать детей СТРОКАМИ ТОЙ ЖЕ ТАБЛИЦЫ (expand.rows): те же
// колонки, у колонки, которой у вида ребёнка нет, — «н/п» (S4-35), ячейку приложение может
// подменить (childCell: статус со сменой, ссылка на запись). Загрузка, сбой и пустой ответ —
// своими состояниями, а не пустой строкой.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView, type ListExpandRows } from './ListView';

beforeAll(() => { registerGameIcons(gameIcons); });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    sprint: { title: 'Спринты', icon: 'sprint', fields: [{ key: 'tasks', title: 'Задачи', type: 'number' }, { key: 'effort_total', title: 'Оценка', type: 'number' }] },
    task: { title: 'Задачи', icon: 'task', fields: [{ key: 'effort_total', title: 'Оценка', type: 'number' }] },
  },
  statuses: { items: [{ code: 'active', title: 'в работе', category: 'active', icon: 'progression', color: 'var(--inf)' }] },
  list: { views: ['list'], columns: ['id', 'title', 'progress:tasks', 'sum:effort_total', 'status'] },
};
const sprint: KitRecord = { id: 'S1', kind: 'sprint', title: 'Спринт S1', status: 'active', fields: { tasks: { done: 1, total: 2 }, effort_total: { value: 3, known: 2, of: 2 } } };
const kids: KitRecord[] = [
  { id: 'S1/T1', kind: 'task', title: 'Задача один', status: 'active', fields: { effort_total: { value: 1, known: 1, of: 1 } } },
  { id: 'S1/T2', kind: 'task', title: 'Задача два', status: 'active', fields: { effort_total: { value: 2, known: 1, of: 1 } } },
];
const data: KitData = { records: [sprint], edges: [], journal: [], meta: { generated_at: '2026-11-14T00:00:00Z', total: 1 } };
const open = () => fireEvent.click(screen.getByRole('button', { name: /Раскрыть/ }));

describe('PU-23 · дети раскрытой строки — строками той же таблицы', () => {
  it('у каждого ребёнка свои ячейки в тех же колонках, что у родителя', () => {
    render(<ListView config={cfg} data={data} urlState={false} expand={{ render: () => 'поток', rows: () => ({ state: 'ok', records: kids }) }} />);
    open();
    const parentCells = document.querySelector('[data-record-id="S1"]')!.querySelectorAll('td').length;
    const rows = [...document.querySelectorAll('tr[data-child-of="S1"]')];
    expect(rows.map(r => r.getAttribute('data-record-id'))).toEqual(['S1/T1', 'S1/T2']);
    for (const r of rows) expect(r.querySelectorAll('td').length).toBe(parentCells);
    expect(screen.queryByText('поток')).toBeNull();
  });

  it('колонка, которой у вида ребёнка нет, — «н/п», а не пусто', () => {
    render(<ListView config={cfg} data={data} urlState={false} expand={{ render: () => null, rows: () => ({ state: 'ok', records: kids }) }} />);
    open();
    const row = document.querySelector('tr[data-record-id="S1/T1"]')!;
    expect(row.querySelector('.sk-list__na')).not.toBeNull();
  });

  it('ячейку можно подменить: childCell главнее общей отрисовки', () => {
    const childCell = vi.fn((col: string, child: KitRecord) => (col === 'title' ? <a href={`#task-${child.id}`}>{child.title}</a> : undefined));
    render(<ListView config={cfg} data={data} urlState={false} expand={{ render: () => null, rows: () => ({ state: 'ok', records: kids }), childCell }} />);
    open();
    expect(screen.getByRole('link', { name: 'Задача один' }).getAttribute('href')).toBe('#task-S1/T1');
  });

  it('загрузка и сбой — своими состояниями; «повторить» зовёт приложение', () => {
    const onRetry = vi.fn();
    let st: ListExpandRows = { state: 'loading', records: [] };
    const { rerender } = render(<ListView config={cfg} data={data} urlState={false} expand={{ render: () => null, rows: () => st }} />);
    open();
    expect(document.querySelector('tr[data-expand-of="S1"] [aria-busy="true"], tr[data-expand-of="S1"] .sk-skel')).not.toBeNull();
    st = { state: 'error', records: [], error: 'HTTP 502', onRetry };
    rerender(<ListView config={cfg} data={data} urlState={false} expand={{ render: () => null, rows: () => st }} />);
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('без rows — прежнее раскрытие одной ячейкой (обратная совместимость)', () => {
    render(<ListView config={cfg} data={data} urlState={false} expand={{ render: () => 'поток' }} />);
    open();
    expect(screen.getByText('поток')).toBeTruthy();
    expect(document.querySelector('tr[data-child-of]')).toBeNull();
  });
});
