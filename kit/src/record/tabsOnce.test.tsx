// @vitest-environment jsdom
// Один раздел — одна вкладка (ревью 10.11.2026, B13 + просьба владелицы того же
// дня: «проверить, почему, например, в паспорте у спринтов дублирующиеся
// вкладки»).
//
// ПРИЧИНА. Ряд вкладок записи склеивается из двух списков: вкладки вида
// (`config.kinds[k].tabs`, их задаёт приложение) и вкладки связей (`relations`,
// их строит kit по видам UML). Ключ у них ОДИН И ТОТ ЖЕ — и приложение честно
// задаёт оба: вкладку с настоящей таблицей дочерних записей и связь-композицию,
// по которой kit считает число и рисует значок ◆. Склейка шла конкатенацией без
// сверки ключей, поэтому в ряду появлялись ДВЕ вкладки с одинаковым id и
// подписью: одна со счётчиком, другая без.
//
// Хуже того, панель выбиралась в обратном порядке (связь раньше вкладки вида),
// то есть богатая таблица приложения не рисовалась ВОВСЕ: её молча подменял
// общий список связей kit.
//
// ПРАВИЛО: у ряда вкладок ключи уникальны. Совпал ключ — вкладки СЛИВАЮТСЯ:
// содержимое даёт приложение (вкладку вида оно объявило намеренно), а счётчик и
// значок вида связи остаются от связи. Ни то, ни другое с экрана не исчезает.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

const r = (id: string, kind: string, title: string): KitRecord => ({ id, kind, title, status: 'planned', fields: {} });
const host = r('H-1', 'host', 'Запись с дочками');
const records = [host, r('K-1', 'kid', 'Дочка 1'), r('K-2', 'kid', 'Дочка 2')];
const edges = [
  { from: 'H-1', to: 'K-1', type: 'HAS_PART' },
  { from: 'H-1', to: 'K-2', type: 'HAS_PART' },
];

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    host: {
      title: 'Запись', icon: 'scroll-quill',
      fields: [{ key: 'version', title: 'Версия', type: 'text' }],
      // Вкладка вида: настоящая таблица приложения — ровно то, чем в LORE
      // подменяется вкладка дочерних записей (withSprintTasksTab).
      tabs: [{ key: 'kids', title: 'Дочки', render: () => 'таблица приложения' }],
      relations: [{ key: 'kids', label: 'Дочки', relation: 'composition', rel: 'HAS_PART', dir: 'out' }],
    },
  },
  statuses: { items: [{ code: 'planned', title: 'запланировано', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
};
const ctx: KitCtx = {
  config, role: 'reader', href: id => `#${id}`, esc: s => s, md: s => s,
  data: { records, edges, journal: [], meta: { generated_at: '2026-11-10T00:00:00Z' } },
};
const view = (tab: string) => render(<RecordView record={host} ctx={ctx} tab={tab} onTab={() => {}} placement="bottom" />);
const tabs = () => screen.getAllByRole('tab');
const names = () => tabs().map(t => (t.textContent ?? '').replace(/[◆◇⇢▷△]/g, '').replace(/\d+$/, ''));

describe('B13 · один раздел — одна вкладка', () => {
  it('положительный контроль: ряд вкладок нарисован, раздел дочек в нём есть', () => {
    view('overview');
    expect(names()).toContain('Дочки');
  });

  it('вкладка вида и связь с тем же ключом дают ОДНУ вкладку, а не две', () => {
    view('overview');
    expect(names().filter(n => n === 'Дочки')).toHaveLength(1);
  });

  it('ключи вкладок ряда уникальны — это правило ряда, а не случай дочек', () => {
    view('overview');
    const ids = tabs().map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('при слиянии счётчик и значок вида связи остаются: число с экрана не исчезает', () => {
    view('overview');
    const kids = tabs().find(t => (t.textContent ?? '').includes('Дочки'))!;
    expect(kids.querySelector('.sk-tab__count')?.textContent).toBe('2');
    expect(kids.querySelector('[data-relation-mark]')?.textContent).toBe('◆');
    expect(kids.getAttribute('data-relation')).toBe('composition');
  });

  it('содержимое даёт приложение: его таблица, а не общий список связей kit', () => {
    view('kids');
    expect(screen.getByText('таблица приложения')).toBeTruthy();
    expect(screen.queryByTestId('kit-relation-list')).toBeNull();
  });
});
