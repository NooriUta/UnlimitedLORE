// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04 — движок списка v2 поверх listView kit:
// строка [Фильтр][Группировка][Порядок] тремя именованными сегментами,
// строка-описание из снимаемых чипов, быстрые иконки у «Быстро», порядок по
// полям конфига (а не только по встроенным ключам).
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import { quickIconOf, sortKeysOf } from './listModel';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string, status: string, fields: Record<string, unknown> = {}): KitRecord =>
  ({ id, kind: 'task', title: `Запись ${id}`, status, fields });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'checkbox-tree', fields: [
    { key: 'prio', title: 'Приоритет', type: 'number' },
    { key: 'area', title: 'Область', type: 'enum' },
  ] } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: {
    views: ['list'],
    quick: [
      { id: 'done', title: 'готово', filter: { status: 'done' } },
      { id: 'ui', title: 'интерфейс', filter: { area: 'ui' } },
    ],
    filters: ['status', 'area'],
    groupings: ['status', 'area'],
    columns: ['title+id', 'status', 'fields.prio'],
  },
};

const data = (records: KitRecord[]): KitData =>
  ({ records, edges: [], journal: [], meta: { generated_at: '2026-11-07T00:00:00Z', total: records.length } });

const rs = () => [
  rec('a', 'todo', { prio: 3, area: 'ui' }),
  rec('b', 'done', { prio: 1, area: 'api' }),
  rec('c', 'done', { prio: 2, area: 'ui' }),
];
const ids = (c: HTMLElement) => [...c.querySelectorAll('[data-record-id]')].map(r => r.getAttribute('data-record-id'));

describe('модель движка', () => {
  it('sortKeysOf: встроенные ключи + поля колонок, фильтров и группировок, без служебных колонок и дублей', () => {
    expect(sortKeysOf(cfg)).toEqual(['title', 'id', 'status', 'updated_at', 'fields.prio', 'area']);
  });

  it('quickIconOf: «Быстро» по одному статусу — иконка статуса; прочее — null', () => {
    expect(quickIconOf(cfg.list!.quick![0], cfg)).toBe('divided-spiral');
    expect(quickIconOf(cfg.list!.quick![1], cfg)).toBeNull();
    expect(quickIconOf({ id: 'x', title: 'x', filter: { status: ['todo', 'done'] } }, cfg)).toBeNull();
    expect(quickIconOf({ id: 'x', title: 'x', filter: { status: 'nope' } }, cfg)).toBeNull();
  });
});

describe('строка [Фильтр][Группировка][Порядок]', () => {
  it('три именованных сегмента в этом порядке', () => {
    render(<ListView config={cfg} data={data(rs())} urlState={false} />);
    const bar = screen.getByTestId('kit-list-controls');
    // fieldset + legend: имя сегмента не спорит с подписью селекта внутри
    const segs = within(bar).getAllByRole('group').map(g => g.querySelector('legend')?.textContent);
    expect(segs).toEqual(['Фильтр', 'Группировка', 'Порядок']);
    expect(screen.getByRole('group', { name: 'Порядок' })).toBeTruthy();
  });

  it('у сегмента — счётчик активных условий', () => {
    render(<ListView config={cfg} data={data(rs())} urlState={false} initial={{ filters: { status: ['done'], area: ['ui'] } }} />);
    const seg = screen.getByRole('group', { name: 'Фильтр' });
    expect(seg.querySelector('[data-testid="kit-list-segcount"]')?.textContent).toBe('2');
  });

  it('порядок — по полю конфига (Приоритет), направление переключается', () => {
    const { container } = render(<ListView config={cfg} data={data(rs())} urlState={false} />);
    fireEvent.change(screen.getByLabelText('Порядок'), { target: { value: 'fields.prio' } });
    expect(ids(container)).toEqual(['b', 'c', 'a']);
    fireEvent.click(screen.getByRole('button', { name: 'по убыванию' }));
    expect(ids(container)).toEqual(['a', 'c', 'b']);
  });

  it('группировка применяется и попадает в описание', () => {
    const { container } = render(<ListView config={cfg} data={data(rs())} urlState={false} />);
    fireEvent.change(screen.getByLabelText('Группировка'), { target: { value: 'area' } });
    expect(container.querySelectorAll('[data-group-key]')).toHaveLength(2);
    expect(screen.getByTestId('kit-list-desc').textContent).toContain('группировка: Область');
  });
});

describe('строка-описание — снимаемые чипы', () => {
  it('каждое условие фильтра — чип со своим крестиком; крестик снимает только его', () => {
    const { container } = render(
      <ListView config={cfg} data={data(rs())} urlState={false} initial={{ filters: { status: ['done'], area: ['ui'] } }} />,
    );
    expect(ids(container)).toEqual(['c']);
    const desc = screen.getByTestId('kit-list-desc');
    fireEvent.click(within(desc).getByRole('button', { name: 'Убрать: Статус: готово' }));
    expect(ids(container)).toEqual(['a', 'c']);
    expect(within(desc).queryByRole('button', { name: 'Убрать: Статус: готово' })).toBeNull();
    expect(within(desc).getByRole('button', { name: 'Убрать: Область: ui' })).toBeTruthy();
  });

  it('активное «Быстро» — тоже чип, снимается крестиком', () => {
    const { container } = render(<ListView config={cfg} data={data(rs())} urlState={false} initial={{ quick: 'done' }} />);
    expect(ids(container)).toEqual(['b', 'c']);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать: Быстро: готово' }));
    expect(ids(container)).toEqual(['a', 'b', 'c']);
  });
});

describe('быстрые иконки', () => {
  it('«Быстро» по статусу — иконка статуса; приложение может задать свою', () => {
    const { container } = render(
      <ListView config={cfg} data={data(rs())} urlState={false} quickIcons={{ ui: 'palette' }} />,
    );
    const quick = container.querySelector('.sk-list__quick')!;
    expect(quick.querySelector('[data-quick-icon="divided-spiral"]')).toBeTruthy();
    expect(quick.querySelector('[data-quick-icon="palette"]')).toBeTruthy();
  });

  it('axe — без нарушений со строкой управления и чипами', async () => {
    const { container } = render(
      <ListView config={cfg} data={data(rs())} urlState={false} initial={{ filters: { status: ['done'] }, quick: 'ui' }} />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
