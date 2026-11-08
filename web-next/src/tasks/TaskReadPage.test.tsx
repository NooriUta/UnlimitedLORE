// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-04 · экран чтения задачи на реальном API LORE
// (/lore/slice/tasks_of_sprint + history_task): текст, «‹ x из y ›» по задачам
// спринта, свойства в ушке; паспорт, вкладка и ушко — в URL.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { TaskReadPage } from './TaskReadPage';
import type { SprintTaskRow } from './taskRecord';

beforeAll(() => registerGameIcons(gameIcons));

const T = (task_id: string, order_index: number, over: Partial<SprintTaskRow> = {}): SprintTaskRow => ({
  task_uid: `uid-${task_id}`, task_id, title: `Задача ${task_id}`, order_index, status_raw: '⬜ TODO', effort_days: 1,
  note_md: `Текст задачи ${task_id}`, component_ids: ['FORSETI'], realizes_uc: null,
  executor_agent: 'fleet-s5', reviewer_agent: 'owner', author_agent: null, task_type: 'feature', work_class: 'uc', ...over,
});
const ROWS = [T('T-3', 3), T('T-1', 1), T('T-2', 2, { status_raw: '🔄 IN_PROGRESS' })];

type Route = (url: URL) => { status: number; body: unknown };
function fetchOf(route: Route) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lore.test');
    const { status, body } = route(url);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
}
const okRoute: Route = url => {
  if (url.pathname === '/lore/slice/tasks_of_sprint') return { status: 200, body: { rows: ROWS } };
  if (url.pathname === '/lore/slice/history_task') {
    return { status: 200, body: { rows: [
      { valid_from: '2026-11-01T10:00:00', status_raw: '⬜ TODO', effort_days: 1, note_md: 'x', source_commit: null },
      { valid_from: '2026-11-02T10:00:00', status_raw: '🔄 IN_PROGRESS', effort_days: 1, note_md: 'x', source_commit: 'c0ffee1' },
    ] } };
  }
  return { status: 404, body: { error: 'NOT_FOUND' } };
};

function at(search: string) { window.history.replaceState(null, '', `/${search}`); }
const params = () => new URLSearchParams(window.location.search);

beforeEach(() => at('?section=tasks&passport=SPRINT_A%2FT-2'));
afterEach(() => at(''));

