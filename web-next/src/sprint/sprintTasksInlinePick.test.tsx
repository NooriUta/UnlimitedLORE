// @vitest-environment jsdom
// SPRINT_UXR_POLISH_UAT_1113/PU-25 — приёмка v1.17.21 (14.11.2026): статусы «?» в таблице задач
// починены, а выпадающие списки РОЛЕЙ (автор / исполнитель / ревьюер) и КЛАССА РАБОТЫ (uc / jtd /
// enb) в правке строки проверены не были. Этот файл проверяет их целиком, по пути данных
// приложения: срезы tasks_of_sprint, dictionary и task_identities → таблица kit → POST /lore/task/edit.
//
// Что ловит: список задач отдаёт держателя роли ИМЕНЕМ (у агента — name), а кандидаты приходят
// КОДОМ (actor_id). Без сопоставления выбранным стоял не кандидат, а лишний пункт с тем же именем;
// после сохранения строка показывала бы код агента вместо имени.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { SprintTasksTab } from './SprintTasksTab';

beforeAll(() => { registerGameIcons(gameIcons); });

const TASK = {
  task_uid: 'SPRINT_X/T-1', task_id: 'T-1', title: 'Задача', order_index: 1, phase_uid: null, status_raw: '🔄 IN PROGRESS',
  effort_days: 1, author_agent: 'Алекса', executor_agent: 'Claude Code', reviewer_agent: 'Алекса', task_type: 'dev', work_class: 'enb',
};
const IDENTITIES = [
  { code: 'Алекса', title: 'Алекса', kind: 'person' },
  { code: 'AGENT-FULL-x1', title: 'Claude Code', kind: 'agent' },
  { code: 'AGENT-CODEX-y2', title: 'Codex', kind: 'agent' },
];
const DICTS: Record<string, unknown[]> = {
  task_type: [{ dict_type: 'task_type', code: 'dev', label_ru: 'Разработка', sort_order: 10 }, { dict_type: 'task_type', code: 'docs', label_ru: 'Документация', sort_order: 20 }],
  work_class: [
    { dict_type: 'work_class', code: 'uc', label_ru: 'Use Case', sort_order: 10 },
    { dict_type: 'work_class', code: 'jtd', label_ru: 'Job to be Done', sort_order: 20 },
    { dict_type: 'work_class', code: 'enb', label_ru: 'Enabler', sort_order: 30 },
  ],
};

function fakeFetch() {
  const calls: { url: string; body?: unknown }[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const u = new URL(url, 'http://x');
    switch (u.pathname) {
      case '/lore/slice/tasks_of_sprint': return json({ rows: [TASK] });
      case '/lore/slice/phases_of_sprint': return json({ rows: [] });
      case '/lore/slice/dictionary': return json({ rows: DICTS[u.searchParams.get('dict_type') ?? ''] ?? [] });
      case '/lore/slice/task_identities': return json({ rows: IDENTITIES, task_uid: u.searchParams.get('id') });
      case '/lore/task/edit': return json({ ok: true });
      default: return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const win = (): UrlWindow => ({
  location: { pathname: '/', search: '?group=none', hash: '' },
  history: { pushState: () => {}, replaceState: () => {} },
} as unknown as UrlWindow);

async function openEdit(impl: typeof fetch) {
  render(<SprintTasksTab sprintId="SPRINT_X" fetchImpl={impl} win={win()} />);
  const row0 = await screen.findByRole('row', { name: /T-1/ });
  // Справочники грузятся отдельно — ждём, пока класс подпишется словарём (title статьи).
  await waitFor(() => expect(row0.querySelector('.sk-tasks__cls[title="Enabler"]')).not.toBeNull());
  await act(async () => { fireEvent.click(within(row0).getByRole('button', { name: 'Править T-1' })); });
  const row = screen.getByRole('row', { name: /T-1/ });
  await waitFor(() => expect(within(row).getByRole('combobox', { name: 'Исполнитель' })).toBeTruthy());
  return row;
}

const sel = (row: HTMLElement, name: string) => within(row).getByRole('combobox', { name }) as HTMLSelectElement;

describe('PU-25 · правка строки задач спринта: роли и класс — выбором', () => {
  it('кандидаты — из task_identities этой задачи; класс — uc / jtd / enb', async () => {
    const { impl, calls } = fakeFetch();
    const row = await openEdit(impl);
    expect(calls.some(c => c.url === '/lore/slice/task_identities?id=SPRINT_X%2FT-1')).toBe(true);
    for (const role of ['Автор', 'Исполнитель', 'Принимающий'])
      expect([...sel(row, role).options].map(o => o.textContent), role).toEqual(['Алекса', 'Claude Code', 'Codex']);
    expect([...sel(row, 'Класс').options].map(o => o.value)).toEqual(['uc', 'jtd', 'enb']);
    expect([...sel(row, 'Тип').options].map(o => o.value)).toEqual(['dev', 'docs']);
  });

  it('текущие значения выбраны: роль агента — его кандидат, класс и тип — свои', async () => {
    const { impl } = fakeFetch();
    const row = await openEdit(impl);
    expect(sel(row, 'Автор').value).toBe('Алекса');
    expect(sel(row, 'Исполнитель').value).toBe('AGENT-FULL-x1');
    expect(sel(row, 'Принимающий').value).toBe('Алекса');
    expect(sel(row, 'Класс').value).toBe('enb');
    expect(sel(row, 'Тип').value).toBe('dev');
  });

  it('сохранение: уходят только изменённые — класс кодом и исполнитель кодом кандидата', async () => {
    const { impl, calls } = fakeFetch();
    const row = await openEdit(impl);
    fireEvent.change(sel(row, 'Класс'), { target: { value: 'uc' } });
    fireEvent.change(sel(row, 'Исполнитель'), { target: { value: 'AGENT-CODEX-y2' } });
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' })); });
    const body = calls.find(c => c.url === '/lore/task/edit')?.body as Record<string, unknown>;
    expect(body).toMatchObject({ task_uid: 'SPRINT_X/T-1', title: 'Задача', work_class: 'uc', executor_agent: 'AGENT-CODEX-y2' });
    expect(body).not.toHaveProperty('author_agent');
    expect(body).not.toHaveProperty('reviewer_agent');
    expect(body).not.toHaveProperty('task_type');
    // Строка после записи — имя выбранного, а не его код.
    const after = screen.getByRole('row', { name: /T-1/ });
    expect(within(after).getByText('Codex')).toBeTruthy();
    expect(within(after).queryByText('AGENT-CODEX-y2')).toBeNull();
  });

  it('ничего не меняли — запроса нет (роль агента именем не считается правкой)', async () => {
    const { impl, calls } = fakeFetch();
    const row = await openEdit(impl);
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' })); });
    expect(calls.some(c => c.url === '/lore/task/edit')).toBe(false);
  });
});
