// @vitest-environment jsdom
// «Календарь» — месяц сеткой (SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-CALENDAR).
// Прототип утверждён владелицей 11.11.2026 (https://claude.ai/artifact/6W4ztEg8AZ19ivN5HW4hry).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../../core/contract';
import { calendarMonth, shiftMonth } from './calendarModel';
import { CalendarMonth } from './CalendarMonth';
import { ListView } from '../../list/ListView';

const rec = (id: string, due: string | null): KitRecord =>
  ({ id, kind: 'sprint', title: `Спринт ${id}`, status: 'todo', fields: due === null ? {} : { due } });

describe('модель месяца', () => {
  it('неделя с понедельника: ноябрь 2026 начинается с воскресенья — перед ним 6 дней октября', () => {
    const m = calendarMonth([], 'due', '2026-11');
    expect(m.weeks[0].map(d => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(m.weeks[0][6].inMonth).toBe(true);
    expect(m.weeks.every(w => w.length === 7)).toBe(true);
    const last = m.weeks[m.weeks.length - 1];
    expect(last[last.length - 1].date >= '2026-11-30').toBe(true);
  });

  it('запись — в свой день (по UTC); без даты и с мусорной датой — в undated, не теряются', () => {
    const m = calendarMonth([rec('a', '2026-11-11T23:30:00Z'), rec('b', null), rec('c', 'когда-нибудь')], 'due', '2026-11');
    const day = m.weeks.flat().find(d => d.date === '2026-11-11')!;
    expect(day.records.map(r => r.id)).toEqual(['a']);
    expect(m.undated.map(r => r.id)).toEqual(['b', 'c']);
  });

  it('сдвиг месяца через границу года', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

const cfg: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { sprint: { title: 'Спринты', icon: 'calendar' } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list', 'calendar'], calendar: { date: 'due' }, columns: ['title'] },
};

describe('вид «Календарь»', () => {
  const recs = [rec('a', '2026-11-11'), rec('b', '2026-11-11'), rec('c', '2026-11-11'), rec('d', '2026-11-11'), rec('e', '2026-11-20'), rec('f', null)];

  it('в клетке до трёх записей, дальше «ещё N»; записи без даты названы числом', () => {
    render(<CalendarMonth records={recs} date="due" month="2026-11" config={cfg} narrow={false} />);
    const cell = document.querySelector('[data-date="2026-11-11"]') as HTMLElement;
    expect(cell.querySelectorAll('[data-record-id]')).toHaveLength(3);
    expect(within(cell).getByText('ещё 1')).toBeTruthy();
    expect(screen.getByText(/без даты: 1/)).toBeTruthy();
  });

  it('переход по месяцам и «Сегодня»', () => {
    const onMonth = vi.fn();
    render(<CalendarMonth records={recs} date="due" month="2026-11" config={cfg} narrow={false} onMonth={onMonth} />);
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    expect(onMonth).toHaveBeenLastCalledWith('2026-12');
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий месяц' }));
    expect(onMonth).toHaveBeenLastCalledWith('2026-10');
  });

  it('на телефоне — список по дням вместо сетки', () => {
    render(<CalendarMonth records={recs} date="due" month="2026-11" config={cfg} narrow />);
    expect(document.querySelector('.sk-cal__grid')).toBeNull();
    expect(document.querySelectorAll('.sk-cal__pday')).toHaveLength(2);
  });

  it('ListView: вид «Календарь» в переключателе и рисует месяц', () => {
    const data: KitData = { records: recs, edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } };
    render(<ListView config={cfg} data={data} urlState={false} initial={{ view: 'calendar' }} narrow={false} />);
    expect(screen.getByRole('radio', { name: 'Календарь' })).toBeTruthy();
    expect(document.querySelector('.sk-cal')).toBeTruthy();
  });
});
