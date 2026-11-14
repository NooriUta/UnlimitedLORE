// @vitest-environment jsdom
// SPRINT_UXR_POLISH_UAT_1113/PU-23 (вторая ветка правила владелицы 14.11.2026): «список при наличии
// дочернего элемента встроит его дочернюю таблицу … если объекты разные, и унифицированно — если это
// иерархия (ссылка сама на себя однотипных объектов)». Дети ДРУГОГО типа — вложенная таблица (#1387).
// Здесь — ТОТ ЖЕ тип: в виде «Таблица» дети идут строками той же таблицы, с отступом по глубине и
// кнопкой раскрытия у родителя. Родителя список знает из той же настройки, что и вид «Дерево» —
// list.tree.parent (S4-22); второй настройки нет.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import type { UrlWindow } from '../resilience/urlState';
import { ListView } from './ListView';
import { hierarchyRows } from './hierarchy';

beforeAll(() => { registerGameIcons(gameIcons); });

const comp = (id: string, title: string, parent = ''): KitRecord => ({ id, kind: 'component', title, status: '', fields: { parent, area: 'core' } });
// Корни: A (дети A1, A2; у A1 — внук A1a) и B (без детей).
const recs: KitRecord[] = [
  comp('A', 'Альфа'), comp('A1', 'Альфа один', 'A'), comp('A2', 'Альфа два', 'A'), comp('A1a', 'Альфа один а', 'A1'), comp('B', 'Бета'),
];
const cfg = (tree = true): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { component: { title: 'Компоненты', icon: 'cog', fields: [{ key: 'parent', title: 'Родитель', type: 'ref' }, { key: 'area', title: 'Область', type: 'text' }] } },
  statuses: { items: [] },
  list: { views: ['list'], columns: ['id', 'title', 'area'], ...(tree ? { tree: { parent: 'parent', order: 'title' } } : {}) },
});
const data = (records = recs): KitData => ({ records, edges: [], journal: [], meta: { generated_at: '2026-11-14T00:00:00Z', total: records.length } });
const ids = () => [...document.querySelectorAll('tbody tr[data-record-id]')].map(tr => tr.getAttribute('data-record-id'));
const depthOf = (id: string) => document.querySelector(`tr[data-record-id="${id}"]`)!.getAttribute('data-depth');

function fakeWin(search = ''): UrlWindow & { pushed: string[] } {
  const pushed: string[] = [];
  return {
    location: { search, hash: '', pathname: '/components' },
    history: {
      pushState: (_s: unknown, _t: string, url: string | URL | null | undefined) => { pushed.push(String(url)); },
      replaceState: (_s: unknown, _t: string, url: string | URL | null | undefined) => { pushed.push(String(url)); },
    },
    pushed,
  } as UrlWindow & { pushed: string[] };
}

