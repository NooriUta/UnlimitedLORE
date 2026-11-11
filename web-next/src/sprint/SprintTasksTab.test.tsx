// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-02 — вкладка «Задачи» паспорта спринта в v2:
// таблица сверху (TaskTable из Seiðr-kit), группировка в URL (?group=…),
// статус в 2 касания и правка в строке через существующие эндпоинты задачи,
// честные состояния (пусто / нет прав / ошибка / обрезано).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { SprintTasksTab } from './SprintTasksTab';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const tasks = [
  { task_uid: 'u1', task_id: 'S5-01', title: 'Паспорт спринта', order_index: 1, phase_uid: 'ph-1', status_raw: 'active', effort_days: 2, executor_agent: 'claude', reviewer_agent: 'owner', task_type: 'feature' },
  { task_uid: 'u2', task_id: 'S5-02', title: 'Вкладка задач', order_index: 2, phase_uid: 'ph-2', status_raw: 'todo', effort_days: 1, executor_agent: null, reviewer_agent: null, task_type: null },
];
const phases = [
  { phase_uid: 'ph-1', phase_id: 'P1', order_index: 1, title: 'Разведка' },
  { phase_uid: 'ph-2', phase_id: 'P2', order_index: 2, title: 'Сборка' },
];

type Route = { status?: number; body: unknown };
function fakeFetch(routes: Record<string, Route | (() => Route)>) {
  const calls: { url: string; body?: unknown }[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = new URL(url, 'http://x').pathname;
    const r0 = routes[path];
    const r = typeof r0 === 'function' ? r0() : r0;
    if (!r) return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function fakeWin(search = ''): UrlWindow & { pushes: string[] } {
  const pushes: string[] = [];
  const win = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_: unknown, __: string, url: string) => { pushes.push(url); win.location.search = new URL(url, 'http://x').search; },
      replaceState: (_: unknown, __: string, url: string) => { pushes.push(url); win.location.search = new URL(url, 'http://x').search; },
    },
    pushes,
  };
  return win;
}

const ok = () => fakeFetch({
  '/lore/slice/tasks_of_sprint': { body: { rows: tasks } },
  '/lore/slice/phases_of_sprint': { body: { rows: phases } },
  '/lore/status': { body: { ok: true } },
  '/lore/task/edit': { body: { ok: true } },
});

describe('SprintTasksTab · таблица сверху', () => {
  it('грузит задачи спринта и рисует таблицу, по умолчанию — по фазам', async () => {
    const { impl, calls } = ok();
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin()} />);
    const table = await screen.findByRole('table', { name: /Задачи спринта SPRINT_X/ });
    expect(within(table).getByRole('row', { name: /S5-01/ })).toBeTruthy();
    expect(within(table).getAllByRole('rowheader').map(h => h.textContent)[0]).toMatch(/P1 · Разведка/);
    expect(calls.some(c => c.url === '/lore/slice/tasks_of_sprint?sprint_id=SPRINT_X')).toBe(true);
  });

  it('группировка читается из URL и пишется в URL (replace)', async () => {
    const { impl } = ok();
    const win = fakeWin('?section=sprints&passport=SPRINT_X&tab=tasks&group=status');
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={win} />);
    const group = await screen.findByRole('group', { name: 'Группировка' });
    expect(within(group).getByRole('button', { name: 'По статусу' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'Списком' }));
    expect(win.pushes[win.pushes.length - 1]).toMatch(/group=none/);
    expect(win.pushes[win.pushes.length - 1]).toMatch(/passport=SPRINT_X/);
    expect(within(group).getByRole('button', { name: 'Списком' }).getAttribute('aria-pressed')).toBe('true');
  });

  // S9-07: «Фаза → статус» живёт в адресе тем же механизмом, что прочие разрезы.
  it('?group=phase_status читается из адреса и пишется в него', async () => {
    const { impl } = ok();
    const win = fakeWin('?group=phase_status');
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={win} />);
    const group = await screen.findByRole('group', { name: 'Группировка' });
    expect(within(group).getByRole('button', { name: 'Фаза → статус' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'По фазе' }));
    fireEvent.click(within(group).getByRole('button', { name: 'Фаза → статус' }));
    expect(win.pushes[win.pushes.length - 1]).toMatch(/group=phase_status/);
  });

  it('мусор в ?group= — умолчание «по фазе», а не пустая таблица', async () => {
    const { impl } = ok();
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin('?group=zzz')} />);
    const group = await screen.findByRole('group', { name: 'Группировка' });
    expect(within(group).getByRole('button', { name: 'По фазе' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('SprintTasksTab · запись', () => {
  it('статус в 2 касания: POST /lore/status, звезда показывает новый статус', async () => {
    const { impl, calls } = ok();
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin()} />);
    const row = await screen.findByRole('row', { name: /S5-02/ });
    fireEvent.click(within(row).getByRole('button', { name: /Статус: к работе/ }));
    await act(async () => { fireEvent.click(screen.getByRole('menuitemradio', { name: 'Готово' })); });
    expect(calls.find(c => c.url === '/lore/status')?.body).toEqual({ entity_type: 'task', id: 'u2', status: 'done' });
    await waitFor(() => expect(within(screen.getByRole('row', { name: /S5-02/ })).getByRole('button', { name: /Статус: готово/ })).toBeTruthy());
  });

  it('отказ сервера на статусе — ошибка в строке, статус прежний', async () => {
    const { impl } = fakeFetch({
      '/lore/slice/tasks_of_sprint': { body: { rows: tasks } },
      '/lore/slice/phases_of_sprint': { body: { rows: phases } },
      '/lore/status': { status: 409, body: { error: 'CONFLICT', detail: 'reviewer must differ' } },
    });
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin()} />);
    const row = await screen.findByRole('row', { name: /S5-02/ });
    fireEvent.click(within(row).getByRole('button', { name: /Статус/ }));
    await act(async () => { fireEvent.click(screen.getByRole('menuitemradio', { name: 'Готово' })); });
    expect(screen.getByRole('alert').textContent).toMatch(/HTTP 409 · reviewer must differ/);
    expect(within(screen.getByRole('row', { name: /S5-02/ })).getByRole('button', { name: /Статус: к работе/ })).toBeTruthy();
  });

  it('правка в строке: POST /lore/task/edit, строка показывает новое значение', async () => {
    const { impl, calls } = ok();
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin()} />);
    const row = await screen.findByRole('row', { name: /S5-01/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Править S5-01' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Задача' }), { target: { value: 'Паспорт v2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Сохранить' })); });
    expect(calls.find(c => c.url === '/lore/task/edit')?.body).toMatchObject({ task_uid: 'u1', title: 'Паспорт v2', effort_days: null });
    expect(within(screen.getByRole('row', { name: /S5-01/ })).getByText('Паспорт v2')).toBeTruthy();
  });

  it('id задачи — ссылка на задачу в разделе «Задачи» оболочки (S4-13: меню не пропадает)', async () => {
    const { impl } = ok();
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin()} />);
    const link = await screen.findByRole('link', { name: 'S5-01' });
    expect(link.getAttribute('href')).toBe('/?mod=forseti&sec=task&open=SPRINT_X%2FS5-01');
  });
});

