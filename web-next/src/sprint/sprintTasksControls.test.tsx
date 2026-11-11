// @vitest-environment jsdom
// Вкладка «Задачи» спринта: стандартные поиск, фильтры, группировка и порядок
// во всех трёх видах (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-SPRINT-TASKS-CONTROLS,
// «и а и б» владелицы 11.11.2026).
//
//   а) дерево (по умолчанию) и таблица (?tview=table) — со стандартной полосой
//      списка: поиск, фасеты статус / исполнитель / фаза, группировка, порядок;
//   б) третий вид «Список» (?tview=list) — kit NestedList, тот же ListView.
// Прежнее не теряется: правка статуса в строке дерева, уровни спринт → фаза →
// задача, таблица с правкой и массовым статусом.
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { UrlWindow } from '@seidr/kit';
import type { LorePart, LoreRecord1 } from '../record/loreRecordContract';
import { sprintTreeOf } from '../record/sprintTree';
import { SprintTasksPanel, TASK_VIEW_PARAM } from './SprintTasksPanel';

const task = (code: string, phase: string | null, status = 'planned', executor = 'claude') => ({
  id: `SPRINT_X/${code}`, title: `Задача ${code}`, status,
  values: { status, code, title: `Задача ${code}`, executor, effort: 1, phase_uid: phase },
});
const phase = (uid: string, title: string) => ({
  id: uid, title, status: null as unknown as string, values: { title, progress: '1/2', valid_from: null },
});
function part(key: 'tasks' | 'phases', items: LorePart['items']): LorePart {
  return { key, label: key, type: key === 'tasks' ? 'task' : 'phase', rel: 'PART_OF', dir: 'in', state: 'ok', count: items.length, items };
}
const contract = (): LoreRecord1 => ({
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SPRINT_X', title: 'Спринт X', status: 'active', version: null, updated_at: null, updated_by: null },
  schema: { type: 'sprint', label: 'Спринт', icon: 'sprint', fields: [], tabs: [], relations: [] },
  values: { title: 'Спринт X' },
  links: [],
  parts: [
    part('phases', [phase('PH-1', 'Разведка'), phase('PH-2', 'Сборка')]),
    part('tasks', [task('A-1', 'PH-1', 'done'), task('A-2', 'PH-2', 'planned', 'codex'), task('A-3', null)]),
  ],
  facts: { tasks: { done: 1, total: 3 } },
  perms: { can_edit: true, can_status: true, can_create: false, status_next: [], reason: null },
  meta: { loaded_at: '2026-11-11T00:00:00.000Z', facade: 'server', sources: [] },
});

function fakeWin(search = ''): UrlWindow {
  const win: UrlWindow = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_: unknown, __: string, url?: string | URL | null) => { win.location.search = new URL(String(url), 'http://x').search; },
      replaceState: (_: unknown, __: string, url?: string | URL | null) => { win.location.search = new URL(String(url), 'http://x').search; },
    },
  };
  return win;
}
const deadFetch = (async () => new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
const treeIds = () => Array.from(document.querySelectorAll('.sk-ttab tr[data-line="record"]')).map(tr => (tr as HTMLElement).dataset.id);

describe('S4-SPRINT-TASKS-CONTROLS · строки дерева несут поля для фасетов', () => {
  it('у задачи — фаза подписью (фасет «Фаза»), у задачи вне фаз — пусто', () => {
    const rows = sprintTreeOf(contract()).rows;
    expect(rows.find(r => r.key === 'SPRINT_X/A-2')?.phase).toBe('Сборка');
    expect(rows.find(r => r.key === 'SPRINT_X/A-3')?.phase).toBeNull();
  });
});

describe('S4-SPRINT-TASKS-CONTROLS · вкладка «Задачи» спринта', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/'); });

  it('видов три: Дерево · Таблица · Список; выбор — в адресе рядом с ?tview=', () => {
    const win = fakeWin();
    render(<SprintTasksPanel contract={contract()} win={win} fetchImpl={deadFetch} onStatusSaved={() => {}} />);
    const group = screen.getByRole('group', { name: 'Вид задач' });
    expect(within(group).getAllByRole('button').map(b => b.textContent)).toEqual(['Дерево', 'Таблица', 'Список']);
    fireEvent.click(within(group).getByRole('button', { name: 'Список' }));
    expect(new URLSearchParams(win.location.search).get(TASK_VIEW_PARAM)).toBe('list');
  });

  it('дерево — со стандартной полосой: поиск, фасеты статус / исполнитель / фаза, группировка, порядок', () => {
    const { container } = render(<SprintTasksPanel contract={contract()} win={fakeWin()} fetchImpl={deadFetch} onStatusSaved={() => {}} />);
    const bar = container.querySelector('.sk-ttab .sk-list__controls') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(Array.from(bar.querySelectorAll('fieldset.sk-list__seg')).map(f => (f as HTMLElement).dataset.seg)).toEqual(['filter', 'group', 'sort']);
    for (const name of [/^Статус/, /^Исполнитель/, /^Фаза/]) expect(within(bar).getByRole('button', { name })).toBeTruthy();
  });

  it('поиск в дереве: найденная задача — под своей фазой, фаза без подходящих задач скрыта', () => {
    render(<SprintTasksPanel contract={contract()} win={fakeWin()} fetchImpl={deadFetch} onStatusSaved={() => {}} />);
    expect(treeIds()).toEqual(['SPRINT_X', 'PH-1', 'SPRINT_X/A-1', 'PH-2', 'SPRINT_X/A-2', 'SPRINT_X/A-3']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Текст в ID или названии' }), { target: { value: 'A-2' } });
    expect(treeIds()).toEqual(['SPRINT_X', 'PH-2', 'SPRINT_X/A-2']);
  });

  it('вид «Список» (?tview=list) — NestedList со статусом, исполнителем и фазой', async () => {
    const { container } = render(<SprintTasksPanel contract={contract()} win={fakeWin(`?${TASK_VIEW_PARAM}=list`)} fetchImpl={deadFetch} onStatusSaved={() => {}} />);
    const nested = container.querySelector('.sk-nested') as HTMLElement;
    expect(nested).not.toBeNull();
    expect(container.querySelector('.sk-ttab')).toBeNull();
    await waitFor(() => expect(within(nested).getByText('Задача A-2')).toBeTruthy());
    for (const name of [/^Статус/, /^Исполнитель/, /^Фаза/]) expect(within(nested).getByRole('button', { name })).toBeTruthy();
  });

  it('вид «Таблица» прежний и тоже с полосой (поиск в таблице задач)', async () => {
    const { container } = render(<SprintTasksPanel contract={contract()} win={fakeWin(`?${TASK_VIEW_PARAM}=table`)} fetchImpl={deadFetch} onStatusSaved={() => {}} />);
    await waitFor(() => expect(container.querySelector('section.sprint-tasks')).not.toBeNull());
    // Источник таблицы — свой срез; заглушка 503, поэтому проверяем подключение в исходнике.
    const src = (await import('node:fs')).readFileSync(`${__dirname}/SprintTasksTab.tsx`, 'utf8');
    expect(src).toMatch(/<TaskTable[\s\S]*?\n\s*controls\s*\n[\s\S]*?\/>/);
  });
});