describe('PU-23 · иерархия одного типа в виде «Таблица»', () => {
  it('корни сверху, дети свёрнуты; у строки с детьми — кнопка раскрытия aria-expanded', () => {
    render(<ListView config={cfg()} data={data()} urlState={false} />);
    expect(ids()).toEqual(['A', 'B']);
    const btn = screen.getByRole('button', { name: 'Показать вложенные: Альфа' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    // У листа кнопки нет — нечего раскрывать.
    expect(screen.queryByRole('button', { name: /вложенные: Бета/ })).toBeNull();
  });

  it('раскрытие: дети строками под родителем, с отступом по глубине и в тех же колонках', () => {
    render(<ListView config={cfg()} data={data()} urlState={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать вложенные: Альфа' }));
    expect(ids()).toEqual(['A', 'A1', 'A2', 'B']);
    expect(depthOf('A')).toBe('0');
    expect(depthOf('A1')).toBe('1');
    const cellsOf = (id: string) => document.querySelector(`tr[data-record-id="${id}"]`)!.querySelectorAll('td').length;
    expect(cellsOf('A1')).toBe(cellsOf('A'));
    // Отступ — уровнем в стиле (--tree-lvl), а не сырой шириной.
    const ind = document.querySelector('tr[data-record-id="A1"] .sk-list__tree') as HTMLElement;
    expect(ind.style.getPropertyValue('--tree-lvl')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Показать вложенные: Альфа один' }));
    expect(ids()).toEqual(['A', 'A1', 'A1a', 'A2', 'B']);
    expect(depthOf('A1a')).toBe('2');
  });

  it('сворачивание прячет всё поддерево; клавиатура — Enter на кнопке', () => {
    render(<ListView config={cfg()} data={data()} urlState={false} />);
    const btn = screen.getByRole('button', { name: 'Показать вложенные: Альфа' });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть вложенные: Альфа' }));
    expect(ids()).toEqual(['A', 'B']);
    // Стрелка вправо раскрывает, влево — сворачивает (как в дереве).
    fireEvent.keyDown(screen.getByRole('button', { name: 'Показать вложенные: Альфа' }), { key: 'ArrowRight' });
    expect(ids()).toEqual(['A', 'A1', 'A2', 'B']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Скрыть вложенные: Альфа' }), { key: 'ArrowLeft' });
    expect(ids()).toEqual(['A', 'B']);
  });

  it('поиск нашёл внука — виден путь до него (родители — строками пути), всё свёрнутое раскрыто', () => {
    render(<ListView config={cfg()} data={data()} urlState={false} initial={{ text: 'один а' }} />);
    expect(ids()).toEqual(['A', 'A1', 'A1a']);
    expect(document.querySelector('tr[data-record-id="A"]')!.getAttribute('data-tree-path')).toBe('true');
    expect(document.querySelector('tr[data-record-id="A1a"]')!.getAttribute('data-tree-path')).toBeNull();
  });

  it('порядок — внутри уровня: дети не уезжают от родителя', () => {
    // По возрастанию: «Альфа два» раньше «Альфа один» — соседи переставлены, но остаются под A.
    const { unmount } = render(<ListView config={cfg()} data={data()} urlState={false} initial={{ sort: { key: 'title', dir: 'asc' } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать вложенные: Альфа' }));
    expect(ids()).toEqual(['A', 'A2', 'A1', 'B']);
    unmount();
    // По убыванию: корни B, A; дети A — тоже по убыванию, и всё ещё сразу под A.
    render(<ListView config={cfg()} data={data()} urlState={false} initial={{ sort: { key: 'title', dir: 'desc' } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать вложенные: Альфа' }));
    expect(ids()).toEqual(['B', 'A', 'A1', 'A2']);
  });

  it('раскрытие — в адресе (lh) и восстанавливается по ссылке', () => {
    const win = fakeWin();
    const { unmount } = render(<ListView config={cfg()} data={data()} urlState={win} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать вложенные: Альфа' }));
    expect(win.pushed[win.pushed.length - 1]).toContain('lh=A');
    unmount();
    render(<ListView config={cfg()} data={data()} urlState={fakeWin('?lh=A,A1')} />);
    expect(ids()).toEqual(['A', 'A1', 'A1a', 'A2', 'B']);
  });

  it('без list.tree — прежний плоский список (иерархии не выдумываем)', () => {
    render(<ListView config={cfg(false)} data={data()} urlState={false} />);
    expect(ids()).toEqual(['A', 'A1', 'A2', 'A1a', 'B']);
    expect(document.querySelector('.sk-list__tree')).toBeNull();
  });

  it('вложенная таблица другого типа (expand.render, #1387) не задета', () => {
    render(<ListView config={cfg()} data={data()} urlState={false} expand={{ render: r => `задачи ${r.id}` }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Раскрыть: Альфа' }));
    expect(screen.getByText('задачи A')).toBeTruthy();
    // раскрытие вложенного и раскрытие иерархии — разные кнопки и разные состояния
    expect(ids()).toEqual(['A', 'B']);
  });
});

describe('hierarchyRows — модель', () => {
  it('родитель, которого нет в данных, — строка уходит в корень; цикл не вешает', () => {
    const cyc = [comp('X', 'икс', 'Y'), comp('Y', 'игрек', 'X'), comp('Z', 'зет', 'NOPE')];
    const rows = hierarchyRows(cyc, cyc, 'parent', new Set(['X', 'Y']), false);
    expect(rows.map(r => r.record.id).sort()).toEqual(['X', 'Y', 'Z']);
    expect(rows.find(r => r.record.id === 'Z')!.depth).toBe(0);
  });

  it('родитель списком (несколько рёбер) — берётся первый', () => {
    const rs = [comp('P', 'п'), { ...comp('C', 'ц'), fields: { parent: ['P', 'Q'] } }];
    const rows = hierarchyRows(rs, rs, 'parent', new Set(['P']), false);
    expect(rows.map(r => [r.record.id, r.depth])).toEqual([['P', 0], ['C', 1]]);
  });
});
