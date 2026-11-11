// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-EDGE п.Б — таймлайн на телефоне.
// Замер на живом v2 (360 px): полосы обрезаны справа, полгода сжато в 300 px.
// В v1 (SPRINT_LORE_MOBILE_UX/MOB-03) на телефоне вместо Ганта — список по
// датам; решение владелицы D-2026-UXR-MOBILE-FOLLOWS-V1 — образец v1.
// Узко: те же записи, тот же порядок внутри даты, группы — по дате начала;
// широко — прежний Гант (положительный контроль).
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../../core/contract';
import { TimelineLanes } from './TimelineLanes';
import { ListView } from '../../list/ListView';

const rec = (id: string, status: string, fields: Record<string, unknown>): KitRecord =>
  ({ id, kind: 'task', title: `Запись ${id}`, status, fields });
const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'checkbox-tree', fields: [{ key: 'start', title: 'Начало', type: 'date' }, { key: 'end', title: 'Конец', type: 'date' }] } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: { views: ['list', 'timeline'], columns: ['title+id', 'status'], groupings: ['status'], timeline: { start: 'start', end: 'end' }, showClosed: 'all' },
};
const rs = [
  rec('a', 'todo', { start: '2026-04-01', end: '2026-06-30' }),
  rec('b', 'done', { start: '2026-04-01', end: '2026-04-10' }),
  rec('c', 'todo', { start: '2027-01-15' }),
  rec('d', 'done', {}),
];
const data: KitData = { records: rs, edges: [], journal: [], meta: { generated_at: '2026-11-08T12:00:00Z', total: 4 } };

const ids = (root: ParentNode) => [...root.querySelectorAll('[data-record-id]')].map(e => e.getAttribute('data-record-id'));

describe('S4-MOBILE-EDGE п.Б — таймлайн узко: список по датам', () => {
  it('широко — прежний Гант: дорожки и полосы с left/width (положительный контроль)', () => {
    const { container } = render(<TimelineLanes config={config} data={data} group="status" start="start" end="end" narrow={false} />);
    expect(container.querySelectorAll('.sk-tl__lane').length).toBe(2);
    const bars = container.querySelectorAll<HTMLElement>('.sk-tl__bar');
    expect(bars.length).toBe(3);
    expect(bars[0].style.left).not.toBe('');
    expect(container.querySelector('.sk-tl__day')).toBeNull();
  });

  // Владелица 11.11 (выбор по прототипу, «2б»): группы — по МЕСЯЦУ начала, дата
  // начала и конца — в строке. По дню почти у каждой записи был свой заголовок,
  // и список выходил вдвое длиннее.
  it('узко — нет полос шкалы; группы по месяцу начала, по возрастанию', () => {
    const recs = [...rs, rec('e', 'todo', { start: '2026-04-20', end: '2026-05-02' })];
    const d2: KitData = { ...data, records: recs };
    const { container } = render(<TimelineLanes config={config} data={d2} group="status" start="start" end="end" narrow />);
    expect(container.querySelector('.sk-tl__bar')).toBeNull();
    expect(container.querySelector('.sk-tl__lane')).toBeNull();
    const months = [...container.querySelectorAll('.sk-tl__day')];
    expect(months.map(d => d.getAttribute('data-month'))).toEqual(['2026-04', '2027-01']);
    // Заголовок — месяц и год словами, не код даты.
    expect(months[0].querySelector('.sk-tl__title')?.textContent).toMatch(/2026/);
    expect(months[0].querySelector('.sk-tl__title')?.textContent).not.toMatch(/2026-04/);
    // Внутри месяца — по дате начала; при равной дате — порядок Ганта
    // (дорожка «к работе», потом «готово»).
    expect(ids(months[0])).toEqual(['a', 'b', 'e']);
    expect(ids(months[1])).toEqual(['c']);
  });

  it('узко — те же записи, что на Ганте; без даты — тот же честный счётчик', () => {
    const wide = render(<TimelineLanes config={config} data={data} group="status" start="start" end="end" narrow={false} />);
    const wideIds = ids(wide.container).sort();
    wide.unmount();
    const { container } = render(<TimelineLanes config={config} data={data} group="status" start="start" end="end" narrow />);
    expect(ids(container).sort()).toEqual(wideIds);
    expect(screen.getByTestId('kit-timeline-undated').textContent).toMatch(/1/);
  });

  it('узко — строка несёт срок и дорожку: ничего из Ганта не теряется', () => {
    render(<TimelineLanes config={config} data={data} group="status" start="start" end="end" narrow href={id => `#/r/${id}`} />);
    const link = screen.getByRole('link', { name: 'Запись a: 2026-04-01 — 2026-06-30' });
    const row = link.closest('li')!;
    expect(within(row).getByText('2026-04-01 — 2026-06-30')).toBeTruthy();
    expect(within(row).getByText('к работе')).toBeTruthy();
  });

  it('ListView narrow: вид «Таймлайн» рисуется списком по датам', () => {
    const { container } = render(<ListView config={config} data={data} urlState={false} narrow initial={{ view: 'timeline' }} />);
    expect(container.querySelector('.sk-tl__day')).not.toBeNull();
    expect(container.querySelector('.sk-tl__bar')).toBeNull();
  });

  it('ListView широко: вид «Таймлайн» — Гант (положительный контроль)', () => {
    const { container } = render(<ListView config={config} data={data} urlState={false} narrow={false} initial={{ view: 'timeline' }} />);
    expect(container.querySelector('.sk-tl__bar')).not.toBeNull();
    expect(container.querySelector('.sk-tl__day')).toBeNull();
  });
});
