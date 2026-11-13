// @vitest-environment jsdom
// PU-12, обобщено на ControlBar (полоса таблиц паспорта): приёмка 13.11 — в паспорте спринта
// «Исполнитель / Фаза» уходили второй строкой. Тот же хук useFacetFold, что у ListView.
// jsdom раскладку не считает — перенос эмулируем через offsetTop (см. facetRowFit.test.tsx).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import type { KitConfig, KitRecord } from '../core/contract';
import { ControlBar, EMPTY_CONTROLS } from './ControlBar';

const KEYS = ['status', 'fields.a', 'fields.b', 'fields.c', 'fields.d'];
const config = {
  modules: [], menu: { groups: [] },
  kinds: { t: { title: 'Т', icon: 'quill', fields: ['a', 'b', 'c', 'd'].map(k => ({ key: k, title: k.toUpperCase(), type: 'text' })) } },
  statuses: { items: [{ code: 'open', title: 'Идёт', category: 'in_progress', icon: 'play-button', color: 'var(--acc)' }] },
} as unknown as KitConfig;
const recs: KitRecord[] = [{ id: 'x', kind: 't', title: 'x', status: 'open', fields: { a: '1', b: '2', c: '3', d: '4' } }];

let FIT = 3;
const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
beforeEach(() => {
  FIT = 3;
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const seg = this.closest('.sk-list__seg[data-seg="filter"]');
      if (!seg || this.parentElement !== seg) return 0;
      const xs = Array.from(seg.children).filter(c => c.classList.contains('sk-facet') || c.classList.contains('sk-list__facetmore'));
      return xs.indexOf(this) >= FIT ? 30 : 0;
    },
  });
});
afterEach(() => { if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetTop', desc); });

const facets = (c: HTMLElement) => c.querySelectorAll('.sk-list__seg[data-seg="filter"] > .sk-facet').length;

describe('ControlBar · ряд фасетов в одну строку с «+N»', () => {
  it('влезает 3 места из 5 фасетов → 2 фасета и «+3»', () => {
    const { container } = render(<ControlBar config={config} records={recs} state={EMPTY_CONTROLS} onChange={() => {}} filterKeys={KEYS} />);
    expect(facets(container)).toBe(2);
    expect(container.querySelector('.sk-list__facetmore')?.textContent).toContain('3');
  });
  it('«+N» раскрывает все', () => {
    const { container } = render(<ControlBar config={config} records={recs} state={EMPTY_CONTROLS} onChange={() => {}} filterKeys={KEYS} />);
    act(() => { fireEvent.click(container.querySelector('.sk-list__facetmore')!); });
    expect(facets(container)).toBe(5);
  });
  it('телефон — свёртки нет', () => {
    const { container } = render(<ControlBar config={config} records={recs} state={EMPTY_CONTROLS} onChange={() => {}} filterKeys={KEYS} narrow />);
    expect(facets(container)).toBe(5);
  });
});
