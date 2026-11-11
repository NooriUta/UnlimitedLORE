// @vitest-environment jsdom
// Значения-чипы в ячейке списка: подпись словами, фильтр по коду
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29).
//
// Тот же договор, что в «Свойствах»: значение приходит объектом
// `{id, label, inherited_from}`. В ячейке списка это важно дважды:
//  • показать надо ПОДПИСЬ («UnlimitedLORE»), а не код («NooriUta/UnlimitedLORE»);
//  • фильтровать и группировать надо по КОДУ, иначе один проект с двумя
//    подписями даст две группы, а фасет — два значения.
//
// Второе — не косметика: до разбора чипов `valueKey` падал в JSON.stringify, и
// фасет по проекту ломался молча.
import { describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';
import { valueKey, valuesOf } from './listModel';

const chip = (id: string, label?: string | null) => ({ id, label: label ?? null, inherited_from: null });

const config = {
  modules: [], menu: { groups: [] },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  kinds: { item: { title: 'Предмет', icon: 'scroll-quill', fields: [{ key: 'projects', title: 'Проекты', type: 'ref' }] } },
  list: { views: ['list'], columns: ['title+id', 'fields.projects'], filters: ['fields.projects'], groupings: ['fields.projects'], showClosed: 'all' },
} as unknown as KitConfig;

const rec = (id: string, projects: unknown): KitRecord =>
  ({ id, kind: 'item', title: `Запись ${id}`, status: 'todo', fields: { projects } });

function draw(records: KitRecord[]) {
  const data: KitData = { records, edges: [], journal: [], meta: { generated_at: '2026-11-10T12:00:00Z', total: records.length } };
  return render(<ListView config={config} data={data} urlState={false} />);
}

describe('S4-29 · чип в ячейке списка', () => {
  it('положительный контроль: строковое значение видно как раньше', () => {
    const { container } = draw([rec('a', ['СТРОКА'])]);
    expect(container.textContent).toMatch(/СТРОКА/);
  });

  it('видна подпись чипа, а не его код', () => {
    const { container } = draw([rec('a', [chip('NooriUta/UnlimitedLORE', 'UnlimitedLORE')])]);
    const row = container.querySelector('[data-record-id="a"]') as HTMLElement;
    expect(within(row).getByText('UnlimitedLORE')).toBeTruthy();
    expect(row.textContent, 'код вместо подписи').not.toMatch(/NooriUta/);
  });

  it('подписи нет — виден код, а не пустота и не JSON', () => {
    const { container } = draw([rec('a', [chip('LORE', null)])]);
    const row = container.querySelector('[data-record-id="a"]') as HTMLElement;
    expect(row.textContent).toMatch(/LORE/);
    expect(row.textContent).not.toMatch(/[{}]|\[object/);
  });
});

describe('S4-29 · ключ значения — код, а не подпись', () => {
  it('valueKey чипа равен его коду', () => {
    expect(valueKey(chip('NooriUta/UnlimitedLORE', 'UnlimitedLORE'))).toBe('NooriUta/UnlimitedLORE');
  });

  it('valueKey обычного объекта по-прежнему JSON — прежнее поведение не тронуто', () => {
    expect(valueKey({ a: 1 })).toBe('{"a":1}');
  });

  it('один код с двумя подписями — ОДНО значение, а не два', () => {
    const r = rec('a', [chip('LORE', 'Подпись раз'), chip('LORE', 'Подпись два')]);
    expect(valuesOf(r, 'fields.projects'), 'иначе фасет и группировка раздвоятся').toEqual(['LORE']);
  });

  it('два чипа с одним кодом в ОДНОЙ записи не задваивают значение', () => {
    const r = rec('x', [chip('LORE', 'A'), chip('LORE', 'B')]);
    expect(valuesOf(r, 'fields.projects'), 'иначе фасет и группировка раздвоятся').toEqual(['LORE']);
  });
});
