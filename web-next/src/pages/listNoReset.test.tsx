// @vitest-environment jsdom
// SPRINT_UXR_S13_KIT4/K4-PASSPORT-NO-LIST-RESET: открыть запись в разделе — меняется только паспорт.
// Список (ListView kit) остаётся тем же узлом: выделение, раскрытые группы и прокрутка на месте,
// а данные списка заново не грузятся. Правило одно на все разделы — раскладка ListWithRecord kit.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { ListScreen } from './ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function win(search: string): UrlWindow {
  const w = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_: unknown, __: string, url: string) => { w.location.search = url.slice(url.indexOf('?')).split('#')[0]; },
      replaceState: (_: unknown, __: string, url: string) => { w.location.search = url.slice(url.indexOf('?')).split('#')[0]; },
    },
  };
  return w as unknown as UrlWindow;
}

const ROWS = { rows: [
  { task_uid: 'S1/T-1', task_id: 'T-1', title: 'Первая задача', status_raw: '🔄 IN PROGRESS', sprint_id: 'S1' },
  { task_uid: 'S1/T-2', task_id: 'T-2', title: 'Вторая задача', status_raw: '🔄 IN PROGRESS', sprint_id: 'S1' },
  { task_uid: 'S1/T-3', task_id: 'T-3', title: 'Третья задача', status_raw: '🔄 IN PROGRESS', sprint_id: 'S1' },
] };

function net() {
  const lists: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lore.test');
    if (url.pathname === '/lore/slice/open_tasks' || url.pathname === '/lore/slice/closed_tasks') {
      lists.push(url.pathname);
      return json(ROWS);
    }
    if (url.pathname.startsWith('/lore/record/')) return json({ error: 'NOT_FOUND' }, 404);
    return json({ rows: [] });
  }) as unknown as typeof fetch;
  return { fn, lists };
}

describe('K4-PASSPORT-NO-LIST-RESET · ListScreen', () => {
  it('открыть 3 записи подряд и закрыть — узел списка тот же (метка на месте), запросов списка ноль', async () => {
    const { fn, lists } = net();
    render(<ListScreen screen="tasks" fetchImpl={fn} urlState={win('')} />);
    await screen.findByText('Первая задача', {}, { timeout: 5000 });
    const listNode = document.querySelector('.sk-list') as HTMLElement;
    expect(listNode).toBeTruthy();
    const loaded = lists.length;
    // метка на узле: пересозданный список её не несёт (а с ней — выделение, раскрытия, прокрутку)
    listNode.dataset.k4probe = '1';
    for (const title of ['Первая задача', 'Вторая задача', 'Третья задача']) {
      fireEvent.click(screen.getAllByRole('button', { name: title })[0]);
      await waitFor(() => expect(document.querySelector('[data-testid="kit-rec-dock"]')).toBeTruthy());
      expect(document.querySelector('.sk-list'), title).toBe(listNode);
      expect((document.querySelector('.sk-list') as HTMLElement).dataset.k4probe, title).toBe('1');
    }
    fireEvent.keyDown(document, { key: 'Escape' }); // закрыть паспорт
    await waitFor(() => expect(document.querySelector('[data-testid="kit-rec-dock"]')).toBeNull());
    expect(document.querySelector('.sk-list')).toBe(listNode);
    expect(lists.length - loaded).toBe(0);
  });
});
