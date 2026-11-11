// @vitest-environment jsdom
// Ряд чипов в «Свойствах»: подпись словами, пометка наследования, «ещё N»
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29, половина kit).
//
// Смена контракта уже в develop (серверный PR #1128): `values.projects` и
// `values.components` — список объектов `{id, label, inherited_from}`, а не
// строк. Срез релиза v1.17.12 стоит до этой правки по слову владелицы: «не
// запускай 12, пока не перейдёт».
//
// Главный тест файла — НЕ вид, а сторож: объект не должен доезжать до экрана
// строкой. Он защищает от уже случившегося, а не от будущего.
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';
import { VALUE_CHIPS_INLINE } from '../core/chipValue';

const chip = (id: string, label?: string | null, from?: { type: string; id: string } | null) =>
  ({ id, label: label ?? null, inherited_from: from ?? null });

const config = {
  modules: [], menu: { groups: [] },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  kinds: {
    item: {
      title: 'Предмет',
      icon: 'scroll-quill',
      fields: [
        { key: 'projects', title: 'Проекты', type: 'ref' },
        { key: 'components', title: 'Компоненты', type: 'ref' },
      ],
    },
  },
} as unknown as KitConfig;

function draw(fields: Record<string, unknown>) {
  const record: KitRecord = { id: 'R-1', kind: 'item', title: 'Запись', status: 'todo', fields };
  const data: KitData = { records: [record], edges: [], journal: [], meta: { generated_at: '2026-11-10T12:00:00Z' } };
  const ctx = {
    config, data, href: (id: string) => `/r/${id}`, role: 'reader', lang: 'ru',
    md: (s: string) => s,
  } as unknown as KitCtx;
  return render(<RecordView record={record} ctx={ctx} tab="overview" onTab={() => {}} />);
}

const chips = (c: HTMLElement) => [...c.querySelectorAll('[data-chip]')];
const more = (c: HTMLElement) => c.querySelector('[data-chips-more]') as HTMLElement | null;

describe('S4-29 · сторож: объект не доезжает до экрана строкой', () => {
  it('положительный контроль: строковые значения рисуются как раньше', () => {
    const { container } = draw({ projects: ['A', 'B'] });
    expect(container.textContent).toMatch(/A/);
    expect(container.textContent).not.toMatch(/[{}]/);
  });

  it('ни JSON, ни [object Object] на экране нет', () => {
    const { container } = draw({ projects: [chip('NooriUta/UnlimitedLORE', 'UnlimitedLORE')] });
    const text = container.textContent ?? '';
    expect(text, 'объект напечатан как данные').not.toMatch(/\[object Object\]/);
    expect(text, 'JSON вместо подписи').not.toMatch(/"id"|inherited_from|[{}]/);
  });

  it('видна ПОДПИСЬ, а не код, когда подпись есть', () => {
    const { container } = draw({ projects: [chip('NooriUta/UnlimitedLORE', 'UnlimitedLORE')] });
    expect(container.textContent).toMatch(/UnlimitedLORE/);
  });

  it('подписи нет — виден КОД, а не пустота', () => {
    const { container } = draw({ projects: [chip('LORE', null)] });
    expect(container.textContent).toMatch(/LORE/);
  });

  it('ссылка чипа ведёт по КОДУ, а не по подписи', () => {
    const { container } = draw({ projects: [chip('NooriUta/UnlimitedLORE', 'UnlimitedLORE')] });
    const a = chips(container)[0].querySelector('a');
    expect(a?.getAttribute('href')).toBe('/r/NooriUta/UnlimitedLORE');
  });
});

describe('S4-29 · «своё» и «унаследованное» — разные утверждения', () => {
  it('у унаследованного чипа есть пометка источника, у своего — нет', () => {
    const { container } = draw({
      projects: [chip('OWN', 'Своё'), chip('INH', 'Чужое', { type: 'sprint', id: 'SPRINT_X' })],
    });
    const [own, inh] = chips(container);
    expect(own.getAttribute('data-inherited')).toBeNull();
    expect(inh.getAttribute('data-inherited')).toBe('sprint');
  });

  it('пометка названа СЛОВАМИ, а не только видом', () => {
    const { container } = draw({ projects: [chip('INH', 'Чужое', { type: 'sprint', id: 'SPRINT_X' })] });
    const el = chips(container)[0];
    const said = (el.textContent ?? '') + (el.getAttribute('title') ?? '');
    expect(said, 'по одному оттенку «от спринта» не прочитать').toMatch(/спринт/i);
  });

  it('источник назван кодом: «от спринта» без имени спринта бесполезно', () => {
    const { container } = draw({ projects: [chip('INH', 'Чужое', { type: 'sprint', id: 'SPRINT_X' })] });
    expect((chips(container)[0].getAttribute('title') ?? '')).toMatch(/SPRINT_X/);
  });

  it('тип источника незнаком — сказано хоть что-то, а не молчание', () => {
    const { container } = draw({ projects: [chip('INH', 'Чужое', { type: 'wat', id: 'W-1' })] });
    const el = chips(container)[0];
    expect(el.getAttribute('data-inherited')).toBe('wat');
    expect((el.getAttribute('title') ?? '').trim()).not.toBe('');
  });

  it('свои чипы идут ПЕРЕД унаследованными — порядок источника не переставляется', () => {
    const { container } = draw({
      projects: [chip('OWN', 'Своё'), chip('INH', 'Чужое', { type: 'sprint', id: 'S' })],
    });
    expect(chips(container).map(e => e.getAttribute('data-chip'))).toEqual(['OWN', 'INH']);
  });
});

describe('S4-29 · первые три и «ещё N»', () => {
  const many = Array.from({ length: 7 }, (_, i) => chip(`P${i}`, `Проект ${i}`));

  it('в ряду стоят первые три', () => {
    const { container } = draw({ projects: many });
    expect(chips(container)).toHaveLength(VALUE_CHIPS_INLINE);
  });

  it('«ещё N» называет ЧИСЛО: без числа свёрнутое читается как мелочь', () => {
    const { container } = draw({ projects: many });
    expect(more(container)?.textContent).toMatch(/4/);
  });

  it('«ещё N» раскрывает НА МЕСТЕ, а не уводит в другое окно', () => {
    const { container } = draw({ projects: many });
    fireEvent.click(more(container)!);
    expect(chips(container)).toHaveLength(7);
  });

  it('раскрытое сворачивается обратно', () => {
    const { container } = draw({ projects: many });
    fireEvent.click(more(container)!);
    fireEvent.click(more(container)!);
    expect(chips(container)).toHaveLength(VALUE_CHIPS_INLINE);
  });

  it('чипов ровно три — «ещё» не рисуем: оно обещало бы спрятанное', () => {
    const { container } = draw({ projects: many.slice(0, 3) });
    expect(more(container)).toBeNull();
  });

  it('два поля чипов не делят свёртку: у каждого своя', () => {
    const { container } = draw({ projects: many, components: many.slice(0, 5) });
    const rows = [...container.querySelectorAll('[data-chips-row]')];
    expect(rows).toHaveLength(2);
    // Раскрыли первое — второе осталось свёрнутым.
    fireEvent.click(rows[0].querySelector('[data-chips-more]') as HTMLElement);
    expect(rows[0].querySelectorAll('[data-chip]')).toHaveLength(7);
    expect(rows[1].querySelectorAll('[data-chip]')).toHaveLength(VALUE_CHIPS_INLINE);
  });
});