describe('S5-04 · TaskReadPage', () => {
  it('грузит задачи спринта с реального слайса и показывает текст и «2 из 3»', async () => {
    const f = fetchOf(okRoute);
    render(<TaskReadPage fetchImpl={f} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Задача T-2' })).toBeTruthy();
    expect(screen.getByText('Текст задачи T-2')).toBeTruthy();
    expect(screen.getByText('2 из 3')).toBeTruthy();
    const first = new URL(String(f.mock.calls[0][0]), 'http://lore.test');
    expect(first.pathname).toBe('/lore/slice/tasks_of_sprint');
    expect(first.searchParams.get('sprint_id')).toBe('SPRINT_A');
  });

  it('пока грузится — скелет, а не пустота', () => {
    const never = vi.fn(() => new Promise<Response>(() => {}));
    render(<TaskReadPage fetchImpl={never} />);
    expect(screen.getByTestId('task-read-loading')).toBeTruthy();
  });

  it('«›» листает к следующей задаче спринта и пишет паспорт в URL', async () => {
    render(<TaskReadPage fetchImpl={fetchOf(okRoute)} />);
    await screen.findByText('2 из 3');
    fireEvent.click(screen.getByRole('button', { name: 'Следующая: SPRINT_A/T-3' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Задача T-3' })).toBeTruthy();
    expect(params().get('passport')).toBe('SPRINT_A/T-3');
    expect(screen.getByText('3 из 3')).toBeTruthy();
  });

  it('«Назад» браузера возвращает прежнюю задачу (состояние в URL)', async () => {
    render(<TaskReadPage fetchImpl={fetchOf(okRoute)} />);
    await screen.findByText('2 из 3');
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущая: SPRINT_A/T-1' }));
    await screen.findByRole('heading', { level: 1, name: 'Задача T-1' });
    act(() => { at('?section=tasks&passport=SPRINT_A%2FT-2'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Задача T-2' })).toBeTruthy();
  });

  it('ушко «Свойства» раскрывает свойства задачи и запоминает это в URL', async () => {
    render(<TaskReadPage fetchImpl={fetchOf(okRoute)} />);
    await screen.findByText('2 из 3');
    // S4-28: «Свойства» — ушко и кнопка в строке над записью, одно раскрытие.
    const [, ear] = screen.getAllByRole('button', { name: 'Свойства' });
    expect(ear.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(ear);
    expect(params().get('props')).toBe('1');
    const aside = await screen.findByRole('complementary', { name: 'Свойства' });
    expect(within(aside).getByText('fleet-s5')).toBeTruthy();
    expect(within(aside).getByText('FORSETI')).toBeTruthy();
  });

  // S4-28: паспорт — продолжение списка: крошки «← Спринт SPRINT_A / T-2» в одной строке с листалкой.
  it('крошки ведут в паспорт спринта; ID задачи — текущая страница; листалка в той же строке', async () => {
    render(<TaskReadPage fetchImpl={fetchOf(okRoute)} />);
    await screen.findByText('2 из 3');
    const nav = screen.getByRole('navigation', { name: 'Путь к записи' });
    expect(within(nav).getByRole('link').getAttribute('href')).toBe('?section=sprints&passport=SPRINT_A');
    expect(within(nav).getByText('T-2').getAttribute('aria-current')).toBe('page');
    expect(nav.closest('[data-testid="kit-rec-bar"]')?.textContent).toContain('2 из 3');
  });

  it('журнал задачи — из history_task', async () => {
    at('?section=tasks&passport=SPRINT_A%2FT-2&tab=journal');
    const f = fetchOf(okRoute);
    render(<TaskReadPage fetchImpl={f} />);
    await waitFor(() => expect(screen.getAllByTestId('kit-journal-row').length).toBe(2));
    const hist = f.mock.calls.map(c => new URL(String(c[0]), 'http://lore.test')).find(u => u.pathname === '/lore/slice/history_task');
    expect(hist?.searchParams.get('id')).toBe('uid-T-2');
  });

  it('история упала — журнал честно «не загрузился», текст задачи на месте', async () => {
    at('?section=tasks&passport=SPRINT_A%2FT-2&tab=journal');
    const route: Route = url => (url.pathname === '/lore/slice/history_task'
      ? { status: 500, body: { error: 'BOOM' } } : okRoute(url));
    render(<TaskReadPage fetchImpl={fetchOf(route)} />);
    expect(await screen.findByText('Журнал не загрузился')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Задача T-2' })).toBeTruthy();
  });

  it('спринт не загрузился — ошибка с повтором, а не «задач нет»', async () => {
    let fail = true;
    const route: Route = url => (fail ? { status: 503, body: { error: 'LORE_UPSTREAM' } } : okRoute(url));
    render(<TaskReadPage fetchImpl={fetchOf(route)} />);
    expect(await screen.findByText('Задачу не удалось загрузить')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Задача T-2' })).toBeTruthy();
  });

  it('403 — «нет доступа», а не ошибка и не пусто', async () => {
    render(<TaskReadPage fetchImpl={fetchOf(() => ({ status: 403, body: { error: 'FORBIDDEN' } }))} />);
    expect(await screen.findByText('Нет доступа к задачам спринта')).toBeTruthy();
  });

  it('задачи нет в спринте — проверенное «не найдено»', async () => {
    at('?section=tasks&passport=SPRINT_A%2FT-404');
    render(<TaskReadPage fetchImpl={fetchOf(okRoute)} />);
    expect(await screen.findByText('Задачи SPRINT_A/T-404 в спринте нет')).toBeTruthy();
  });

  it('паспорт без спринта — подсказка о форме «спринт/код», запросов нет', () => {
    at('?section=tasks&passport=T-2');
    const f = fetchOf(okRoute);
    render(<TaskReadPage fetchImpl={f} />);
    expect(screen.getByText('Задача открывается парой «спринт/код»')).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
  });
});
