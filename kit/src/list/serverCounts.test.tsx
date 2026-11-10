// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-01, клиентская половина — счётчики приходят ДАННЫМИ.
//
// Список не ходит в сеть (K-14): числа по всей выдаче ему передаёт приложение
// свойством `counts`, как и сами записи. Здесь закреплено, что список ими
// пользуется и что каждое «не посчитали» названо своими словами, а не нулём.
//
// Выдача в фикстуре нарочно обрезана: загружено две строки из четырёхсот. До
// этой правки фасет показывал «1» и «1» рядом с «Показано 2 из 400» — и это
// читалось как «в релизе одна запись».
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import type { AxisCounts, ListCounts } from './listCounts';

beforeAll(() => { registerGameIcons(gameIcons); });

const rec = (id: string, status: string, rel: string[]): KitRecord =>
  ({ id, kind: 'sprint', title: id, status, fields: { rel } });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринты', icon: 'sprint', fields: [{ key: 'rel', title: 'Разрез', type: 'ref' }] } },
  statuses: {
    items: [
      { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
      { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
    ],
  },
  list: {
    views: ['list'],
    quick: [{ id: 'q-todo', title: 'К работе', filter: { status: 'todo' } }],
    filters: ['fields.rel'],
    columns: ['title+id', 'status'],
  },
};

const data: KitData = {
  records: [rec('A', 'todo', ['r1']), rec('B', 'done', ['r2'])],
  edges: [], journal: [],
  meta: { generated_at: '2026-11-10T00:00:00Z', total: 400, returned: 2, truncated: true },
};

const axis = (over: Partial<AxisCounts> = {}): AxisCounts =>
  ({ values: [{ value: 'r1', count: 240 }, { value: 'r2', count: 150 }], empty: 10, nonempty: 390, total: 400, ...over });

const relPanel = () => {
  const btn = screen.getByRole('button', { name: /^Разрез/ });
  fireEvent.click(btn);
  return document.getElementById(btn.getAttribute('aria-controls')!)!;
};
const countOf = (panel: HTMLElement, name: RegExp) =>
  within(panel).getByRole('checkbox', { name }).closest('label')!.querySelector('.sk-facet__n')!;
const quickCount = () => document.querySelector('.sk-list__qcount')!;
const notes = () => screen.queryByTestId('kit-list-counts')?.textContent ?? '';

describe('S9-01 · числа фасета — по всей выдаче, а не по загруженной странице', () => {
  it('положительный контроль: без счётчиков источника числа прежние — по странице, и так помечены', () => {
    render(<ListView config={cfg} data={data} urlState={false} />);
    const panel = relPanel();
    const n = countOf(panel, /r1/);
    expect(n.textContent).toBe('1');
    expect(n.getAttribute('data-src')).toBe('page');
    expect(within(panel).getByText(/по загруженным строкам/)).toBeTruthy();
  });

  it('ось посчитана источником — в панели его числа, и сказано, что они по всей выдаче', () => {
    const counts: ListCounts = { kind: 'counted', axes: { 'fields.rel': axis() }, completeness: 'complete' };
    render(<ListView config={cfg} data={data} urlState={false} counts={counts} />);
    const panel = relPanel();
    const n = countOf(panel, /r1/);
    expect(n.textContent).toBe('240');
    expect(n.getAttribute('data-src')).toBe('all');
    // «Пусто / не пусто» — тоже числа источника, а не пересчёт по странице.
    expect(within(panel).getByRole('radio', { name: /^пусто/ }).textContent).toContain('10');
    expect(notes()).toBe('');
  });

  it('ось НЕ посчитана — «?» с причиной, и это отличимо от нуля', () => {
    const counts: ListCounts = { kind: 'counted', axes: {}, unavailable: { 'fields.rel': 'разрез по этому полю не считается' } };
    render(<ListView config={cfg} data={data} urlState={false} counts={counts} />);
    const panel = relPanel();
    const n = countOf(panel, /r1/);
    expect(n.textContent).toBe('?');
    expect(n.getAttribute('data-unknown')).not.toBeNull();
    expect(n.getAttribute('title')).toContain('разрез по этому полю не считается');
    expect(within(panel).getByText(/не посчитаны/)).toBeTruthy();
  });

  it('у записи бывает несколько значений — сумма больше итога, и это названо нормой', () => {
    const counts: ListCounts = { kind: 'counted', axes: { 'fields.rel': axis({ multi: true }) } };
    render(<ListView config={cfg} data={data} urlState={false} counts={counts} />);
    const panel = relPanel();
    expect(within(panel).getByText(/несколько значений/)).toBeTruthy();
  });
});

describe('S9-01 · неполный счёт и отказы — словами, а не нулём', () => {
  it('partial и предел — сказаны оба: что обрезано и каким числом', () => {
    const counts: ListCounts = {
      kind: 'counted', axes: { 'fields.rel': axis() }, completeness: 'partial',
      cap: { parts: ['totals', 'fields.rel'], limit: 1000 },
    };
    render(<ListView config={cfg} data={data} urlState={false} counts={counts} />);
    expect(notes()).toMatch(/1000/);
    expect(notes()).toMatch(/не по всей выдаче/);
  });

  it('«целиком ли — неизвестно» не выдаётся за «целиком»', () => {
    const counts: ListCounts = { kind: 'counted', axes: { 'fields.rel': axis() }, completeness: 'unknown' };
    render(<ListView config={cfg} data={data} urlState={false} counts={counts} />);
    expect(notes()).toMatch(/неизвестно/);
  });

  it('счётчиков у раздела не бывает — так и сказано, а числа остаются по странице', () => {
    render(<ListView config={cfg} data={data} urlState={false} counts={{ kind: 'unsupported' }} />);
    expect(notes()).toMatch(/не бывает/);
    const n = countOf(relPanel(), /r1/);
    expect(n.textContent).toBe('1');
    expect(n.getAttribute('data-src')).toBe('page');
  });

  it('нет разрешённых проектов — это сказано, а не показано нулями', () => {
    render(<ListView config={cfg} data={data} urlState={false} counts={{ kind: 'forbidden' }} />);
    expect(notes()).toMatch(/разрешённых/);
    expect(countOf(relPanel(), /r1/).textContent).toBe('?');
  });

  it('счёт сбойнул — причина названа, числа оси — «?»', () => {
    render(<ListView config={cfg} data={data} urlState={false} counts={{ kind: 'failed', reason: 'HTTP 500' }} />);
    expect(notes()).toMatch(/HTTP 500/);
    expect(countOf(relPanel(), /r1/).textContent).toBe('?');
  });
});

describe('S9-01 · «Быстро» — тот же счёт по всей выдаче', () => {
  it('число «Быстро» берётся у источника, когда условие — одно поле и одно значение', () => {
    const counts: ListCounts = { kind: 'counted', axes: { status: { values: [{ value: 'todo', count: 320 }], empty: 0, nonempty: 400, total: 400 } } };
    render(<ListView config={cfg} data={data} urlState={false} counts={counts} />);
    expect(quickCount().textContent).toBe('320');
    expect(quickCount().getAttribute('data-src')).toBe('all');
  });

  it('ось «Быстро» не посчитана — «?» с подсказкой, а не ноль (и чип не исчезает)', () => {
    const counts: ListCounts = { kind: 'counted', axes: {}, unavailable: { status: 'ось не посчитана' } };
    render(<ListView config={cfg} data={data} urlState={false} counts={counts} />);
    expect(quickCount().textContent).toBe('?');
    expect(quickCount().getAttribute('title')).toContain('ось не посчитана');
  });

  it('без счётчиков источника — прежнее число по странице, помеченное как таковое', () => {
    render(<ListView config={cfg} data={data} urlState={false} />);
    expect(quickCount().textContent).toBe('1');
    expect(quickCount().getAttribute('data-src')).toBe('page');
  });
});

describe('S9-01 · выдача не обрезана — оговорки нет, потому что лгать не о чем', () => {
  const whole: KitData = {
    records: [rec('A', 'todo', ['r1']), rec('B', 'done', ['r2'])],
    edges: [], journal: [], meta: { generated_at: '2026-11-10T00:00:00Z', total: 2, returned: 2 },
  };

  it('всё загружено — числа страницы И ЕСТЬ числа выдачи: «по всей выдаче», без ложной тревоги', () => {
    render(<ListView config={cfg} data={whole} urlState={false} />);
    const panel = relPanel();
    expect(countOf(panel, /r1/).getAttribute('data-src')).toBe('all');
    expect(within(panel).queryByText(/по загруженным строкам/)).toBeNull();
    expect(quickCount().getAttribute('data-src')).toBe('all');
  });
});
