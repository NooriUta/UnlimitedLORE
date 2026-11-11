// @vitest-environment jsdom
// Фильтр по дате в списке (SPRINT_UXR_S10_SEIDR_KIT_2/K2-DATE-RANGE): одна
// реализация на таблицу, ленту и фасеты.
//
// Главный тест — совпадение НАБОРА записей в таблице и в ленте под одним и тем
// же диапазоном, и счётчики фасета по тому же суженному набору. Разойдутся
// пути — тест покраснеет.
//
// Ни одного предметного имени (K-14): поле времени, подпись и откуда отобрано
// называет приложение пропом `dateFilter`.
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import type { ListDateFilter } from './ListView';
import { NO_DATE_RANGE, type DateRangeValue } from './dateRange';

const rec = (id: string, status: string, updated_at?: string): KitRecord =>
  ({ id, kind: 'item', title: `Запись ${id}`, status, fields: {}, ...(updated_at ? { updated_at } : {}) });

const cfg: KitConfig = {
  modules: [{ id: 'm', title: 'Раздел', icon: 'scroll-quill' }], menu: { groups: [] },
  kinds: { item: { title: 'Предмет', icon: 'scroll-quill', fields: [] } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: {
    views: ['list', 'feed'], columns: ['title+id', 'status'], groupings: ['status'], filters: ['status'], showClosed: 'all',
    feed: { timeField: 'updated_at', lead: [] },
  },
};

const NOW = '2026-11-11T09:00:00Z';
const rs = [
  rec('a', 'todo', '2026-11-11T08:00:00Z'),
  rec('b', 'done', '2026-11-10T10:00:00Z'),
  rec('c', 'todo', '2026-11-09T10:00:00Z'),
  rec('d', 'todo', '2026-10-01T10:00:00Z'),
  rec('e', 'todo'),
];
const data: KitData = { records: rs, edges: [], journal: [], meta: { generated_at: NOW, total: rs.length } };

const ids = (c: HTMLElement) => [...c.querySelectorAll('[data-record-id]')].map(e => e.getAttribute('data-record-id'));

function Harness({ initial, extra, onChange }: {
  initial: DateRangeValue; extra?: Partial<ListDateFilter>; onChange?: (v: DateRangeValue) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ListView config={cfg} data={data} urlState={false}
      dateFilter={{
        field: 'updated_at', title: 'Изменены', value, timeZone: 'UTC',
        onChange: v => { setValue(v); onChange?.(v); }, ...extra,
      }} />
  );
}

const pickView = (name: string) =>
  fireEvent.click(within(screen.getByRole('radiogroup', { name: /Вид/ })).getByRole('radio', { name }));

describe('K2-DATE-RANGE · одна реализация на таблицу, ленту и фасеты', () => {
  it('положительный контроль: без фильтра видны все пять', () => {
    const { container } = render(<Harness initial={NO_DATE_RANGE} />);
    expect(ids(container).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('диапазон 10–11 ноября: таблица и лента показывают один и тот же набор', () => {
    const { container } = render(<Harness initial={{ from: '2026-11-10', to: '2026-11-11', zone: 'utc' }} />);
    const table = ids(container).sort();
    expect(table).toEqual(['a', 'b']);
    pickView('Лента');
    expect(ids(container).sort()).toEqual(table);
  });

  it('счётчики фасета считаются по суженному набору', () => {
    render(<Harness initial={{ from: '2026-11-10', to: '2026-11-11', zone: 'utc' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Статус/ }));
    const panel = screen.getByRole('group', { name: /Статус/ });
    // «к работе» — только a (c, d вне диапазона, e без времени).
    const todo = within(panel).getByText('к работе').closest('label')!;
    expect(todo.querySelector('.sk-facet__n')?.textContent).toBe('1');
  });

  it('чип читается словами и снимается', () => {
    const onChange = vi.fn();
    const { container } = render(<Harness initial={{ from: '2026-11-10', to: '2026-11-11', zone: 'local' }} onChange={onChange} />);
    const desc = screen.getByTestId('kit-list-desc');
    expect(desc.textContent).toContain('Изменены: 10–11 ноября');
    fireEvent.click(within(desc).getByRole('button', { name: /^Убрать: Изменены/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ from: null, to: null }));
    expect(ids(container).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('по загруженному — так и сказано в чипе; источник отобрал — без оговорки и без второго отбора', () => {
    const { unmount } = render(<Harness initial={{ from: '2026-11-10', to: null, zone: 'utc' }} />);
    expect(screen.getByTestId('kit-list-desc').textContent).toContain('по загруженному');
    unmount();
    const { container } = render(<Harness initial={{ from: '2026-11-10', to: null, zone: 'utc' }} extra={{ scope: 'source' }} />);
    expect(screen.getByTestId('kit-list-desc').textContent).not.toContain('по загруженному');
    // Источник уже отобрал — kit второй раз не режет: строки как пришли.
    expect(ids(container).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('быстрый период «Сегодня» — от времени источника (meta.generated_at), а не часов браузера', () => {
    const { container } = render(<Harness initial={NO_DATE_RANGE} />);
    fireEvent.click(within(screen.getByTestId('kit-daterange')).getByRole('button'));
    fireEvent.click(screen.getByRole('radio', { name: 'UTC' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Сегодня' }));
    expect(ids(container)).toEqual(['a']);
  });

  it('свой диапазон — нативный ввод даты; открытая граница', () => {
    const { container } = render(<Harness initial={{ ...NO_DATE_RANGE, zone: 'utc' }} />);
    fireEvent.click(within(screen.getByTestId('kit-daterange')).getByRole('button'));
    const from = screen.getByLabelText('С') as HTMLInputElement;
    expect(from.type).toBe('date');
    fireEvent.change(from, { target: { value: '2026-11-09' } });
    expect(ids(container).sort()).toEqual(['a', 'b', 'c']);
  });

  it('без отметки времени — не «пропали молча»: в панели сказано, сколько не вошло', () => {
    render(<Harness initial={{ from: '2026-11-10', to: null, zone: 'utc' }} />);
    fireEvent.click(within(screen.getByTestId('kit-daterange')).getByRole('button'));
    expect(screen.getByTestId('kit-daterange-note').textContent).toContain('Без отметки времени: 1');
  });

  it('недоступен — кнопка выключена и причина словами, записи не режутся', () => {
    const { container } = render(<Harness initial={{ from: '2026-11-10', to: null, zone: 'utc' }} extra={{ unavailable: 'у типа нет времени' }} />);
    const btn = within(screen.getByTestId('kit-daterange')).getByRole('button');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toContain('у типа нет времени');
    expect(ids(container).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('«Сбросить» в строке условий снимает и диапазон', () => {
    const onChange = vi.fn();
    render(<Harness initial={{ from: '2026-11-10', to: null, zone: 'utc' }} onChange={onChange} />);
    fireEvent.click(within(screen.getByTestId('kit-list-desc')).getByRole('button', { name: /^Сбросить/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ from: null, to: null, zone: 'utc' }));
  });
});
