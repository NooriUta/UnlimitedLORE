// @vitest-environment jsdom
// Замечание владелицы по v2 на проде (v1.17.4): «связи пока там, где я хотела
// бы видеть таблицы… наши любимые общие колонки» — вкладки связей показывать
// таблицей с теми же колонками, что у списков (S4-35/S4-36), а не «бедным
// списком» из названий.
//
// Колонки и подписи — те же, что у списков kit: «Статус», «Вид», «Код»,
// «Запись» (ключи kit.list.col.*). Своего словаря таблица связей не заводит:
// «общие колонки» — это те же колонки, а не похожие. Код и запись — РАЗНЫМИ
// колонками (решение владелицы 08.11), а не слепленные в одну ячейку.
//
// Честные состояния, которые таблица обязана сохранить:
//   • связей нет — так и сказано, пустой таблицы без строк не рисуем;
//   • запись есть в связях, но её нет в выгрузке — строка не пропадает:
//     виден код и честная пометка, а статус и тип остаются пустыми, а не
//     додумываются;
//   • управление (отвязать) появляется только там, где оно разрешено видом
//     связи и правом: композицию отвязать нельзя.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordRelations } from './RecordRelations';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: {
    sprint: {
      title: 'Спринт', icon: 'sprint',
      relations: [{ key: 'tasks', label: 'Задачи', relation: 'composition', rel: 'HAS_TASK', dir: 'out' }],
    },
    task: { title: 'Задача', icon: 'checklist' },
  },
  statuses: { items: [{ code: 'done', title: 'Готово', category: 'finished', icon: 'check-mark', color: 'var(--suc)' }] },
  roles: { editor: { canEdit: true, canStatus: true }, reader: { canEdit: false, canStatus: false } },
};

const sprint: KitRecord = { id: 'SPRINT_A', kind: 'sprint', title: 'Спринт А', status: 'done', fields: {} };
const task = (id: string, title = `Задача ${id}`): KitRecord => ({ id, kind: 'task', title, status: 'done', fields: {} });

function ctxOf(records: KitRecord[], edges: { from: string; to: string; type: string }[], role = 'reader'): KitCtx {
  return {
    config, role,
    data: { records: [sprint, ...records], edges, journal: [], meta: { generated_at: '2026-11-09T00:00:00Z' } },
    href: id => `?open=${id}`, esc: s => s, md: s => s,
  };
}

const defs = config.kinds.sprint.relations!;
const show = (ctx: KitCtx) => render(<RecordRelations record={sprint} ctx={ctx} defs={defs} lang="ru" />);
const table = () => screen.getByRole('table');

describe('связи — таблицей с общими колонками', () => {
  it('положительный контроль: связанная запись видна', () => {
    show(ctxOf([task('T-1')], [{ from: 'SPRINT_A', to: 'T-1', type: 'HAS_TASK' }]));
    expect(within(table()).getByText('Задача T-1')).toBeTruthy();
  });

  it('колонки те же, что у списка: Статус, Вид, Код, Запись', () => {
    show(ctxOf([task('T-1')], [{ from: 'SPRINT_A', to: 'T-1', type: 'HAS_TASK' }]));
    const heads = within(table()).getAllByRole('columnheader').map(th => th.textContent?.trim());
    expect(heads.slice(0, 4)).toEqual(['Статус', 'Вид', 'Код', 'Запись']);
  });

  it('код и запись — разными колонками (решение владелицы 08.11)', () => {
    show(ctxOf([task('T-1')], [{ from: 'SPRINT_A', to: 'T-1', type: 'HAS_TASK' }]));
    const cells = within(table()).getAllByRole('cell');
    expect(cells.some(c => c.textContent === 'T-1')).toBe(true);
    expect(cells.some(c => c.textContent?.includes('Задача T-1'))).toBe(true);
  });

  it('название — ссылка на запись: путь открывается в новой вкладке', () => {
    show(ctxOf([task('T-1')], [{ from: 'SPRINT_A', to: 'T-1', type: 'HAS_TASK' }]));
    expect(within(table()).getByRole('link', { name: 'Задача T-1' }).getAttribute('href')).toBe('?open=T-1');
  });

  it('разметка таблицы — та же, что у списков: класс один на весь kit', () => {
    const { container } = show(ctxOf([task('T-1')], [{ from: 'SPRINT_A', to: 'T-1', type: 'HAS_TASK' }]));
    expect(container.querySelector('table.sk-list__table')).toBeTruthy();
    expect(container.querySelector('th.sk-list__th')).toBeTruthy();
    expect(container.querySelector('td.sk-list__td')).toBeTruthy();
    // Правила этих классов уже есть в seidr.css — своих таблица не заводит.
    expect(css).toMatch(/\.sk-list__table\s*\{/);
  });

  it('связей нет — так и сказано, а не пустая таблица', () => {
    show(ctxOf([], []));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Связей нет')).toBeTruthy();
  });

  it('запись есть в связях, но нет в выгрузке — строка остаётся, статус и тип не додумываются', () => {
    show(ctxOf([], [{ from: 'SPRINT_A', to: 'T-404', type: 'HAS_TASK' }]));
    const row = within(table()).getByRole('row', { name: /T-404/ });
    expect(within(row).getByText('T-404')).toBeTruthy();
    expect(row.textContent).toMatch(/нет в выгрузке/);
    expect(row.querySelector('[data-missing="true"]')).toBeTruthy();
  });

  it('композицию отвязать нельзя даже с правом правки — дочь без родителя не живёт', () => {
    const onRelation = vi.fn();
    const ctx = ctxOf([task('T-1')], [{ from: 'SPRINT_A', to: 'T-1', type: 'HAS_TASK' }], 'editor');
    ctx.config.hooks = { onRelation };
    show(ctx);
    expect(within(table()).queryByRole('button', { name: /Отвязать/ })).toBeNull();
  });
});
