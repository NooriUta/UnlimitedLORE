// @vitest-environment jsdom
// Раздел «Задачи»: закрытые скрыты ФИЛЬТРОМ ПО УМОЛЧАНИЮ, а не жёстко срезом.
//
// Слово владелицы 11.11.2026: «показаны открытые задачи: закрытые и отменённые
// этот срез не отдаёт — в срезе задачи нарушает возможность открыть нужную.
// Ставь фильтр по умолчанию, а не жёсткий хардкод; при переходе на задачу вне
// фильтра — снимать».
//
// Было: раздел читал только `open_tasks`, режим «Закрытые» в «Вид» ничего не
// менял (закрытых в выдаче не было), а задача, открытая по ссылке, если она
// закрыта, в списке не находилась никак.
//
// Стало (правило общее для раздела со вторым срезом закрытых, `closedSlice`):
//   • умолчание — режим «скрыть»: грузится только открытое, как раньше (быстро);
//   • режим показывает закрытые (below / all / days30) — догружается срез
//     закрытых (`closed_tasks`, та же лёгкая проекция) и сливается с открытыми;
//   • открыта запись, которой нет в загруженном, при скрытых закрытых — фильтр
//     снимается сам (режим «внизу»), и запись находится.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { LIST_SCREENS } from './screens';
import { CLOSED_HIDDEN_NOTE } from './records';
import { ListScreen } from '../pages/ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function win(search: string): UrlWindow & { pushed: string[] } {
  const w = {
    pushed: [] as string[],
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_: unknown, __: string, url: string) => { w.pushed.push(url); w.location.search = url.slice(url.indexOf('?')); },
      replaceState: (_: unknown, __: string, url: string) => { w.pushed.push(url); w.location.search = url.slice(url.indexOf('?')); },
    },
  };
  return w as unknown as UrlWindow & { pushed: string[] };
}

const OPEN = { rows: [{ task_uid: 'S1/T-1', task_id: 'T-1', title: 'Открытая задача', status_raw: '🔄 IN PROGRESS', sprint_id: 'S1' }] };
const CLOSED = { rows: [{ task_uid: 'S1/T-9', task_id: 'T-9', title: 'Закрытая задача', status_raw: '✅ DONE', sprint_id: 'S1' }] };

function net() {
  const paths: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lore.test');
    paths.push(url.pathname);
    if (url.pathname === '/lore/slice/open_tasks') return json(OPEN);
    if (url.pathname === '/lore/slice/closed_tasks') return json(CLOSED);
    if (url.pathname.startsWith('/lore/record/')) return json({ error: 'NOT_FOUND' }, 404);
    return json({ rows: [] });
  }) as unknown as typeof fetch;
  return { fn, paths };
}

describe('Задачи · закрытые — фильтр по умолчанию, а не срез', () => {
  it('раздел знает срез закрытых, умолчание режима — «скрыть»', () => {
    expect(LIST_SCREENS.tasks.closedSlice).toBe('closed_tasks');
    expect(LIST_SCREENS.tasks.config('ru').list?.showClosed).toBe('hide');
  });

  it('по умолчанию грузятся только открытые, и сказано: закрытые скрыты фильтром', async () => {
    const { fn, paths } = net();
    render(<ListScreen screen="tasks" fetchImpl={fn} urlState={win('')} />);
    expect(await screen.findByText('Открытая задача')).toBeTruthy();
    expect(paths).toContain('/lore/slice/open_tasks');
    expect(paths).not.toContain('/lore/slice/closed_tasks');
    expect(screen.getByText(CLOSED_HIDDEN_NOTE)).toBeTruthy();
    expect(screen.queryByText(/этот срез не отдаёт/)).toBeNull();
  });

  it('режим показывает закрытые (lc=all) — догружается срез закрытых, записи слиты', async () => {
    const { fn, paths } = net();
    render(<ListScreen screen="tasks" fetchImpl={fn} urlState={win('?lc=all')} />);
    expect(await screen.findByText('Закрытая задача')).toBeTruthy();
    expect(screen.getByText('Открытая задача')).toBeTruthy();
    expect(paths).toContain('/lore/slice/closed_tasks');
    expect(screen.queryByText(CLOSED_HIDDEN_NOTE)).toBeNull();
  });

  it('открыта задача вне фильтра — фильтр снимается сам, срез закрытых догружен', async () => {
    const { fn, paths } = net();
    const w = win('?open=S1%2FT-9');
    render(<ListScreen screen="tasks" fetchImpl={fn} urlState={w} />);
    await waitFor(() => expect(paths).toContain('/lore/slice/closed_tasks'));
    await waitFor(() => expect(w.location.search).toMatch(/lc=below/));
  });

  it('открыта задача, которая и так видна, — фильтр не трогаем', async () => {
    const { fn, paths } = net();
    const w = win('?open=S1%2FT-1');
    render(<ListScreen screen="tasks" fetchImpl={fn} urlState={w} />);
    await waitFor(() => expect(paths).toContain('/lore/slice/open_tasks'));
    await new Promise(r => setTimeout(r, 50));
    expect(paths).not.toContain('/lore/slice/closed_tasks');
    expect(w.location.search).not.toMatch(/lc=/);
  });
});
