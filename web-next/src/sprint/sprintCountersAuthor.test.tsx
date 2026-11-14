// @vitest-environment jsdom
// SPRINT_UXR_POLISH_UAT_1113/PU-16 — решение владелицы D13 (14.11.2026) «возвращаем всё»:
// в паспорте спринта v2, как в v1,
//   1) полоска счётчиков задач по статусам и по типам и «готово x/y Σ оценка» —
//      над задачами в ЛЮБОМ виде (дерево по умолчанию, таблица, список);
//   2) колонка «Автор» в таблице задач — в видах «Дерево» и «Список» тоже
//      (в «Таблице» kit TaskTable она уже есть).
// Данные — тот же ответ /lore/record (часть tasks: values.author, values.task_type),
// второго чтения нет: иначе шапка и строки могли бы разойтись.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { UrlWindow } from '@seidr/kit';
import type { LorePart, LoreRecord1 } from '../record/loreRecordContract';
import { SPRINT_TREE_COLUMNS, sprintTreeOf } from '../record/sprintTree';
import { SprintTasksPanel } from './SprintTasksPanel';

const task = (code: string, status: string, taskType: string | null, author: string | null, effort: number | null) => ({
  id: `SPRINT_X/${code}`, title: `Задача ${code}`, status,
  values: { status, code, title: `Задача ${code}`, executor: 'claude', author, task_type: taskType, effort, phase_uid: null },
});
const part = (items: LorePart['items']): LorePart =>
  ({ key: 'tasks', label: 'tasks', type: 'task', rel: 'PART_OF', dir: 'in', state: 'ok', count: items.length, items });
const contract = (): LoreRecord1 => ({
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SPRINT_X', title: 'Спринт X', status: 'active', version: null, updated_at: null, updated_by: null },
  schema: { type: 'sprint', label: 'Спринт', icon: 'sprint', fields: [], tabs: [], relations: [] },
  values: { title: 'Спринт X' },
  links: [],
  parts: [part([
    task('A-1', 'done', 'feature', 'owner', 2),
    task('A-2', 'planned', 'feature', 'owner', 1.5),
    task('A-3', 'planned', 'bug', null, null),
  ])],
  facts: { tasks: { done: 1, total: 3 } },
  perms: { can_edit: true, can_status: true, can_create: false, status_next: [], reason: null },
  meta: { loaded_at: '2026-11-14T00:00:00.000Z', facade: 'server', sources: [] },
});
const fakeWin = (search = ''): UrlWindow => {
  const win: UrlWindow = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_: unknown, __: string, url?: string | URL | null) => { win.location.search = new URL(String(url), 'http://x').search; },
      replaceState: (_: unknown, __: string, url?: string | URL | null) => { win.location.search = new URL(String(url), 'http://x').search; },
    },
  };
  return win;
};
const deadFetch = (async () => new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
const headers = () => Array.from(document.querySelectorAll('th')).map(th => th.textContent ?? '');

describe('PU-16 · строки дерева несут автора и тип', () => {
  it('у задачи — автор и тип из части tasks', () => {
    const r = sprintTreeOf(contract()).rows.find(x => x.key === 'SPRINT_X/A-1');
    expect(r?.author).toBe('owner');
    expect(r?.taskType).toBe('feature');
  });
  it('колонка «Автор» в столбцах дерева — перед исполнителем, как в v1', () => {
    expect(SPRINT_TREE_COLUMNS).toContain('fields.author');
    expect(SPRINT_TREE_COLUMNS.indexOf('fields.author')).toBeLessThan(SPRINT_TREE_COLUMNS.indexOf('fields.executor'));
  });
});

describe('PU-16 · полоска счётчиков и колонка «Автор» во всех видах', () => {
  for (const [view, search] of [['дерево', ''], ['список', '?tview=list']] as const) {
    it(`${view}: счётчики по статусам, по типам, «готово x/y» и Σ оценок`, () => {
      render(<SprintTasksPanel contract={contract()} win={fakeWin(search)} fetchImpl={deadFetch} onStatusSaved={() => {}} />);
      expect(screen.getByTestId('tc-statuses')).toBeTruthy();
      const types = screen.getByTestId('tc-types');
      expect(within(types).getByTitle(/: 2$/).textContent).toContain('2');
      expect(screen.getByTestId('tc-progress').textContent).toBe('1/3');
      expect(screen.getByTestId('tc-effort').textContent).toMatch(/3[.,]5/);
    });
    it(`${view}: в шапке таблицы есть «Автор»`, () => {
      render(<SprintTasksPanel contract={contract()} win={fakeWin(search)} fetchImpl={deadFetch} onStatusSaved={() => {}} />);
      expect(headers().some(h => h.includes('Автор'))).toBe(true);
    });
  }
});

// PU-16 (приёмка препрода 14.11.2026): «автор/ревьюер как в v1» — «Автор» есть, колонки приёмщика нет,
// хотя сервер отдаёт reviewer в строках задач паспорта спринта.
describe('PU-16 · колонка «Принимающий» после исполнителя во всех видах', () => {
  it('в столбцах дерева — после исполнителя', () => {
    expect(SPRINT_TREE_COLUMNS).toContain('fields.reviewer');
    expect(SPRINT_TREE_COLUMNS.indexOf('fields.reviewer')).toBeGreaterThan(SPRINT_TREE_COLUMNS.indexOf('fields.executor'));
  });
  for (const [view, search] of [['дерево', ''], ['список', '?tview=list']] as const) {
    it(`${view}: в шапке есть «Принимающий»`, () => {
      render(<SprintTasksPanel contract={contract()} win={fakeWin(search)} fetchImpl={deadFetch} onStatusSaved={() => {}} />);
      expect(headers().some(h => h.includes('Принимающий'))).toBe(true);
    });
  }
});
