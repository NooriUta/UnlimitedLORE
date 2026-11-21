// @vitest-environment jsdom
// Графики НИКОГДА не стоят над содержимым (владелица 21.11.2026, снимок «Релизов» на препроде: над списком висел
// «Ритм релизов»; «что опять делает тут график? у нас же должна быть вкладка аналитика или völva»). В паспорте это
// сделал #1687 (вкладка «Графики» в «Аналитике»); здесь — экраны списков: графики раздела — отдельным видом
// «Аналитика» в переключателе видов (рядом со Список · Карточки · Лента · Таймлайн · Календарь), выбор — в адресе
// (lav=analytics, как у вида Völva). Нет графиков у раздела — нет и вида.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { ListScreen } from '../pages/ListScreen';
import { LIST_SCREENS, type ListScreenId } from './screens';
import { SECTION_CHARTS } from '../charts/sectionCharts';

beforeAll(() => { registerGameIcons(gameIcons); });

const here = dirname(fileURLToPath(import.meta.url));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function win(search: string) {
  const calls: string[] = [];
  const w = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_: unknown, __: string, url: string) => { calls.push(url); w.location.search = new URL(url, 'http://x').search; },
      replaceState: (_: unknown, __: string, url: string) => { calls.push(url); w.location.search = new URL(url, 'http://x').search; },
    },
  };
  return { w: w as unknown as UrlWindow, calls };
}

const RELEASES = { rows: [{ release_uid: 'P#v1', release_id: 'v1', release_date: '2026-11-11', changed_at: '2026-11-12T00:00:00Z' }], truncated: false };

function net(rows: unknown) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lore.test');
    if (url.pathname.endsWith('/_new')) return json({ perms: { can_create: false } });
    if (url.pathname.startsWith('/lore/record/')) return json({ error: 'NOT_FOUND' }, 404);
    if (url.pathname.startsWith('/lore/slice/') && !url.pathname.endsWith('/facets')) return json(rows);
    return json({ rows: [] });
  });
  return fn as unknown as typeof fetch;
}

/** Графики на экране: обёртка вкладки, блоки графиков LORE и элементы kit. */
const chartsIn = (root: Element) => root.querySelectorAll('.sk-rec-charts, [data-testid="kit-chart"], .sk-chart, [data-testid$="-charts"], .an-block');

describe('графики на экране списка — только видом «Аналитика», не над списком', () => {
  it('«Релизы» в виде «Список»: графиков нет; вид «Аналитика» в переключателе их показывает и пишет lav=analytics', async () => {
    const { w, calls } = win('');
    const { container } = render(<ListScreen screen="releases" fetchImpl={net(RELEASES)} urlState={w} />);
    const views = await screen.findByRole('radiogroup', { name: /Вид/ });
    expect(chartsIn(container).length, 'в виде «Список» графиков нет').toBe(0);
    fireEvent.click(within(views).getByRole('radio', { name: 'Аналитика' }));
    await waitFor(() => expect(container.querySelector('.sk-rec-charts')).not.toBeNull());
    expect(container.querySelector('.sk-rec-charts [data-testid="releases-charts"]'), 'ритм релизов — во виде «Аналитика»').not.toBeNull();
    await waitFor(() => expect(calls.some(u => /[?&]lav=analytics/.test(u))).toBe(true));
  });

  it('вид из адреса: ?lav=analytics открывает «Аналитику» сразу', async () => {
    const { w } = win('?lav=analytics');
    const { container } = render(<ListScreen screen="releases" fetchImpl={net(RELEASES)} urlState={w} />);
    await waitFor(() => expect(container.querySelector('.sk-rec-charts')).not.toBeNull());
  });

  it('у раздела без графиков вида «Аналитика» нет', async () => {
    const { w } = win('');
    render(<ListScreen screen="components" fetchImpl={net({ rows: [{ component_id: 'LORE' }], truncated: false })} urlState={w} />);
    const views = await screen.findByRole('radiogroup', { name: /Вид/ });
    expect(within(views).queryByRole('radio', { name: 'Аналитика' })).toBeNull();
  });

  it('реестр графиков разделов — только существующие разделы списков', () => {
    const ids = Object.keys(LIST_SCREENS) as ListScreenId[];
    for (const k of Object.keys(SECTION_CHARTS)) expect(ids, k).toContain(k);
    expect(Object.keys(SECTION_CHARTS)).toContain('releases');
  });

  it('сторож: экран списка не рисует блоки графиков сам — только через вид «Аналитика» (SECTION_CHARTS)', () => {
    const src = readFileSync(resolve(here, '../pages/ListScreen.tsx'), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(src.match(/<[A-Z]\w*Charts\b/g) ?? [], 'блоки *Charts прямо в разметке экрана списка').toEqual([]);
  });
});
