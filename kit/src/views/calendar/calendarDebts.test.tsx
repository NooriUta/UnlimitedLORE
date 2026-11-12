// @vitest-environment jsdom
// Долги «Календаря», найденные при подключении в web-next (SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-CALENDAR,
// серверная сессия 11.11.2026): вид и месяц — в адресе; диапазон «начало–конец»;
// выбор поля даты, если их у записи несколько (у спринта — начало и конец плана).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../../core/contract';
import { calendarMonth } from './calendarModel';
import { readListState, writeListState, DEFAULT_LIST_STATE } from '../../list/listModel';
import { ListView } from '../../list/ListView';

const rec = (id: string, fields: Record<string, unknown>): KitRecord => ({ id, kind: 'sprint', title: `Спринт ${id}`, status: 'todo', fields });

describe('адрес календаря', () => {
  it('?lv=calendar открывает календарь, а не список', () => {
    expect(readListState(new URLSearchParams('lv=calendar')).view).toBe('calendar');
  });
  it('месяц и поле даты — в адресе и обратно', () => {
    const w = writeListState({ ...DEFAULT_LIST_STATE, view: 'calendar', month: '2026-12', calDate: 'end' });
    expect(w.lm).toBe('2026-12');
    expect(w.lcd).toBe('end');
    const back = readListState(new URLSearchParams(`lv=calendar&lm=${w.lm}&lcd=${w.lcd}`));
    expect(back.month).toBe('2026-12');
    expect(back.calDate).toBe('end');
  });
  it('мусорный месяц в адресе — текущий, а не падение', () => {
    expect(readListState(new URLSearchParams('lv=calendar&lm=когда')).month).toBeUndefined();
  });
});

describe('диапазон «начало–конец»', () => {
  it('запись видна в каждом дне диапазона; конец раньше начала — только день начала', () => {
    const m = calendarMonth([rec('a', { start: '2026-11-03', end: '2026-11-05' }), rec('b', { start: '2026-11-10', end: '2026-11-01' })], 'start', '2026-11', 'end');
    const ids = (d: string) => m.weeks.flat().find(x => x.date === d)!.records.map(r => r.id);
    expect(ids('2026-11-03')).toEqual(['a']);
    expect(ids('2026-11-04')).toEqual(['a']);
    expect(ids('2026-11-05')).toEqual(['a']);
    expect(ids('2026-11-06')).toEqual([]);
    expect(ids('2026-11-10')).toEqual(['b']);
    expect(ids('2026-11-11')).toEqual([]);
  });
});

const cfg = (calendar: NonNullable<KitConfig['list']>['calendar']): KitConfig => ({
  modules: [], menu: { groups: [] }, kinds: { sprint: { title: 'Спринты', icon: 'calendar' } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list', 'calendar'], calendar, columns: ['title'] },
});
const data = (records: KitRecord[]): KitData => ({ records, edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } });

describe('календарь в ListView', () => {
  it('переход по месяцу уходит в состояние списка (а значит в адрес)', () => {
    const onStateChange = vi.fn();
    render(<ListView config={cfg({ date: 'start' })} data={data([rec('a', { start: '2026-11-03' })])} urlState={false} narrow={false}
      initial={{ view: 'calendar', month: '2026-11' }} onStateChange={onStateChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ month: '2026-12' }));
  });

  it('несколько полей даты — выбор над сеткой; выбранное — в состоянии', () => {
    const onStateChange = vi.fn();
    render(<ListView config={cfg({ date: 'start', dates: [{ date: 'start', end: 'end', label: 'План' }, { date: 'end', label: 'Конец' }] })}
      data={data([rec('a', { start: '2026-11-03', end: '2026-11-20' })])} urlState={false} narrow={false}
      initial={{ view: 'calendar', month: '2026-11' }} onStateChange={onStateChange} />);
    const pick = screen.getByRole('combobox', { name: /Поле даты/ }) as HTMLSelectElement;
    expect(pick.value).toBe('start');
    expect(document.querySelector('[data-date="2026-11-04"] [data-record-id="a"]')).toBeTruthy();
    fireEvent.change(pick, { target: { value: 'end' } });
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ calDate: 'end' }));
    expect(document.querySelector('[data-date="2026-11-04"] [data-record-id="a"]')).toBeNull();
    expect(document.querySelector('[data-date="2026-11-20"] [data-record-id="a"]')).toBeTruthy();
  });
});
