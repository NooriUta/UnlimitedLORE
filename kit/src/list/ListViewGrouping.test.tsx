// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-06 — общая группировка в listView: один выбор
// группы (URL lg) действует в списке (группы) и на доске (дорожки); разрезы по
// связям — пресетами в том же выборе; таймлайн — дорожки той же группировкой.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import { TimelineLanes } from '../views/timeline';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string, status: string, fields: Record<string, unknown> = {}, kind = 'task'): KitRecord =>
  ({ id, kind, title: `Запись ${id}`, status, fields });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'checkbox-tree' }, sprint: { title: 'Спринты', icon: 'sprint' } },
  edges: { IN_SPRINT: { label: 'спринт', color: 'var(--acc)' } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: { views: ['list', 'board'], groupings: ['status', 'rel:IN_SPRINT'], columns: ['title+id', 'status'] },
};

const records = [
  rec('A', 'todo', { start: '2026-11-01', end: '2026-11-04' }),
  rec('B', 'done', { start: '2026-11-03', end: '2026-11-08' }),
  rec('C', 'todo'),
];
const data: KitData = {
  records: [...records, rec('S1', 'todo', {}, 'sprint')],
  edges: [
    { from: 'A', to: 'S1', type: 'IN_SPRINT' },
    { from: 'B', to: 'S1', type: 'IN_SPRINT' },
    { from: 'B', to: 'S9', type: 'IN_SPRINT' },
  ],
  journal: [],
  meta: { generated_at: '2026-11-07T00:00:00Z' },
};

// S4-26: группировка — поповер, значение в кнопке «Группировка: … ▾» (был select).
const groupButton = () => screen.getByRole('button', { name: /^Группировка:/ });
const openGroupMenu = () => { fireEvent.click(groupButton()); return screen.getByRole('dialog', { name: 'Группировка' }); };

describe('выбор группы — поля и пресеты разрезов по связям', () => {
  it('разрезы по связям — отдельной группой опций с подписью из config.edges', () => {
    render(<ListView config={cfg} data={{ ...data, records }} urlState={false} />);
    const dlg = openGroupMenu();
    const rels = within(dlg).getByRole('radiogroup', { name: 'Разрезы по связям' });
    expect(within(rels).getAllByRole('radio').map(r => r.textContent)).toEqual(['спринт']);
    expect(within(dlg).getByRole('radiogroup', { name: /одна на список/ })).toBeTruthy();
  });

  it('разрез «спринт» в списке: группа = спринт, запись в двух — в обеих, без связи — «без связи», не загруженный — помечен', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} initial={{ group: 'rel:IN_SPRINT' }} />);
    const heads = [...container.querySelectorAll('[data-group-key]')];
    expect(heads.map(h => h.getAttribute('data-group-key'))).toEqual(['S1', 'S9', '']);
    expect(heads[0].textContent).toContain('Запись S1');
    expect(heads[1].textContent).toContain('не загружена: S9');
    expect(heads[2].textContent).toContain('без связи «спринт»');
    // запись в нескольких группах — сумма групп больше показанного, это сказано вслух
    expect(screen.getByTestId('kit-list-multi').textContent).toContain('1');
  });

  it('группировка общая: выбранная в списке, она же — дорожки доски (URL lg)', () => {
    const win = { location: { pathname: '/', search: '?lg=rel%3AIN_SPRINT', hash: '' }, history: { replaceState: () => {}, pushState: () => {} } };
    const { container } = render(<ListView config={cfg} data={data} urlState={win} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Доска' }));
    const lanes = [...container.querySelectorAll('.sk-board__lane')];
    expect(lanes.map(l => l.getAttribute('data-lane-key'))).toEqual(['S1', 'S9', '']);
    // в дорожке — колонки всех статусов
    expect(lanes[0].querySelectorAll('.sk-board__col')).toHaveLength(2);
    expect(groupButton().textContent).toContain('спринт');
  });

  it('доска без группировки — прежняя доска без дорожек', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} initial={{ view: 'board' }} />);
    expect(container.querySelector('.sk-board__lane')).toBeNull();
    expect(container.querySelectorAll('.sk-board__col')).toHaveLength(2);
  });

  it('a11y: доска с дорожками без нарушений axe', async () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} initial={{ view: 'board', group: 'rel:IN_SPRINT' }} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('TimelineLanes — таймлайн той же группировкой', () => {
  it('дорожки по разрезу, полосы с датами, записи без дат — честным счётчиком', () => {
    const { container } = render(
      <TimelineLanes config={cfg} data={data} records={records} group="rel:IN_SPRINT" start="fields.start" end="fields.end" />,
    );
    const lanes = [...container.querySelectorAll('[data-lane-key]')];
    expect(lanes.map(l => l.getAttribute('data-lane-key'))).toEqual(['S1', 'S9']);
    expect(lanes[0].querySelectorAll('[data-record-id]')).toHaveLength(2);
    expect(screen.getByTestId('kit-timeline-undated').textContent).toContain('1');
  });

  it('ни одной даты — честное пустое состояние, а не пустая шкала', () => {
    render(<TimelineLanes config={cfg} data={data} records={[rec('C', 'todo')]} group={null} start="fields.start" />);
    expect(screen.getByText('Нет записей с датами')).toBeTruthy();
  });

  it('a11y: таймлайн без нарушений axe', async () => {
    const { container } = render(
      <TimelineLanes config={cfg} data={data} records={records} group="rel:IN_SPRINT" start="fields.start" end="fields.end" />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
