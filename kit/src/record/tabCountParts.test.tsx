// @vitest-environment jsdom
// Счётчик — ПО ОДНОМУ ПРАВИЛУ, включая вкладки-части (ревью 10.11.2026, B13:
// «счётчики то есть, то нет»).
//
// Дубли вкладок и счётчик у вкладок связей закрыты. Последняя дырка — вкладки,
// которые даёт приложение (у спринта это «Задачи» и «Фазы»): у них числа не
// было вовсе, хотя часть его присылает. Вкладка без числа рядом с вкладками с
// числом читается как «тут считать нечего», а это неправда.
//
// Правило, которое закрепляет этот файл, то же, что у остальных счётчиков:
//   число — сколько элементов;
//   «?» с подсказкой — не смогли посчитать (часть не прочиталась);
//   нет счётчика вовсе — только там, где считать НЕЧЕГО (Контент, Свойства).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

const record: KitRecord = { id: 'SPRINT_A', kind: 'sprint', title: 'Спринт А', status: 'todo', fields: {} };
const data: KitData = { records: [record], edges: [], journal: [], meta: { generated_at: '2026-11-10T09:00:00Z', total: 1 } };

const configOf = (tabs: { key: string; title: string; count?: number | null }[]): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринты', icon: 'cog', tabs: tabs.map(t => ({ ...t, render: () => 'тело' })) } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
});

const show = (tabs: { key: string; title: string; count?: number | null }[], tab = 'overview') => {
  const config = configOf(tabs);
  const ctx = { config, data, href: () => undefined } as unknown as KitCtx;
  return render(<RecordView record={record} ctx={ctx} tab={tab} onTab={() => {}} />);
};

/** Счётчик внутри вкладки с этой подписью. */
const countOf = (label: string): HTMLElement | null => {
  const tab = screen.getAllByRole('tab').find(t => (t.textContent ?? '').includes(label));
  expect(tab, `вкладки «${label}» в ряду нет`).toBeTruthy();
  return tab!.querySelector('.sk-tab__count');
};

describe('B13 · счётчик у вкладок, которые даёт приложение', () => {
  it('положительный контроль: вкладка приложения нарисована в ряду', () => {
    show([{ key: 'tasks', title: 'Задачи', count: 48 }]);
    expect(screen.getAllByRole('tab').some(t => (t.textContent ?? '').includes('Задачи'))).toBe(true);
  });

  it('часть посчитана — число стоит в самой вкладке', () => {
    show([{ key: 'tasks', title: 'Задачи', count: 48 }]);
    expect(countOf('Задачи')?.textContent).toBe('48');
  });

  it('часть не прочиталась — «?» с подсказкой, а не ложный ноль и не пустота', () => {
    show([{ key: 'tasks', title: 'Задачи', count: null }]);
    const c = countOf('Задачи');
    expect(c?.textContent).toBe('?');
    expect(c?.getAttribute('data-unknown')).toBe('');
    expect(c?.getAttribute('title') ?? '').toMatch(/посчит/i);
  });

  it('ноль остаётся нулём: пусто — это не «неизвестно»', () => {
    show([{ key: 'phases', title: 'Фазы', count: 0 }]);
    expect(countOf('Фазы')?.textContent).toBe('0');
  });

  it('считать нечего — счётчика нет вовсе (вкладка без count)', () => {
    show([{ key: 'props', title: 'Свойства' }]);
    expect(countOf('Свойства')).toBeNull();
  });
});
