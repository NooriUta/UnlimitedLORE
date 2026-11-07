// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09 — задачи в списке спринтов: колонка
// «задачи x/y» и раскрытие строки с задачами (задачи первыми), смена статуса
// задачи за ≤2 касания (StatusChip kit, S4-07). Жалоба владелицы: «не вижу
// задачи и статусы в два клика».
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { createLoreClient, type LoreClient } from './loreClient';
import { STATUS_MATCH, planStatusOf, PLAN_STATUSES } from './taskStatus';
import { countProgress, loadSprintProgress } from './sprintProgress';
import { SprintTasks } from './SprintTasks';
import { SprintsPage } from './SprintsPage';

beforeAll(() => { registerGameIcons(gameIcons); });

const here = dirname(fileURLToPath(import.meta.url));
const shared = JSON.parse(readFileSync(resolve(here, '../../../shared/lore-statuses.json'), 'utf8')) as {
  planStatuses: string[];
  statusMatch: Record<string, { marker: string; words: string[] }>;
};

type Json = Record<string, unknown>;
function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
/** Фейковый fetch: маршрут по пути+слайсу, журнал вызовов. */
function fakeFetch(routes: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://lore.test');
    calls.push({ url, init });
    return routes(url, init);
  });
  return { fn, calls };
}
const client = (f: ReturnType<typeof fakeFetch>): LoreClient =>
  createLoreClient({ fetch: f.fn as unknown as typeof fetch, origin: 'http://lore.test' });

const task = (sprint: string, id: string, status_raw: string): Json =>
  ({ task_uid: `${sprint}/${id}`, task_id: id, title: `Задача ${id}`, status_raw, sprint_id: sprint, order_index: 1 });

describe('статус задачи из status_raw — словарь shared/lore-statuses.json', () => {
  it('маркер и слово читаются, неизвестное — unknown, а не todo', () => {
    expect(planStatusOf('✅ DONE')).toBe('done');
    expect(planStatusOf('📋 PLANNED')).toBe('planned');
    expect(planStatusOf('🔄 IN PROGRESS')).toBe('active');
    expect(planStatusOf('MERGED — влито')).toBe('done');
    expect(planStatusOf('🚫 CANCELLED')).toBe('cancelled');
    expect(planStatusOf('NOT DONE')).toBe('unknown');
    expect(planStatusOf(null)).toBe('unknown');
  });
  it('копия словаря не разошлась с shared (образ v2 shared/ не видит)', () => {
    expect(STATUS_MATCH).toEqual(shared.statusMatch);
    expect([...PLAN_STATUSES].sort()).toEqual([...shared.planStatuses].sort());
  });
});

describe('прогресс «x/y»', () => {
  it('x — готовые, y — все, кроме отменённых', () => {
    expect(countProgress([
      { status_raw: '✅ DONE' }, { status_raw: '📋 PLANNED' }, { status_raw: '🚫 CANCELLED' }, { status_raw: '🔄 IN PROGRESS' },
    ])).toEqual({ done: 1, total: 3 });
    expect(countProgress([])).toEqual({ done: 0, total: 0 });
  });

  it('одним пакетным слайсом на 20 спринтов; упавшая пачка — «не посчитано», не 0/0', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `S${i}`);
    const f = fakeFetch(url => {
      const list = (url.searchParams.get('sprint_ids') ?? '').split(',');
      if (list.includes('S24')) return jsonRes({ error: 'LORE_UPSTREAM', detail: 'down' }, 502);
      return jsonRes({ rows: [task('S0', 'T1', '✅ DONE'), task('S0', 'T2', '📋 PLANNED')] });
    });
    const res = await loadSprintProgress(client(f), ids);
    expect(f.calls.map(c => c.url.pathname)).toEqual(['/lore/slice/tasks_of_sprints_batch', '/lore/slice/tasks_of_sprints_batch']);
    expect(f.calls[0].url.searchParams.get('sprint_ids')!.split(',')).toHaveLength(20);
    expect(res.get('S0')).toEqual({ done: 1, total: 2 });
    expect(res.get('S1')).toEqual({ done: 0, total: 0 });
    expect(res.get('S24')).toMatchObject({ error: expect.stringContaining('502') });
  });

  it('обрезанная выдача пачки — partial, а не полный подсчёт', async () => {
    const f = fakeFetch(() => jsonRes({ rows: [task('S0', 'T1', '✅ DONE')], truncated: true, limit: 1 }));
    const res = await loadSprintProgress(client(f), ['S0', 'S1']);
    expect(res.get('S0')).toEqual({ done: 1, total: 1, partial: true });
    expect(res.get('S1')).toEqual({ done: 0, total: 0, partial: true });
  });
});

