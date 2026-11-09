// @vitest-environment jsdom
// Паспорт по видам связей (UML, D-2026-LORE-RECORD-RELATION-UML; владелица 08.11: «твоя задача — сделать
// в паспорте классификации и возможность управления и визуализации от этих типов связей»).
// Kit не знает типов записей: вид связи и ребро приходят в KindConfig.relations.
//  composition ◆ — дочки (спринт → задачи): своя вкладка, отвязать нельзя, «+ создать» — через приложение;
//  aggregation ◇ — легче (ADR → решения, вопросы): своя вкладка, привязать / отвязать;
//  association ⇢ — («просто ассоциация — это зависимости») «Зависимости»: «зависит от» / «блокирует»;
//  attribute — поля-ссылки, их рисуют «Свойства», не вкладка;
//  realization ▷ — «Реализация»: что реализует / обосновывает;
//  generalization — строкой в шапке («заменяет X»).
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

const r = (id: string, kind: string, title: string, status = 'planned'): KitRecord => ({ id, kind, title, status, fields: {} });
const adr = r('ADR-1', 'adr', 'Главный ADR');
const records = [adr, r('D-1', 'decision', 'Решение 1'), r('D-2', 'decision', 'Решение 2'), r('ADR-0', 'adr', 'Старый ADR'), r('ADR-2', 'adr', 'База'), r('ADR-3', 'adr', 'Зависимый'), r('S-1', 'sprint', 'Спринт реализации'), r('T-1', 'task', 'Задача')];
const edges = [
  { from: 'D-1', to: 'ADR-1', type: 'DECIDED_IN' }, { from: 'D-2', to: 'ADR-1', type: 'DECIDED_IN' },
  { from: 'ADR-1', to: 'ADR-2', type: 'DEPENDS_ON' }, { from: 'ADR-3', to: 'ADR-1', type: 'DEPENDS_ON' },
  { from: 'ADR-1', to: 'S-1', type: 'IMPLEMENTED_IN' }, { from: 'ADR-1', to: 'ADR-0', type: 'SUPERSEDES' },
  { from: 'ADR-1', to: 'T-1', type: 'HAS_PART' },
];
const config = (onRelation?: NonNullable<KitConfig['hooks']>['onRelation']): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { adr: { title: 'ADR', icon: 'scroll-quill', fields: [], relations: [
    { key: 'parts', label: 'Части', relation: 'composition', rel: 'HAS_PART', dir: 'out' },
    { key: 'decisions', label: 'Решения', relation: 'aggregation', rel: 'DECIDED_IN', dir: 'in' },
    { key: 'deps', label: 'Зависит от', relation: 'association', rel: 'DEPENDS_ON', dir: 'out' },
    { key: 'blocks', label: 'Блокирует', relation: 'association', rel: 'DEPENDS_ON', dir: 'in' },
    { key: 'impl', label: 'Реализован в', relation: 'realization', rel: 'IMPLEMENTED_IN', dir: 'out' },
    { key: 'sup', label: 'Заменяет', relation: 'generalization', rel: 'SUPERSEDES', dir: 'out' },
    { key: 'comp', label: 'Компоненты', relation: 'attribute', rel: 'BELONGS_TO', dir: 'out' },
  ] } },
  statuses: { items: [{ code: 'planned', title: 'запланировано', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  roles: { reader: { canEdit: true, canStatus: false } },
  ...(onRelation ? { hooks: { onRelation } } : {}),
});
const ctxOf = (cfg: KitConfig): KitCtx => ({ config: cfg, data: { records, edges, journal: [], meta: { generated_at: '2026-11-08T00:00:00Z' } }, role: 'reader', href: id => `#${id}`, esc: s => s, md: s => s });
const view = (tab: string, cfg = config()) => render(<RecordView record={adr} ctx={ctxOf(cfg)} tab={tab} onTab={() => {}} placement="bottom" />);
const tabNames = () => screen.getAllByRole('tab').map(t => { const txt = (t.textContent ?? '').replace(/[◆◇⇢▷△]/g, ''); return t.getAttribute('data-relation') ? `${t.getAttribute('data-relation')}:${txt}` : txt; });

describe('паспорт по видам связей', () => {
  it('вкладки: композиция и агрегация — каждая своя, зависимости — одна вкладка, реализация — одна', () => {
    view('overview');
    const names = tabNames();
    expect(names).toEqual(expect.arrayContaining(['composition:Части1', 'aggregation:Решения2', 'association:Зависимости2', 'realization:Реализация1']));
  });
  // Значок вида связи остался у вкладки и у заголовка раздела, но ушёл из
  // строк: связи теперь таблица (замечание владелицы по v1.17.4 — «наши
  // любимые общие колонки»), а внутри одной таблицы вид связи у всех строк
  // один и тот же. Повторять его в каждой строке — шум, а не сведения.
  it('визуализация вида: значок UML у вкладки; строки — таблицей со своими кодами', () => {
    view('decisions');
    const tab = screen.getAllByRole('tab').find(t => t.getAttribute('data-relation') === 'aggregation')!;
    expect(tab.querySelector('[data-relation-mark]')?.textContent).toBe('◇');
    const rows = screen.getByTestId('kit-relation-list');
    expect(within(rows).getAllByRole('row').slice(1).map(tr => tr.getAttribute('data-record-id'))).toEqual(['D-1', 'D-2']);
  });
  it('зависимости — двумя разделами: «Зависит от» и «Блокирует»', () => {
    view('rel:association');
    expect(screen.getByRole('group', { name: 'Зависит от' }).textContent).toContain('База');
    expect(screen.getByRole('group', { name: 'Блокирует' }).textContent).toContain('Зависимый');
  });
  it('обобщение — строкой в шапке, не вкладкой', () => {
    const { container } = view('overview');
    expect(container.querySelector('[data-relation-line="generalization"]')?.textContent).toMatch(/Заменяет.*Старый ADR/);
    expect(tabNames().some(n => n?.startsWith('generalization'))).toBe(false);
    expect(tabNames().some(n => n?.startsWith('attribute'))).toBe(false); // поля-ссылки — в «Свойствах»
  });

  // Проверка та же, но с ожиданием ответа. Причина: вызов хука стал
  // асинхронным намеренно — отказ привязки раньше проглатывался (`void
  // call(...)`), и неудача выглядела как успех. Теперь группа ждёт ответ,
  // чтобы напечатать причину и не терять введённый код, поэтому второй вызов
  // случается на следующий тик, а не в том же.
  it('управление: агрегацию и зависимость можно отвязать и привязать — через hooks.onRelation', async () => {
    const onRelation = vi.fn(async () => {});
    view('decisions', config(onRelation));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отвязать: Решение 1' })); });
    expect(onRelation).toHaveBeenCalledWith({ type: 'adr', id: 'ADR-1', rel: 'DECIDED_IN', dir: 'in', target: 'D-1', action: 'remove' });
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Привязать: Решения' }), { target: { value: 'D-9' } });
      fireEvent.click(screen.getByRole('button', { name: 'Привязать' }));
    });
    expect(onRelation).toHaveBeenLastCalledWith({ type: 'adr', id: 'ADR-1', rel: 'DECIDED_IN', dir: 'in', target: 'D-9', action: 'add' });
  });
  it('композицию отвязать нельзя — дочь без родителя не живёт', () => {
    view('parts', config(vi.fn(async () => {})));
    expect(screen.queryByRole('button', { name: /^Отвязать/ })).toBeNull();
    expect(screen.getByTestId('kit-relation-list').textContent).toContain('Задача');
  });
  it('без hooks.onRelation — только чтение, кнопок управления нет', () => {
    view('decisions');
    expect(screen.queryByRole('button', { name: /^Отвязать/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /^Привязать/ })).toBeNull();
  });
});