describe('SprintTasksTab · честные состояния', () => {
  it('ноль задач — «пусто (проверено)», а не пустая таблица', async () => {
    const { impl } = fakeFetch({
      '/lore/slice/tasks_of_sprint': { body: { rows: [] } },
      '/lore/slice/phases_of_sprint': { body: { rows: [] } },
    });
    const { container } = render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin()} />);
    await waitFor(() => expect(container.querySelector('[data-state="empty"]')).not.toBeNull());
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('403 — «нет прав», не «пусто»', async () => {
    const { impl } = fakeFetch({
      '/lore/slice/tasks_of_sprint': { status: 403, body: { error: 'FORBIDDEN' } },
      '/lore/slice/phases_of_sprint': { body: { rows: [] } },
    });
    const { container } = render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin()} />);
    await waitFor(() => expect(container.querySelector('[data-state="forbidden"]')).not.toBeNull());
  });

  it('500 — ошибка с «Повторить»; повтор перезапрашивает', async () => {
    let n = 0;
    const { impl } = fakeFetch({
      '/lore/slice/tasks_of_sprint': () => (n++ === 0 ? { status: 500, body: { error: 'LORE_UPSTREAM' } } : { body: { rows: tasks } }),
      '/lore/slice/phases_of_sprint': { body: { rows: phases } },
    });
    const { container } = render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin()} />);
    await waitFor(() => expect(container.querySelector('[data-state="error"]')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('выдача обрезана сервером — плашка над таблицей', async () => {
    const { impl } = fakeFetch({
      '/lore/slice/tasks_of_sprint': { body: { rows: tasks, truncated: true, limit: 2 } },
      '/lore/slice/phases_of_sprint': { body: { rows: phases } },
    });
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin()} />);
    await screen.findByRole('table');
    expect(document.body.textContent).toMatch(/обрезана сервером на 2/);
  });
});

// Замечание владелицы по v1.17.4: «задачи в паспорте спринта — общей таблицей
// с колонками S4-35… наши любимые общие колонки». Выбор колонок у списков был
// с S4-35, а в таблице задач набор был зашит. Набор живёт в адресе: им делятся
// ссылкой, как видом списка.
describe('S4-36 · набор колонок задач', () => {
  it('набор из адреса применяется, незнакомый ключ отбрасывается', async () => {
    const { impl } = ok();
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin('?tcols=id,title,выдумка')} />);
    const table = await screen.findByRole('table', { name: /Задачи спринта/ });
    // «Действия» — не колонка набора: она появляется от права правки, и её
    // выбором не управляют (иначе правку можно было бы спрятать от себя).
    expect(within(table).getAllByRole('columnheader').map(th => th.textContent?.trim())).toEqual(['ID', 'Задача', 'Действия']);
  });

  it('набора в адресе нет — прежние колонки v1, паритет не пропадает молча', async () => {
    const { impl } = ok();
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={fakeWin()} />);
    const table = await screen.findByRole('table', { name: /Задачи спринта/ });
    const heads = within(table).getAllByRole('columnheader').map(th => th.textContent?.trim());
    expect(heads).toContain('Статус');
    expect(heads).toContain('Класс');
    expect(heads).toContain('Ревьюер');
  });

  it('выбор колонки пишется в адрес, а не только в память вкладки', async () => {
    const { impl } = ok();
    const win = fakeWin('?tcols=id,title');
    render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={win} />);
    await screen.findByRole('table', { name: /Задачи спринта/ });
    fireEvent.click(screen.getByRole('button', { name: 'Колонки' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Статус' }));
    expect(decodeURIComponent(win.pushes[win.pushes.length - 1])).toMatch(/tcols=status,id,title/);
  });
});