describe('раскрытая строка: задачи спринта и статус за ≤2 касания', () => {
  it('задачи со статусами; касание чипа → касание статуса → POST /lore/status', async () => {
    const f = fakeFetch((url, init) => {
      if (url.pathname === '/lore/status') {
        return jsonRes({ ok: true, entity_type: 'task', id: 'SP/T1', old_status: 'planned', new_status: JSON.parse(String(init?.body)).status });
      }
      return jsonRes({ rows: [task('SP', 'T1', '📋 PLANNED'), task('SP', 'T2', '✅ DONE')], page: { has_more: false, fields_checked: true } });
    });
    render(<SprintTasks sprintId="SP" client={client(f)} />);
    const list = await screen.findByRole('list', { name: 'Задачи спринта SP' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(f.calls[0].url.pathname).toBe('/lore/slice/tasks_of_sprint');
    expect(f.calls[0].url.searchParams.get('sprint_id')).toBe('SP');

    // касание 1: чип статуса задачи
    fireEvent.click(within(list).getAllByRole('button', { name: /^Статус: / })[0]);
    // касание 2: целевой статус
    fireEvent.click(screen.getByRole('menuitem', { name: /В работе/ }));
    await waitFor(() => expect(f.calls.some(c => c.url.pathname === '/lore/status')).toBe(true));
    const post = f.calls.find(c => c.url.pathname === '/lore/status')!;
    expect(post.init?.method).toBe('POST');
    expect(JSON.parse(String(post.init?.body))).toEqual({ entity_type: 'task', id: 'SP/T1', status: 'active' });
  });

  it('отказ сохранения — откат и причина на экране', async () => {
    const f = fakeFetch(url => url.pathname === '/lore/status'
      ? jsonRes({ error: 'FORBIDDEN', detail: 'admin role required' }, 403)
      : jsonRes({ rows: [task('SP', 'T1', '📋 PLANNED')] }));
    render(<SprintTasks sprintId="SP" client={client(f)} />);
    const list = await screen.findByRole('list', { name: 'Задачи спринта SP' });
    fireEvent.click(within(list).getByRole('button', { name: /^Статус: / }));
    fireEvent.click(screen.getByRole('menuitem', { name: /В работе/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('admin role required');
    expect(within(list).getByRole('button', { name: /^Статус: / }).getAttribute('data-status')).toBe('planned');
  });

  it('сбой загрузки задач — ошибка с «повторить», а не «задач нет»', async () => {
    const f = fakeFetch(() => jsonRes({ error: 'LORE_UPSTREAM', detail: 'db down' }, 502));
    render(<SprintTasks sprintId="SP" client={client(f)} />);
    expect(await screen.findByRole('button', { name: /Повторить/ })).toBeTruthy();
    expect(screen.queryByText(/Задач нет/)).toBeNull();
  });

  it('проверенный ноль — «задач нет»', async () => {
    const f = fakeFetch(() => jsonRes({ rows: [], page: { has_more: false, fields_checked: true } }));
    render(<SprintTasks sprintId="SP" client={client(f)} />);
    expect(await screen.findByText('В спринте нет задач')).toBeTruthy();
  });
});

describe('маршрут /sprints', () => {
  it('routeOf узнаёт /sprints и /sprints/', async () => {
    const { routeOf } = await import('../App');
    expect(routeOf('/sprints')).toBe('sprints');
    expect(routeOf('/sprints/')).toBe('sprints');
    expect(routeOf('/kit')).toBe('kit');
    expect(routeOf('/')).toBe('home');
  });
});

describe('экран «Спринты»: колонка «задачи x/y» и раскрытие', () => {
  it('x/y в строке спринта, раскрытие показывает задачи первыми', async () => {
    const f = fakeFetch(url => {
      const slice = url.pathname.split('/').pop();
      if (slice === 'sprints') {
        return jsonRes({ rows: [
          { sprint_id: 'SP', name: 'Спринт SP', status_raw: '🔄 IN PROGRESS' },
          { sprint_id: 'SQ', name: 'Спринт SQ', status_raw: '✅ DONE' },
        ], page: { limit: 500, offset: 0, total: 2, has_more: false } });
      }
      if (slice === 'tasks_of_sprints_batch') {
        return jsonRes({ rows: [task('SP', 'T1', '✅ DONE'), task('SP', 'T2', '📋 PLANNED'), task('SQ', 'T1', '✅ DONE')] });
      }
      return jsonRes({ rows: [task('SP', 'T1', '✅ DONE'), task('SP', 'T2', '📋 PLANNED')] });
    });
    const { container } = render(<SprintsPage client={client(f)} urlState={false} />);
    await waitFor(() => expect(container.querySelector('[data-record-id="SP"] [data-progress="ok"]')).toBeTruthy());
    expect(screen.getByRole('columnheader', { name: 'Задачи' })).toBeTruthy();
    expect(container.querySelector('[data-record-id="SP"] [data-progress]')!.textContent).toContain('1/2');
    expect(container.querySelector('[data-record-id="SQ"] [data-progress="complete"]')!.textContent).toContain('1/1');

    // одно касание — раскрыть; задачи — первым блоком раскрытой строки
    fireEvent.click(screen.getByRole('button', { name: 'Раскрыть: Спринт SP' }));
    const xrow = container.querySelector('[data-expand-of="SP"] td')!;
    const tasks = await within(xrow as HTMLElement).findByRole('list', { name: 'Задачи спринта SP' });
    // задачи — первым блоком раскрытой строки
    expect(xrow.firstElementChild?.getAttribute('data-sprint-tasks')).toBe('SP');
    expect(xrow.firstElementChild?.firstElementChild).toBe(tasks);
  });

  it('сбой списка спринтов — ошибка, а не «пусто»', async () => {
    const f = fakeFetch(() => jsonRes({ error: 'LORE_UPSTREAM', detail: 'down' }, 502));
    render(<SprintsPage client={client(f)} urlState={false} />);
    expect(await screen.findByRole('button', { name: /Повторить/ })).toBeTruthy();
  });
});
