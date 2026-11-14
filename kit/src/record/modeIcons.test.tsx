// @vitest-environment jsdom
// S4-29 (владелица 14.11.2026): «Отдельный раздел Контент Свойства Аналитика замени на их значки и
// поставь в ряд со статусом для переключения — причём эти значки там и должны быть без левого
// меню в полноэкранном виде». Переключатель видов паспорта — три значка в строке статуса, один и
// в одном месте во всех местах показа; отдельного ряда пилюль и отдельной рейки во весь экран нет.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import type { PassportOrder } from '../model/surfaces';
import { NARROW_QUERY } from '../core/narrow';
import { RecordView } from './RecordView';

const r = (id: string, kind: string, title: string): KitRecord => ({ id, kind, title, status: 'planned', fields: { goal: 'цель' } });
const sprint = r('SPRINT_X', 'sprint', 'Спринт');
const records = [sprint, r('T-1', 'task', 'Задача 1'), r('T-2', 'task', 'Задача 2')];
const edges = [
  { from: 'SPRINT_X', to: 'T-1', type: 'HAS_TASK' },
  { from: 'SPRINT_X', to: 'T-2', type: 'HAS_TASK' },
];
const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    sprint: {
      title: 'Спринт', icon: 'scroll-quill',
      fields: [{ key: 'goal', title: 'Цель', type: 'text' }],
      tabs: [{ key: 'tasks', title: 'Задачи', render: () => 'таблица задач' }],
      relations: [{ key: 'tasks', label: 'Задачи', relation: 'composition', rel: 'HAS_TASK', dir: 'out' }],
    },
  },
  statuses: { items: [{ code: 'planned', title: 'запланировано', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
};
const ctx: KitCtx = {
  config, role: 'reader', href: id => `#${id}`, esc: s => s, md: s => s,
  data: { records, edges, journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } },
};
// Порядок модели для спринта — как у сервера (LorePassportSurface: tasks, content, …).
const order: PassportOrder = {
  decided: true, notes: [],
  sections: [
    { key: 'tasks', source: 'part', ref: 'tasks', order: 0, slot: 'own', group: null },
    { key: 'overview', source: 'body', ref: null, order: 1, slot: 'own', group: null },
  ],
};

let narrow = false;
const w = window as unknown as { matchMedia?: unknown };
const orig = w.matchMedia;
beforeEach(() => {
  w.matchMedia = (q: string) => ({ matches: q === NARROW_QUERY ? narrow : false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { cleanup(); w.matchMedia = orig; narrow = false; });


const seen: string[] = [];
const view = (placement: 'left' | 'right' | 'bottom' | 'full', tab = 'overview') =>
  render(<RecordView record={sprint} ctx={ctx} tab={tab} onTab={t => seen.push(t)} placement={placement} sections={order} loadedAt="2026-11-14T00:00:00Z" />);
const sw = () => screen.getByRole('group', { name: 'Вид паспорта' });

describe('S4-29 · вид паспорта — значками в строке статуса', () => {
  for (const place of ['left', 'right', 'bottom', 'full'] as const) {
    it(`${place}: переключатель один, в строке статуса, значками с именами`, () => {
      view(place);
      expect(screen.getAllByRole('group', { name: 'Вид паспорта' })).toHaveLength(1);
      expect(sw().closest('.sk-rec-head__status, .sk-rec-facts')).not.toBeNull();
      const btns = within(sw()).getAllByRole('button');
      expect(btns.map(b => b.getAttribute('aria-label'))).toEqual(['Контент', 'Свойства', 'Аналитика']);
      for (const b of btns) expect(b.classList.contains('sk-iconbtn')).toBe(true);
    });
  }

  it('во весь экран отдельной рейки «Разделы паспорта» нет', () => {
    view('full');
    expect(screen.queryByRole('navigation', { name: 'Разделы паспорта' })).toBeNull();
  });

  it('выбранный вид подсвечен; «Аналитика» ведёт в служебные разделы', () => {
    view('full');
    expect(within(sw()).getByRole('button', { name: 'Контент' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(sw()).getByRole('button', { name: 'Аналитика' }));
    expect(seen[seen.length - 1]).toBe('links');
  });

  it('телефон: значков нет — один ряд вкладок, как в v1 (S4-MOBILE-COMPARE)', () => {
    narrow = true;
    view('right');
    expect(screen.queryByRole('group', { name: 'Вид паспорта' })).toBeNull();
  });
});
