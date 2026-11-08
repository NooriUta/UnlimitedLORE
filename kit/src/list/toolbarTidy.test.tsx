// @vitest-environment jsdom
// Полоса управления списка — разбор скрина владелицы 08.11 после v1.17.0
// («почему все шрифты скачут… разобраться с элементами»).
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

const rec = (id: string, status: string, fields: Record<string, unknown> = {}): KitRecord => ({ id, kind: 'task', title: `Запись ${id}`, status, fields });
const cfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { task: { title: 'Задачи', icon: 'checkbox-tree', fields: [{ key: 'prio', title: 'Приоритет', type: 'number' }, { key: 'area', title: 'Область', type: 'enum' }] } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }, { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' }] },
  list: { views: ['list'], quick: [{ id: 'done', title: 'готово', filter: { status: 'done' } }], filters: ['status', 'area'], groupings: ['status', 'area'], columns: ['title+id', 'status', 'fields.prio'] },
};
const data = (records: KitRecord[]): KitData => ({ records, edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z', total: records.length } });
const rs = () => [rec('a', 'todo', { prio: 3, area: 'ui' }), rec('b', 'done', { prio: 1, area: 'api' }), rec('c', 'done', { prio: 2, area: 'ui' })];
const ids = (c: HTMLElement) => [...c.querySelectorAll('[data-record-id]')].map(r => r.getAttribute('data-record-id'));

describe('элементы полосы', () => {
  it('(а) «Группировка» не повторяется: подпись — в рамке сегмента, в кнопке только значение', () => {
    render(<ListView config={cfg} data={data(rs())} urlState={false} initial={{ group: 'status' }} />);
    const seg = screen.getByRole('group', { name: 'Группировка' });
    const btn = within(seg).getByRole('button', { name: 'Группировка: Статус' });
    expect(btn.textContent).not.toMatch(/Группировка/);
    expect(btn.textContent).toContain('Статус');
  });

  it('(б) «Порядок» — меню kit, а не системный выпадающий список', () => {
    const { container } = render(<ListView config={cfg} data={data(rs())} urlState={false} />);
    const seg = screen.getByRole('group', { name: 'Порядок' });
    expect(seg.querySelector('select')).toBeNull();
    fireEvent.click(within(seg).getByRole('button', { name: /^Порядок:/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Порядок' })).getByRole('radio', { name: 'Приоритет' }));
    expect(ids(container)).toEqual(['b', 'c', 'a']);
    expect(within(seg).getByRole('button', { name: 'Порядок: Приоритет' }).textContent).not.toMatch(/Порядок/);
    fireEvent.click(screen.getByRole('button', { name: 'по убыванию' }));
    expect(ids(container)).toEqual(['a', 'c', 'b']);
  });
});

describe('типографика полосы: один кегль (шрифты не скачут)', () => {
  const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
  const sizeOf = (sel: string) => {
    const start = css.indexOf(`\n${sel} {`);
    if (start < 0) return null;
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
    const m = [null, body];
    return m?.[1].match(/font-size:\s*([^;]+);/)?.[1].trim() ?? null;
  };
  const STRIP = ['.sk-list__quick .sk-pill', '.sk-list__seglabel', '.sk-list__label', '.sk-list__segcount', '.sk-list__qcount', '.sk-list__search', '.sk-list__dir', '.sk-facet__btn', '.sk-facet__op', '.sk-list__shown'];
  it('положительный контроль: разбор находит размер правила', () => {
    expect(sizeOf('.sk-list__search')).not.toBeNull();
  });
  it.each(STRIP)('%s — var(--fs-sm)', sel => {
    expect(sizeOf(sel)).toBe('var(--fs-sm)');
  });
  it('(в) режимы фасета «есть / нет / пусто / не пусто» не переносятся по словам', () => {
    const op = css.match(/\n\.sk-facet__op\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(op).toMatch(/white-space:\s*nowrap/);
  });
  const ruleOf = (sel: string) => {
    const start = css.indexOf(`\n${sel} {`);
    return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  };
  it('(е) фасет — скруглённые углы, но не «эллипс», как в MVP (08.11)', () => {
    expect(ruleOf('.sk-facet__ops')).toMatch(/border-radius:\s*var\(--r-md\)/);
    expect(ruleOf('.sk-facet__op')).toMatch(/border-radius:\s*var\(--r-sm\)/);
  });
  it('(д) «Быстро»: число — простым текстом, как в v1, а не шариком выше пилюли (08.11)', () => {
    const q = ruleOf('.sk-list__qcount');
    expect(q).not.toBe('');
    expect(q).not.toMatch(/background|padding|border-radius/);
    expect(q).toMatch(/line-height:\s*1\b/);
  });
});

describe('«Быстро» — иконка 12 px, как в v1', () => {
  it('иконка быстрого фильтра — 12', () => {
    const { container } = render(<ListView config={cfg} data={data(rs())} urlState={false} quickIcons={{ done: 'check-mark' }} />);
    const icon = container.querySelector('.sk-list__qicon > *') as HTMLElement | null;
    expect(icon).not.toBeNull(); // положительный контроль: иконка нарисована (или заглушка того же размера)
    expect(icon!.getAttribute('width') ?? icon!.style.width.replace('px', '')).toBe('12');
  });
});
