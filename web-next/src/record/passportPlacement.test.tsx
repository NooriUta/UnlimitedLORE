// @vitest-environment jsdom
// MP2-11 (SPRINT_UXR_MOBILE_POLISH, владелица 13.11.2026): «паспорт не должен
// скакать… кнопку переключить не только в полный режим, но и вниз, вправо».
//
// Что держат тесты:
//   1. Кнопка смены места открывает меню из ТРЁХ мест контракта kit:
//      панелью справа, снизу, на весь экран (прежняя «⤢» умела только полный).
//   2. Выбор пишет место в адрес (?place=) явно — в том числе «право»:
//      снятый параметр вернулся бы к личной настройке, а не к выбору.
//   3. Адрес — одна правда о месте: повторное открытие той же записи по
//      адресу с place=bottom открывается снизу (место не «скачет»).
//   4. Обработчик экрана (onPlace) главнее адреса, если он задан.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import ListPassport from './ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const SPRINT = { sprint_id: 'S_A', name: 'Альфа', status_raw: '🔄 IN PROGRESS', planned_end_date: '2026-11-12', valid_from: '2026-11-08T00:00:00Z', context_md: 'текст' };

function fake() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const name = new URL(String(input), 'http://x').pathname.split('/').pop();
    if (name === 'sprints') return json({ rows: [SPRINT] });
    if (name === 'tasks_of_sprint') return json({ rows: [] });
    return json({ rows: [] });
  });
}

function winWith(search: string) {
  const history = { pushState: vi.fn(), replaceState: vi.fn() };
  const win: UrlWindow = { location: { pathname: '/lore', search, hash: '' }, history };
  return { win, history };
}

const openMenu = async () => {
  // Бар есть и при загрузке, но кнопка загрузки — ДРУГОЙ узел: после данных
  // дерево переключается с ветки загрузки на ветку чтения. Клик по узлу
  // загрузки ушёл бы в отсоединённый элемент, поэтому ждём саму запись.
  await screen.findByRole('heading', { level: 1, name: 'Альфа' }, { timeout: 8000 });
  const btn = screen.getByRole('button', { name: 'Где открыт' });
  fireEvent.click(btn);
  return screen.findByRole('menu', { name: 'Где открыт' });
};

describe('MP2-11 · смена места паспорта: право / низ / полный', () => {
  it('меню предлагает три места, выбранное отмечено', async () => {
    render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={fake() as unknown as typeof fetch} />);
    const menu = await openMenu();
    const opts = [...menu.querySelectorAll('[role=menuitemradio]')];
    expect(opts.map(o => o.textContent)).toEqual(['панелью справа', 'снизу', 'на весь экран']);
    expect(opts[1].getAttribute('aria-checked')).toBe('true');
    expect(opts[0].getAttribute('aria-checked')).toBe('false');
  });

  it('выбор места пишется в адрес явно, включая «право»', async () => {
    const { win, history } = winWith('?open=S_A&place=bottom');
    render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={fake() as unknown as typeof fetch} win={win} />);
    const menu = await openMenu();
    fireEvent.click([...menu.querySelectorAll('[role=menuitemradio]')][0]);
    await waitFor(() => expect(history.replaceState).toHaveBeenCalled());
    const calls = history.replaceState.mock.calls;
    const url = String(calls[calls.length - 1][2]);
    expect(url).toContain('place=right');
    expect(url).toContain('open=S_A');
  });

  it('место из адреса соблюдается: запись открыта снизу — меню отмечает «снизу»', async () => {
    const { win } = winWith('?open=S_A&place=bottom');
    render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={fake() as unknown as typeof fetch} win={win} />);
    const menu = await openMenu();
    const opts = [...menu.querySelectorAll('[role=menuitemradio]')];
    expect(opts[1].getAttribute('aria-checked')).toBe('true');
  });

  it('обработчик экрана главнее адреса', async () => {
    const onPlace = vi.fn();
    const { win, history } = winWith('?open=S_A');
    render(<ListPassport type="sprint" id="S_A" placement="right" fetchImpl={fake() as unknown as typeof fetch} win={win} onPlace={onPlace} />);
    const menu = await openMenu();
    fireEvent.click([...menu.querySelectorAll('[role=menuitemradio]')][2]);
    expect(onPlace).toHaveBeenCalledWith('full');
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
