// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-03 — панель фасета на 428 значениях.
//
// До этой правки панель рисовала все значения одним списком: первый экран
// содержал сотни чекбоксов, а отмеченное значение стояло там, куда его увёл
// счёт. Здесь закреплено, что человек видит в панели: разделы с подписями,
// отмеченное сверху всегда, и число непоказанных — числом.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { FacetFilter } from './FacetFilter';
import { FACET_SCALE } from './facetSections';
import type { Facet, FieldFilter } from './filterModel';

const N = 428;
const values = Array.from({ length: N }, (_, i) => ({ value: `v-${String(i + 1).padStart(3, '0')}`, count: N - i }));
const facet: Facet = { values, empty: 7, nonempty: N, total: N + 7 };

function open(over: Partial<ComponentProps<typeof FacetFilter>> = {}) {
  const filter: FieldFilter = over.filter ?? { op: 'any', values: [] };
  render(
    <FacetFilter
      title="Разрез"
      filter={filter}
      facet={facet}
      valueTitle={v => v}
      valueIcon={() => null}
      onChange={() => {}}
      lang="ru"
      {...over}
    />,
  );
  const btn = screen.getByRole('button', { name: /^Разрез/ });
  fireEvent.click(btn);
  return document.getElementById(btn.getAttribute('aria-controls')!)!;
}

const boxes = (panel: HTMLElement) => within(panel).getAllByRole('checkbox').map(b => b.getAttribute('aria-label') ?? (b.closest('label')?.textContent ?? ''));
const caps = (panel: HTMLElement) => [...panel.querySelectorAll('.sk-facet__cap')].map(e => e.textContent);
const find = (panel: HTMLElement) => within(panel).getByRole('searchbox');

describe('S9-03 · панель фасета на объёме: первый экран — не простыня', () => {
  it('положительный контроль: значений в оси действительно сотни', () => {
    expect(facet.values).toHaveLength(N);
  });

  it('первый экран показывает размер блока, а не все 428 значений', () => {
    const panel = open();
    expect(boxes(panel)).toHaveLength(FACET_SCALE.block);
  });

  it('непоказанные названы числом, а не многоточием', () => {
    const panel = open();
    const more = panel.querySelector('.sk-facet__more')!;
    expect(more.textContent).toContain(String(N - FACET_SCALE.block));
    expect(more.textContent).not.toContain('…');
  });

  it('счёт по загруженным строкам — блок подписан «частые среди загруженного»', () => {
    expect(caps(open({ countsFrom: 'page' })).join(' ')).toMatch(/загруж/i);
  });

  it('счёт по всей выдаче — блок подписан просто «Частые»', () => {
    expect(caps(open({ countsFrom: 'all' })).join(' ')).toMatch(/^Частые$/);
  });

  it('счётчиков нет — блок не называется «частыми»', () => {
    const panel = open({ countsUnknown: '' });
    expect(caps(panel).join(' ')).not.toMatch(/Частые/);
  });
});

describe('S9-03 · выбранное видно всегда', () => {
  it('отмеченное значение — первым блоком, с подписью «Выбранные»', () => {
    const panel = open({ filter: { op: 'any', values: ['v-400'] } });
    expect(caps(panel)[0]).toBe('Выбранные');
    expect(boxes(panel)[0]).toContain('v-400');
  });

  it('отмеченное остаётся в панели при запросе, которому не подходит', () => {
    const panel = open({ filter: { op: 'any', values: ['v-400'] } });
    fireEvent.change(find(panel), { target: { value: 'v-01' } });
    expect(boxes(panel)[0]).toContain('v-400');
    expect(boxes(panel).slice(1).every(b => b.includes('v-01'))).toBe(true);
  });

  it('по запросу ничего — сказано про запрос, выбранное всё ещё снимаемо', () => {
    const panel = open({ filter: { op: 'any', values: ['v-400'] } });
    fireEvent.change(find(panel), { target: { value: 'ничего-такого' } });
    expect(panel.querySelector('.sk-facet__empty')!.textContent).toMatch(/запрос/i);
    expect(boxes(panel)).toHaveLength(1);
    expect(boxes(panel)[0]).toContain('v-400');
  });
});

describe('S9-03 · закреплённые приложением', () => {
  it('переданные приложением значения идут отдельным блоком под выбранными', () => {
    const panel = open({ filter: { op: 'any', values: ['v-400'] }, pinned: ['v-410', 'v-411'] });
    expect(caps(panel).slice(0, 3)).toEqual(['Выбранные', 'Закреплённые', 'Частые среди загруженного']);
    expect(boxes(panel).slice(1, 3).join(' ')).toContain('v-410');
  });
});
