// @vitest-environment jsdom
// «Задачи x/y» вехи доходят ДО ЭКРАНА списка (SPRINT_UXR_POLISH_UAT_1113/PU-27).
// Разбор проверен в milestoneList.test.ts; здесь — что экран отдаёт загрузчику
// записи (спринты вехи) и число рисуется в строке вехи.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { ListScreen } from '../pages/ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const tot = (id: string, done: number, of: number) => ({
  sprint_id: id, state: 'ok',
  tasks_total: { value: of, known: of, of, done },
  effort_days_total: { value: null, known: 0, of },
  actual_days_total: { value: null, known: 0, of },
});

function fakeWin(): UrlWindow {
  return { location: { pathname: '/', search: '', hash: '' }, history: { pushState: () => {}, replaceState: () => {} } } as unknown as UrlWindow;
}

describe('PU-27 · прогресс вехи на экране списка', () => {
  it('строка вехи показывает сумму x/y по её спринтам', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://lore.test');
      if (url.pathname.endsWith('/sprint_totals')) {
        const ids = (url.searchParams.get('sprint_ids') ?? '').split(',');
        const all: Record<string, [number, number]> = { S1: [3, 5], S2: [1, 4] };
        return json({ rows: ids.map(id => tot(id, ...all[id])), inputs_truncated: false });
      }
      if (url.pathname.endsWith('/milestones')) {
        return json({ rows: [{ milestone_id: 'M1', label: 'Веха один', direct_sprint_ids: ['S1', 'S2', null], products: [], changed_at: '2026-11-13T00:00:00Z' }] });
      }
      return json({ rows: [] });
    }) as unknown as typeof fetch;
    const { container } = render(<ListScreen screen="milestones" fetchImpl={fetchImpl} urlState={fakeWin()} />);
    await waitFor(() => expect(container.querySelector('[data-record-id="M1"] [data-progress]')?.textContent ?? '').toContain('4/9'), { timeout: 8000 });
  }, 15000);
});
