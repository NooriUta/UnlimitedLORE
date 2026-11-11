// @vitest-environment jsdom
// Паспорт спринта деревом с ОДНОРОДНЫМИ колонками (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TREE-NESTED).
//
// Решение владелицы 10.11.2026: «в спринтах с фазами уровень первый спринт,
// второй фаза, третий задача, но фазы опциональны». Kit-половина (TreeTable,
// KindBlock) влита (#1113); здесь — прикладной конфиг: из ответа /lore/record
// спринта (части tasks и phases, связь IN_PHASE лежит в values.phase_uid
// задачи) собирается ПЛОСКИЙ список строк {key, kind, parent} и состояние
// уровня фаз: ok | none | denied | error | truncated.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { treeTableLines, type UrlWindow } from '@seidr/kit';
import type { LorePart, LoreRecord1, LoreSource } from './loreRecordContract';
import { SPRINT_TREE_LEVELS, sprintTreeOf } from './sprintTree';
import { SprintTasksPanel, TASK_VIEW_PARAM } from '../sprint/SprintTasksPanel';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const task = (code: string, phase: string | null, status = 'planned') => ({
  id: `SPRINT_X/${code}`, title: `Задача ${code}`, status,
  values: { status, code, title: `Задача ${code}`, executor: 'claude', effort: 1, phase_uid: phase },
});
const phase = (uid: string, title: string) => ({
  id: uid, title, status: null as unknown as string, values: { title, progress: '1/2', valid_from: null },
});

function part(key: 'tasks' | 'phases', items: LorePart['items'], state: LorePart['state'] = 'ok'): LorePart {
  return {
    key, label: key, type: key === 'tasks' ? 'task' : 'phase', rel: 'PART_OF', dir: 'in',
    state, count: state === 'ok' ? items.length : null, items, ...(state !== 'ok' ? { error: `сбой ${key}` } : {}),
  };
}

function sprint(parts: LorePart[], sources: LoreSource[] = []): LoreRecord1 {
  return {
    contract: 'lore.record/1',
    record: { type: 'sprint', id: 'SPRINT_X', title: 'Спринт X', status: 'active', version: null, updated_at: null, updated_by: null },
    schema: { type: 'sprint', label: 'Спринт', icon: 'sprint', fields: [], tabs: [], relations: [] },
    values: { title: 'Спринт X' },
    links: [],
    parts,
    facts: { tasks: { done: 1, total: 3 } },
    perms: { can_edit: true, can_status: true, can_create: false, status_next: [], reason: null },
    meta: { loaded_at: '2026-11-11T00:00:00.000Z', facade: 'server', sources },
  };
}

const withPhases = () => sprint([
  part('phases', [phase('PH-1', 'Разведка'), phase('PH-2', 'Сборка')]),
  part('tasks', [task('A-1', 'PH-1', 'done'), task('A-2', 'PH-2'), task('A-3', null)]),
]);
const noPhases = () => sprint([
  part('phases', []),
  part('tasks', [task('B-1', null), task('B-2', null)]),
]);

