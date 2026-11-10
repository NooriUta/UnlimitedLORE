// @vitest-environment jsdom
// Закреплённые значения фасета ДОХОДЯТ до человека из списка
// (SPRINT_UXR_S9_SCALE_OPT/S9-03 + K2-FEED-VIEW, правка 10.11.2026).
//
// Повод — ровно тот случай, под который в kit стоит отдельный сторож
// (`wired.test.ts`): проп `pinned` у `FacetFilter` написан и покрыт тестами, но
// `ListView` его не передавал. То есть возможность работала только при прямом
// использовании `FacetFilter`, а в списке — главном её месте — её не было.
// Снаружи это выглядит хуже, чем «не сделано»: по задаче закрыто, в интерфейсе
// возможности нет.
//
// Набор закреплённых значений у каждой оси СВОЙ, и знает его приложение
// (водораздел K-14), поэтому у списка это функция `facetPinned(key)`, а не
// список: имён своих осей kit не держит.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { ListView } from './ListView';

const rec = (id: string, status: string, area: string): KitRecord =>
  ({ id, kind: 'item', title: `Запись ${id}`, status, fields: { area } });

const cfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { item: { title: 'Предмет', icon: 'scroll-quill', fields: [{ key: 'area', title: 'Область', type: 'enum' }] } },
  statuses: { items: [
    { code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' },
    { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ] },
  list: { views: ['list'], columns: ['title+id', 'status'], filters: ['fields.area'], showClosed: 'all' },
};

// Блоки в фасете появляются только когда ось перестаёт быть обозримой
// (FACET_SCALE.findFrom): до порога панель рисует плоский список, и делить там
// нечего. Поэтому у оси здесь двенадцать значений — иначе тест проверял бы
// порог, а не проводку.
const areas = Array.from({ length: 12 }, (_, i) => `область-${i}`);
const data: KitData = {
  records: areas.map((a, i) => rec(`r${i}`, i === 0 ? 'done' : 'todo', a)),
  edges: [], journal: [], meta: { generated_at: '2026-11-10T12:00:00Z', total: 12 },
};

const openFacet = () => fireEvent.click(screen.getByRole('button', { name: /Область/ }));
const sections = (c: HTMLElement) => [...c.querySelectorAll('.sk-facet__sec')].map(s => s.getAttribute('data-sec'));

describe('S9-03 · закреплённые значения фасета доходят из списка', () => {
  it('положительный контроль: без facetPinned блока закреплённых нет — поведение прежнее', () => {
    const { container } = render(<ListView config={cfg} data={data} urlState={false} />);
    openFacet();
    expect(sections(container)).not.toContain('pinned');
    expect(screen.queryByText('Закреплённые')).toBeNull();
  });

  it('приложение назвало закреплённые — они встают своим блоком', () => {
    const { container } = render(
      <ListView config={cfg} data={data} urlState={false} facetPinned={k => (k === 'fields.area' ? ['область-11'] : [])} />,
    );
    openFacet();
    expect(sections(container)).toContain('pinned');
    const pinned = container.querySelector('.sk-facet__sec[data-sec="pinned"]') as HTMLElement;
    expect([...pinned.querySelectorAll('.sk-facet__vt')].map(e => e.textContent)).toEqual(['область-11']);
    expect(screen.getByText('Закреплённые')).toBeTruthy();
  });

  it('набор свой у каждой оси: не названной оси закреплённые не достаются', () => {
    const { container } = render(
      <ListView config={cfg} data={data} urlState={false} facetPinned={k => (k === 'status' ? ['done'] : [])} />,
    );
    openFacet();
    expect(sections(container)).not.toContain('pinned');
  });
});
