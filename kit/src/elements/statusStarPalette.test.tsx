// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-07 — статус-звезда (D-2026-UXR-STATUS-AXIS):
// статусы по категориям в порядке жизненного цикла, палитра в 2 касания
// (звезда → пункт), для завершающих статусов — третий шаг (подтверждение).
// Запись — через onPick вызывающего (существующий API), от оболочки не зависит.
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import {
  StatusStar, groupStatusesByLifecycle, isFinalStatus, isFinalCategory, registerGameIcons, sortStatusesByLifecycle,
} from '../index';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const TITLES: Record<string, string> = {
  todo: 'К работе', planned: 'Запланировано', active: 'В работе', done: 'Готово', cancelled: 'Отменено', blocked: 'Заблокировано',
};
const titleOf = (c: string) => TITLES[c] ?? c;
const OPTIONS = ['done', 'active', 'todo', 'cancelled', 'planned', 'blocked'];

describe('порядок жизненного цикла и завершающие статусы', () => {
  it('сортировка: по категориям цикла, внутри — по таблице; неизвестные — в конце', () => {
    expect(sortStatusesByLifecycle(['done', 'weird', 'todo', 'cancelled', 'active', 'blocked', 'planned', 'review_x', 'in_progress']))
      .toEqual(['todo', 'planned', 'active', 'in_progress', 'done', 'blocked', 'cancelled', 'review_x', 'weird']);
  });

  it('регистр и дубли не ломают порядок', () => {
    expect(sortStatusesByLifecycle(['DONE', 'todo', 'done'])).toEqual(['todo', 'DONE']);
  });

  it('группы — категории цикла по порядку, пустые пропущены', () => {
    expect(groupStatusesByLifecycle(['cancelled', 'done', 'todo', 'fixed'])).toEqual([
      { category: 'backlog', codes: ['todo'] },
      { category: 'done', codes: ['done', 'fixed'] },
      { category: 'closed', codes: ['cancelled'] },
    ]);
  });

  it('завершающие — категории done/closed (и cancelled контракта K-05); blocked и unknown — нет', () => {
    expect(['done', 'accepted', 'cancelled', 'rejected', 'superseded'].every(isFinalStatus)).toBe(true);
    expect(['todo', 'active', 'blocked', 'weird', ''].some(isFinalStatus)).toBe(false);
    expect(isFinalCategory('cancelled')).toBe(true);
    expect(isFinalCategory('active')).toBe(false);
  });
});

function renderStar(onPick = vi.fn(), status = 'todo') {
  const utils = render(<StatusStar status={status} options={OPTIONS} titleOf={titleOf} onPick={onPick} showLabel />);
  return { ...utils, onPick, star: () => screen.getByRole('button', { name: /^Статус:/ }) };
}

describe('StatusStar — палитра «2 касания»', () => {
  it('касание 1 открывает меню: группы по циклу, текущий статус не предлагается', async () => {
    const { star, container } = renderStar();
    expect(star().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(star());
    expect(star().getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Сменить статус' });
    expect(within(menu).getAllByRole('group').map(g => g.getAttribute('aria-label')))
      .toEqual(['Планы', 'В работе', 'Готово', 'Блокеры', 'Закрыто']);
    expect(within(menu).getAllByRole('menuitem').map(b => b.getAttribute('data-status')))
      .toEqual(['planned', 'active', 'done', 'blocked', 'cancelled']);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('касание 2 по обычному статусу — сразу запись через onPick и закрытие', async () => {
    const { star, onPick } = renderStar();
    fireEvent.click(star());
    fireEvent.click(screen.getByRole('menuitem', { name: /В работе/ }));
    expect(onPick).toHaveBeenCalledWith('active', 'todo');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(star().getAttribute('data-status')).toBe('active');
    expect(star().getAttribute('aria-label')).toBe('Статус: В работе');
    expect(document.activeElement).toBe(star());
  });

  it('клавиша 1…9 — тот же второй шаг (по e.code, в любой раскладке)', () => {
    const { star, onPick } = renderStar();
    fireEvent.click(star());
    fireEvent.keyDown(screen.getByRole('menu'), { code: 'Digit2', key: '"' });
    expect(onPick).toHaveBeenCalledWith('active', 'todo');
  });

  it('завершающий статус требует третьего шага: подтверждение, только потом запись', async () => {
    const { star, onPick, container } = renderStar();
    fireEvent.click(star());
    const done = screen.getByRole('menuitem', { name: /Готово/ });
    expect(done.getAttribute('data-final')).toBe('true');
    fireEvent.click(done);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    const confirm = screen.getByRole('button', { name: 'Поставить «Готово»' });
    expect(document.activeElement).toBe(confirm);
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(confirm);
    expect(onPick).toHaveBeenCalledWith('done', 'todo');
    await waitFor(() => expect(star().getAttribute('data-status')).toBe('done'));
  });

  it('в подтверждении «Назад» и Esc возвращают к меню, без записи; Esc в меню — закрывает', () => {
    const { star, onPick } = renderStar();
    fireEvent.click(star());
    fireEvent.click(screen.getByRole('menuitem', { name: /Отменено/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement?.getAttribute('data-status')).toBe('cancelled');
    fireEvent.keyDown(screen.getByRole('menu'), { code: 'Digit5', key: '5' });
    expect(screen.getByRole('button', { name: 'Поставить «Отменено»' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Поставить «Отменено»' }), { code: 'Escape', key: 'Escape' });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { code: 'Escape', key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(star());
  });

  it('отказ записи — статус возвращается, причина видна (role=alert)', async () => {
    const onPick = vi.fn().mockRejectedValue(new Error('403 нет прав'));
    const { star } = renderStar(onPick);
    fireEvent.click(star());
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /В работе/ }));
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/403 нет прав/));
    expect(star().getAttribute('data-status')).toBe('todo');
  });

  it('без onPick и onOpen — по-прежнему только показ (role=img)', () => {
    render(<StatusStar status="done" label="Статус: готово" />);
    expect(screen.getByRole('img', { name: 'Статус: готово' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