describe('sprintTreeOf · плоский список строк дерева', () => {
  it('спринт — корень, фазы — под спринтом, задача — под своей фазой (IN_PHASE → phase_uid)', () => {
    const { rows, levelState } = sprintTreeOf(withPhases());
    expect(rows.find(r => r.key === 'SPRINT_X')).toMatchObject({ kind: 'sprint', parent: null });
    expect(rows.find(r => r.key === 'PH-1')).toMatchObject({ kind: 'phase', parent: 'SPRINT_X' });
    expect(rows.find(r => r.key === 'SPRINT_X/A-1')).toMatchObject({ kind: 'task', parent: 'PH-1' });
    expect(rows.find(r => r.key === 'SPRINT_X/A-3')).toMatchObject({ kind: 'task', parent: 'SPRINT_X' });
    expect(levelState.phase).toBe('ok');
  });

  it('с фазами: уровни 1 · 2 · 3, задачи вне фаз — отдельной группой на уровне 2', () => {
    const { rows } = sprintTreeOf(withPhases());
    const lines = treeTableLines(rows, SPRINT_TREE_LEVELS, null);
    const lv = (id: string) => lines.find(l => l.type === 'record' && l.record.id === id)?.level;
    expect(lv('SPRINT_X')).toBe(1);
    expect(lv('PH-1')).toBe(2);
    expect(lv('SPRINT_X/A-1')).toBe(3);
    const group = lines.find(l => l.type === 'group');
    expect(group).toMatchObject({ group: 'outside', level: 2, count: 1 });
    expect(lv('SPRINT_X/A-3')).toBe(3);
  });

  it('без фаз: уровень пропущен (none), задачи на уровне 2, пустого уровня и группы нет', () => {
    const { rows, levelState } = sprintTreeOf(noPhases());
    expect(levelState.phase).toBe('none');
    const lines = treeTableLines(rows, SPRINT_TREE_LEVELS, null);
    expect(lines.some(l => l.type === 'group')).toBe(false);
    const tasks = lines.filter(l => l.type === 'record' && l.record.kind === 'task');
    expect(tasks.map(l => l.level)).toEqual([2, 2]);
  });

  it('фазы не отдали (нет прав) — denied, а не «фаз нет»', () => {
    const c = sprint([part('phases', [], 'denied'), part('tasks', [task('C-1', 'PH-9')])]);
    expect(sprintTreeOf(c).levelState.phase).toBe('denied');
  });

  it('фазы не прочитались — error; части фаз в ответе нет вовсе — тоже error, не none', () => {
    expect(sprintTreeOf(sprint([part('phases', [], 'error'), part('tasks', [])])).levelState.phase).toBe('error');
    expect(sprintTreeOf(sprint([part('tasks', [task('D-1', null)])])).levelState.phase).toBe('error');
  });

  it('фазы обрезаны (data_state truncated у части phases) — truncated', () => {
    const c = sprint(
      [part('phases', [phase('PH-1', 'Разведка')]), part('tasks', [task('E-1', 'PH-1')])],
      [{ block: 'phases_of_sprint · phases', state: 'truncated', total: 120 }],
    );
    expect(sprintTreeOf(c).levelState.phase).toBe('truncated');
  });

  it('задачи не прочитались — состояние уровня задач названо, а не «задач нет»', () => {
    const c = sprint([part('phases', []), part('tasks', [], 'error')]);
    expect(sprintTreeOf(c).levelState.task).toBe('error');
  });

  it('колонки одни на все уровни: статус меняется только у задачи (у фазы он вычисляемый, у спринта — в шапке)', () => {
    const { rows } = sprintTreeOf(withPhases());
    expect(rows.find(r => r.kind === 'sprint')?.status).toBe('');
    expect(rows.find(r => r.kind === 'phase')?.status).toBe('');
    expect(rows.find(r => r.key === 'SPRINT_X/A-1')?.status).toBe('done');
    expect(rows.find(r => r.kind === 'phase')?.progress).toBe('1/2');
    expect(rows.find(r => r.kind === 'sprint')?.progress).toBe('1/3');
  });
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

describe('SprintTasksPanel · вкладка «Задачи» паспорта спринта', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/'); });

  it('по умолчанию — дерево спринт → фаза → задача (TreeTable kit), строки с aria-level', async () => {
    render(<SprintTasksPanel contract={withPhases()} win={fakeWin()} fetchImpl={deadFetch} onStatusSaved={() => {}} />);
    const table = await screen.findByRole('table', { name: /дерево|tree/i });
    const sprintRow = within(table).getByText('Спринт X').closest('tr')!;
    expect(sprintRow.getAttribute('aria-level')).toBe('1');
    expect(within(table).getByText('Разведка').closest('tr')!.getAttribute('aria-level')).toBe('2');
    expect(within(table).getByText('Задача A-1').closest('tr')!.getAttribute('aria-level')).toBe('3');
  });

  it('вид «Таблица» в адресе (?tview=table) — прежняя таблица задач, без потери правки и групп', async () => {
    const win = fakeWin(`?${TASK_VIEW_PARAM}=table`);
    const { container } = render(<SprintTasksPanel contract={withPhases()} win={win} fetchImpl={deadFetch} onStatusSaved={() => {}} />);
    await waitFor(() => expect(container.querySelector('section.sprint-tasks')).not.toBeNull());
    expect(container.querySelector('.sk-ttab')).toBeNull();
  });

  it('смена статуса задачи в строке дерева идёт POST /lore/status с типом task', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const { saveTreeStatus } = await import('../sprint/SprintTasksPanel');
    await saveTreeStatus({ type: 'task', id: 'SPRINT_X/A-2', field: 'status', from: 'planned', to: 'done' }, f);
    const post = calls.find(c => c.url.includes('/lore/status'));
    expect(post?.body).toMatchObject({ entity_type: 'task', id: 'SPRINT_X/A-2' });
  });

  it('паспорт оболочки подключает панель у спринта', () => {
    const src = readFileSync(join(__dirname, 'ListPassport.tsx'), 'utf8');
    expect(src).toMatch(/<SprintTasksPanel /);
  });
});
