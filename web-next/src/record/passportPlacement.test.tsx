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
  // MP2-14-PLACE-LEFT (владелица 13.11: «если задано… влево — значит он открывается именно там»): мест четыре.
  it('меню предлагает четыре места, выбранное отмечено', async () => {
    render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={fake() as unknown as typeof fetch} />);
    const menu = await openMenu();
    const opts = [...menu.querySelectorAll('[role=menuitemradio]')];
    expect(opts.map(o => o.textContent)).toEqual(['панелью слева', 'панелью справа', 'снизу', 'на весь экран']);
    expect(opts[2].getAttribute('aria-checked')).toBe('true');
    expect(opts[1].getAttribute('aria-checked')).toBe('false');
  });

  it('выбор места пишется в адрес явно, включая «право»', async () => {
    const { win, history } = winWith('?open=S_A&place=bottom');
    render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={fake() as unknown as typeof fetch} win={win} />);
    const menu = await openMenu();
    fireEvent.click([...menu.querySelectorAll('[role=menuitemradio]')][1]);
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
    expect(opts[2].getAttribute('aria-checked')).toBe('true');
  });

  it('обработчик экрана главнее адреса', async () => {
    const onPlace = vi.fn();
    const { win, history } = winWith('?open=S_A');
    render(<ListPassport type="sprint" id="S_A" placement="right" fetchImpl={fake() as unknown as typeof fetch} win={win} onPlace={onPlace} />);
    const menu = await openMenu();
    fireEvent.click([...menu.querySelectorAll('[role=menuitemradio]')][3]);
    expect(onPlace).toHaveBeenCalledWith('full');
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});

describe('MP2-14 · место «слева»', () => {
  it('выбор «панелью слева» пишется в адрес place=left', async () => {
    const { win, history } = winWith('?open=S_A&place=bottom');
    render(<ListPassport type="sprint" id="S_A" placement="bottom" fetchImpl={fake() as unknown as typeof fetch} win={win} />);
    const menu = await openMenu();
    fireEvent.click([...menu.querySelectorAll('[role=menuitemradio]')][0]);
    await waitFor(() => expect(history.replaceState).toHaveBeenCalled());
    const calls = history.replaceState.mock.calls;
    expect(String(calls[calls.length - 1][2])).toContain('place=left');
  });
});

// MP2-11, доработки владелицы 13.11: «кнопка раздвинуть должна раздвигать, а не показывать меню;
// нужно меню — делай ещё одну кнопку» и «если в полный экран выходили справа, то и возвращаться
// должно справа, а не вниз».
describe('MP2-11 · ⤢ раздвигает сразу, меню мест — отдельной кнопкой', () => {
  it('⤢ одним нажатием — на весь экран, меню не открывается', async () => {
    const onPlace = vi.fn();
    const { win } = winWith('?open=S_A');
    render(<ListPassport type="sprint" id="S_A" placement="right" fetchImpl={fake() as unknown as typeof fetch} win={win} onPlace={onPlace} />);
    await screen.findByRole('heading', { level: 1, name: 'Альфа' }, { timeout: 8000 });
    fireEvent.click(screen.getByRole('button', { name: 'Во весь экран' }));
    expect(onPlace).toHaveBeenCalledWith('full');
    expect(screen.queryByRole('menu', { name: 'Где открыт' })).toBeNull();
  });

  it('во весь экран ⤢ возвращает туда, откуда вошли', async () => {
    const onPlace = vi.fn();
    const { win } = winWith('?open=S_A&place=full');
    render(<ListPassport type="sprint" id="S_A" placement="full" backPlace="left" fetchImpl={fake() as unknown as typeof fetch} win={win} onPlace={onPlace} />);
    await screen.findByRole('heading', { level: 1, name: 'Альфа' }, { timeout: 8000 });
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть на место' }));
    expect(onPlace).toHaveBeenCalledWith('left');
  });
});

// Владелица 14.11.2026 (скрин «98 из 244»): «опять две строки… оставь кнопку свернуть/развернуть, а
// крестик поставь за меню — и строка станет одной». «×» — в строке записи сразу после ☰.
describe('строка записи: «×» после ☰, одна строка', () => {
  it('во весь экран: ⤢, ☰, × — подряд в одной строке, отдельной «Выйти из полного экрана» нет', async () => {
    const onClose = vi.fn();
    const { win } = winWith('?place=full');
    render(<ListPassport type="sprint" id="S_A" placement="full" fetchImpl={fake() as unknown as typeof fetch} win={win} onClose={onClose} />);
    await screen.findByRole('heading', { level: 1, name: 'Альфа' }, { timeout: 8000 });
    const menu = screen.getByRole('button', { name: 'Где открыт' });
    const close = screen.getByRole('button', { name: 'Закрыть паспорт' });
    expect(close.closest('.sk-rec-reader__tools')).toBe(menu.closest('.sk-rec-reader__tools'));
    expect(close.closest('.sk-rec-reader__tools')).toBeTruthy();
    expect(menu.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: /полного экрана/ })).toBeNull();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
