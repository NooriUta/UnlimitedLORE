// @vitest-environment jsdom
// Таблица внутри паспорта — со СТАНДАРТНЫМ управлением списка: поиск, фильтр
// (фасеты), группировка, порядок. Слова владелицы 11.11.2026: «в паспорте, где
// табличный вид свёрнут под "ещё", должны идти стандартные сортировки,
// фильтры, группировки … и поиск тоже».
//
// Таблица связей рисовала свои строки без управления: на 40 связях найти одну
// можно было только глазами. Теперь это тот же ListView, что у разделов, —
// своё управление таблица не рисует.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordRelations } from './RecordRelations';

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    sprint: {
      title: 'Спринт', icon: 'sprint',
      relations: [{ key: 'tasks', label: 'Задачи', relation: 'aggregation', rel: 'HAS', dir: 'out' }],
    },
    task: { title: 'Задача', icon: 'checklist' },
    adr: { title: 'ADR', icon: 'scroll-unfurled' },
  },
  statuses: {
    items: [
      { code: 'done', title: 'Готово', category: 'finished', icon: 'check-mark', color: 'var(--suc)' },
      { code: 'open', title: 'Открыта', category: 'todo', icon: 'circle', color: 'var(--inf)' },
    ],
  },
  roles: { reader: { canEdit: false, canStatus: false } },
};

const sprint: KitRecord = { id: 'S', kind: 'sprint', title: 'Спринт', status: 'done', fields: {} };
const rec = (id: string, title: string, status: string, kind = 'task'): KitRecord => ({ id, kind, title, status, fields: {} });
const kids = [rec('T-1', 'Альфа', 'done'), rec('T-2', 'Бета', 'open'), rec('A-1', 'Гамма', 'open', 'adr')];

function show(missing: string[] = []) {
  const ctx: KitCtx = {
    config, role: 'reader',
    data: {
      records: [sprint, ...kids],
      edges: [...kids.map(k => k.id), ...missing].map(to => ({ from: 'S', to, type: 'HAS' })),
      journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' },
    },
    href: id => `?open=${id}`, esc: s => s, md: s => s,
  };
  return render(<RecordRelations record={sprint} ctx={ctx} defs={config.kinds.sprint.relations!} lang="ru" />);
}
const ids = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map(r => r.getAttribute('data-record-id'));

describe('таблица в паспорте — стандартное управление списка', () => {
  it('положительный контроль: все связи строками', () => {
    show();
    expect(ids()).toEqual(['T-1', 'T-2', 'A-1']);
  });

  it('поиск по тексту сужает строки', () => {
    show();
    fireEvent.change(screen.getByRole('searchbox', { name: /Поиск|Текст/i }), { target: { value: 'Бета' } });
    expect(ids()).toEqual(['T-2']);
  });

  it('есть сегменты фильтра, группировки и порядка — те же, что у разделов', () => {
    const { container } = show();
    expect(container.querySelector('[data-seg="filter"]')).toBeTruthy();
    expect(container.querySelector('[data-seg="group"]')).toBeTruthy();
    expect(container.querySelector('[data-seg="sort"]')).toBeTruthy();
  });

  it('состояние — не в адресе: вкладка паспорта не переписывает фильтры раздела', () => {
    const before = window.location.search;
    show();
    fireEvent.change(screen.getByRole('searchbox', { name: /Поиск|Текст/i }), { target: { value: 'Бета' } });
    expect(window.location.search).toBe(before);
  });

  it('запись вне выгрузки остаётся строкой той же таблицы — с пометкой', () => {
    show(['T-404']);
    expect(ids()).toEqual(['T-1', 'T-2', 'A-1', 'T-404']);
    const row = within(screen.getByRole('table')).getByRole('row', { name: /T-404/ });
    expect(row.getAttribute('data-missing')).toBe('true');
    expect(row.textContent).toMatch(/нет в выгрузке/);
  });

  it('запись вне выгрузки не прячется поиском по её коду и прячется чужим запросом', () => {
    show(['T-404']);
    const box = screen.getByRole('searchbox', { name: /Поиск|Текст/i });
    fireEvent.change(box, { target: { value: '404' } });
    expect(ids()).toEqual(['T-404']);
    fireEvent.change(box, { target: { value: 'Альфа' } });
    expect(ids()).toEqual(['T-1']);
  });
});
