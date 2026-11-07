// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-09 — вид «Дерево / книга» (третий в list.views).
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../../core/contract';
import { KitLangProvider } from '../../i18n';
import { TreeView, treeViewEnabled } from './TreeView';
import { TREE_FIXTURE, TREE_FIXTURE_CONFIG } from './fixture';
import { axeViolations } from '../../test/axe';

const rec = (id: string, parent: string | null, order: number, status = 'todo', fields: Record<string, unknown> = {}): KitRecord => ({
  id, kind: 'node', title: `Узел ${id}`, status, fields: { parent, order, ...fields },
});

const CONFIG: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { node: { title: 'Узел', icon: 'scroll-unfurled' } },
  statuses: { items: [
    { code: 'todo', title: 'К работе', category: 'todo', icon: 'checkbox-tree', color: 'var(--t3)' },
    { code: 'done', title: 'Готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: { views: ['list', 'board', 'tree'], tree: { parent: 'parent', order: 'order', rollup: 'status' } },
};
const DATA: KitData = {
  records: [rec('b', 'r', 2), rec('r', null, 1), rec('a', 'r', 1, 'done'), rec('a1', 'a', 1, 'done', { tag: 'x' })],
  edges: [], journal: [], meta: { generated_at: '2026-11-07T00:00:00Z' },
};

const ui = (props: Partial<Parameters<typeof TreeView>[0]> = {}) => (
  <KitLangProvider lang="ru"><TreeView data={DATA} config={CONFIG} {...props} /></KitLangProvider>
);
const items = () => screen.getAllByRole('treeitem');

describe('K-09 · TreeView', () => {
  it('treeViewEnabled: вид включён только при tree в list.views и описании list.tree', () => {
    expect(treeViewEnabled(CONFIG)).toBe(true);
    expect(treeViewEnabled({ ...CONFIG, list: { views: ['list', 'tree'] } })).toBe(false);
    expect(treeViewEnabled({ ...CONFIG, list: { views: ['list'], tree: CONFIG.list!.tree } })).toBe(false);
  });

  it('по умолчанию раскрыт первый уровень: корень и его дети по order; aria-level/posinset', () => {
    render(ui());
    expect(screen.getByRole('tree')).toBeTruthy();
    expect(items().map(i => i.getAttribute('data-id'))).toEqual(['r', 'a', 'b']);
    const a = items()[1];
    expect(a.getAttribute('aria-level')).toBe('2');
    expect(a.getAttribute('aria-posinset')).toBe('1');
    expect(a.getAttribute('aria-setsize')).toBe('2');
    expect(a.getAttribute('aria-expanded')).toBe('false');
  });

  it('кнопка-шеврон раскрывает и сворачивает узел; цель ≥ --tap (класс sk-iconbtn)', () => {
    render(ui());
    const toggle = screen.getByRole('button', { name: 'Развернуть «Узел a»' });
    expect(toggle.className).toContain('sk-iconbtn');
    fireEvent.click(toggle);
    expect(items().map(i => i.getAttribute('data-id'))).toEqual(['r', 'a', 'a1', 'b']);
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть «Узел r»' }));
    expect(items().map(i => i.getAttribute('data-id'))).toEqual(['r']);
  });

  it('уровни: «Все» раскрывает книгу целиком, «1» сворачивает обратно', () => {
    render(ui());
    fireEvent.click(screen.getByRole('button', { name: 'Раскрыть все уровни' }));
    expect(items()).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Раскрыть до уровня 1' }));
    expect(items()).toHaveLength(3);
  });

  it('свёртка статуса вверх: у корня «готово 2 из 3»', () => {
    render(ui());
    const root = items()[0];
    expect(within(root).getByText('2/3')).toBeTruthy();
  });

  it('фильтр показывает совпадения с предками и «N из M» на уровне', () => {
    render(ui());
    fireEvent.change(screen.getByRole('searchbox', { name: 'Фильтр дерева' }), { target: { value: 'a1' } });
    expect(items().map(i => i.getAttribute('data-id'))).toEqual(['r', 'a', 'a1']);
    expect(items()[2].getAttribute('data-match')).toBe('true');
    expect(items()[1].getAttribute('data-match')).toBe('false');
    expect(within(items()[0]).getByText('1 из 2')).toBeTruthy();
  });

  it('фильтр без совпадений — честное «пусто» с кнопкой сброса, а не пустой лист', () => {
    render(ui());
    fireEvent.change(screen.getByRole('searchbox', { name: 'Фильтр дерева' }), { target: { value: 'нет-такого' } });
    expect(screen.queryByRole('treeitem')).toBeNull();
    expect(document.querySelector('[data-state="empty"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтр' }));
    expect(items()).toHaveLength(3);
  });

  it('вид не настроен — явное сообщение, а не пустота', () => {
    render(ui({ config: { ...CONFIG, list: { views: ['list'] } } }));
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByText(/не настроен/)).toBeTruthy();
  });

  it('сбой вердикта гасит только свой узел (errBlock строки), дерево живо', () => {
    const cfg: KitConfig = {
      ...CONFIG,
      list: { views: ['tree'], tree: { parent: 'parent', order: 'order', rollup: 'verdict' } },
      verdict: r => { if (r.id === 'b') throw new Error('boom'); return { score: 3, max: 4, failed: ['x'], hints: [] }; },
    };
    render(ui({ config: { ...cfg, list: { ...cfg.list!, views: ['list', 'board', 'tree'] } } }));
    const b = items().find(i => i.getAttribute('data-id') === 'b')!;
    expect(within(b).getByText('Вердикт не посчитан')).toBeTruthy();
    expect(items()).toHaveLength(3);
  });

  it('клавиатура: стрелки вниз/вправо/влево двигают фокус и раскрывают', () => {
    render(ui());
    act(() => items()[0].focus());
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-id')).toBe('a');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(items().map(i => i.getAttribute('data-id'))).toContain('a1');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(items().map(i => i.getAttribute('data-id'))).not.toContain('a1');
  });

  it('выбор узла отдаёт id наружу (onOpen) и ведёт по href', () => {
    let opened = '';
    render(ui({ onOpen: id => { opened = id; }, href: id => `#rec=${id}` }));
    const link = screen.getByRole('link', { name: 'Узел a' });
    expect(link.getAttribute('href')).toBe('#rec=a');
    fireEvent.click(link);
    expect(opened).toBe('a');
  });

  it('фикстура ~500 узлов: рисуется, «Все» раскрывает все строки', () => {
    render(<KitLangProvider lang="ru"><TreeView data={TREE_FIXTURE} config={TREE_FIXTURE_CONFIG} /></KitLangProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Раскрыть все уровни' }));
    expect(items()).toHaveLength(TREE_FIXTURE.records.length);
  });

  it('urlSync: фильтр и уровень пишутся в URL и восстанавливаются при новом монтировании', () => {
    window.history.replaceState(null, '', '/kit');
    const first = render(ui({ urlSync: true }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Фильтр дерева' }), { target: { value: 'a1' } });
    expect(new URLSearchParams(window.location.search).get('tq')).toBe('a1');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Фильтр дерева' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Раскрыть все уровни' }));
    expect(new URLSearchParams(window.location.search).get('tlvl')).toBe('all');
    first.unmount();
    render(ui({ urlSync: true }));
    expect(items()).toHaveLength(4);
    window.history.replaceState(null, '', '/');
  });

  it('axe: без нарушений', async () => {
    const { container } = render(ui());
    expect(await axeViolations(container)).toEqual([]);
  });
});
