// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-22 (волна 1c): «Спринты» на общем ListScreen, как ADR.
// Два движка списка были двумя продуктами: возможность появлялась в одном
// разделе и отсутствовала в соседнем. Переход без потерь — паритет со старым
// SprintsPage (S4-09): колонка «задачи x/y» с честными «…»/«?» и раскрытие
// строки с задачами, где статус меняется за ≤2 касания. Плюс то, чего у
// SprintsPage не было: «Быстро», фильтры по проекту и релизу, доска,
// «закрытые внизу» и шапка экрана.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { ListScreen } from './ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const task = (sprint: string, id: string, status_raw: string) =>
  ({ task_uid: `${sprint}/${id}`, task_id: id, title: `Задача ${id}`, status_raw, sprint_id: sprint, order_index: 1 });

function fakeFetch() {
  const calls: URL[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://lore.test');
    calls.push(url);
    if (url.pathname === '/lore/status') {
      return jsonRes({ ok: true, entity_type: 'task', id: 'SP/T2', new_status: JSON.parse(String(init?.body)).status });
    }
    const slice = url.pathname.split('/').pop();
    if (slice === 'sprints') {
      return jsonRes({ rows: [
        { sprint_id: 'SP', name: 'Спринт SP', status_raw: '🔄 IN PROGRESS' },
        { sprint_id: 'SQ', name: 'Спринт SQ', status_raw: '✅ DONE' },
      ] });
    }
    if (slice === 'tasks_of_sprints_batch') {
      return jsonRes({ rows: [task('SP', 'T1', '✅ DONE'), task('SP', 'T2', '📋 PLANNED'), task('SQ', 'T1', '✅ DONE')] });
    }
    return jsonRes({ rows: [task('SP', 'T1', '✅ DONE'), task('SP', 'T2', '📋 PLANNED')] });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('«Спринты» на ListScreen: паритет с SprintsPage', () => {
  it('колонка «Задачи» x/y догружается пачкой; закрытый спринт — в «Закрытые», и там тоже x/y', async () => {
    const f = fakeFetch();
    const { container } = render(<ListScreen screen="sprints" fetchImpl={f.fn} urlState={false} />);
    await waitFor(() => expect(container.querySelector('[data-record-id="SP"] [data-progress="ok"]')).toBeTruthy());
    expect(screen.getByRole('columnheader', { name: 'Задачи' })).toBeTruthy();
    expect(container.querySelector('[data-record-id="SP"] [data-progress]')!.textContent).toContain('1/2');
    expect(f.calls.some(u => u.pathname.endsWith('/tasks_of_sprints_batch'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Закрытые\s*1/ }));
    expect(container.querySelector('[data-record-id="SQ"] [data-progress="complete"]')!.textContent).toContain('1/1');
  });

  it('раскрытие строки — задачи первым блоком; статус задачи меняется за два касания', async () => {
    const f = fakeFetch();
    const { container } = render(<ListScreen screen="sprints" fetchImpl={f.fn} urlState={false} />);
    await screen.findAllByText('Спринт SP');
    fireEvent.click(screen.getByRole('button', { name: 'Раскрыть: Спринт SP' }));
    const xrow = container.querySelector('[data-expand-of="SP"] td') as HTMLElement;
    const list = await within(xrow).findByRole('list', { name: 'Задачи спринта SP' });
    expect(xrow.firstElementChild?.getAttribute('data-sprint-tasks')).toBe('SP');
    fireEvent.click(within(list).getAllByRole('button', { name: /^Статус: / })[1]);
    fireEvent.click(screen.getByRole('menuitem', { name: /В работе/ }));
    await waitFor(() => expect(f.calls.some(u => u.pathname === '/lore/status')).toBe(true));
  });

  it('то, чего у SprintsPage не было: «Быстро», доска и шапка экрана с видами', async () => {
    render(<ListScreen screen="sprints" fetchImpl={fakeFetch().fn} urlState={false} />);
    await screen.findAllByText('Спринт SP');
    expect(screen.getByRole('group', { name: 'Быстро' })).toBeTruthy();
    const head = screen.getByTestId('kit-screenhead');
    expect(within(within(head).getByRole('radiogroup')).getByRole('radio', { name: /Доска/ })).toBeTruthy();
  });
});
