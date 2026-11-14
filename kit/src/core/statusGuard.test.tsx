// @vitest-environment jsdom
// S4-18 (решение владелицы 14.11.2026, фидбек «можно нечаянно тыкнуть и что-то не туда утащить»):
// защита от случайной смены статуса. По умолчанию — смена сразу и 8 секунд «Вернуть» с видимым
// остатком; личная настройка «подтверждать» — сначала вопрос, без «да» ничего не пишется.
// «Статус в 2 касания» (п. 27) по умолчанию не ломается: подтверждение — только по настройке.
//
// Только поддельные часы: реальное время под нагрузкой не подмешивается, отсчёт детерминирован
// (под полным прогоном вариант с shouldAdvanceTime давал «7 с» вместо «8 с»).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../index';
import type { KitConfig, KitRecord } from './contract';
import { StatusChip } from './index';
import { TaskTable } from '../tasks/TaskTable';
import type { TaskRowData } from '../tasks/taskGroups';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Прокрутить отложенные промисы (save, onStatusChange) без хода часов. */
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

const statuses = (over: Partial<KitConfig['statuses']> = {}): KitConfig['statuses'] => ({
  items: [
    { code: 'todo', title: 'К работе', category: 'todo', icon: 'checkbox-tree', color: '--t3' },
    { code: 'active', title: 'В работе', category: 'active', icon: 'progression', color: 'acc' },
  ],
  undo: true,
  ...over,
});
const cfg = (over: Partial<KitConfig['statuses']> = {}): KitConfig => ({ modules: [], menu: { groups: [] }, kinds: {}, statuses: statuses(over) });
const rec = (status = 'todo'): KitRecord => ({ id: 'T-1', kind: 'task', title: 'Задача', status, fields: {} });

const pickActive = () => {
  fireEvent.click(screen.getByRole('button', { name: /Статус: К работе/ }));
  fireEvent.keyDown(screen.getByRole('menu'), { code: 'Digit1', key: '1' });
};

describe('S4-18 · чип статуса', () => {
  it('по умолчанию: смена сразу, «Вернуть» с видимым остатком 8 с; через 8 с кнопки нет', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<StatusChip record={rec()} config={cfg()} save={save} />);
    pickActive();
    expect(save).toHaveBeenCalledTimes(1);
    await flush();
    const undo = screen.getByRole('button', { name: /Вернуть «К работе»/ });
    expect(undo.textContent).toMatch(/8\s*с/);
    await act(async () => { vi.advanceTimersByTime(3100); });
    expect(screen.getByRole('button', { name: /Вернуть/ }).textContent).toMatch(/[45]\s*с/);
    await act(async () => { vi.advanceTimersByTime(5100); });
    expect(screen.queryByRole('button', { name: /Вернуть/ })).toBeNull();
  });

  it('«Вернуть» в окне — обратный переход записан', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<StatusChip record={rec()} config={cfg()} save={save} />);
    pickActive();
    await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Вернуть/ })); });
    expect(save).toHaveBeenLastCalledWith({ type: 'status', id: 'T-1', field: 'status', from: 'active', to: 'todo' });
  });

  it('настройка «подтверждать»: без «Сменить» ничего не пишется; «Отмена» — статус прежний', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<StatusChip record={rec()} config={cfg({ confirmChange: true })} save={save} />);
    pickActive();
    expect(save).not.toHaveBeenCalled();
    const ask = screen.getByRole('group', { name: /Сменить статус/ });
    expect(ask.textContent).toMatch(/К работе.*В работе/);
    fireEvent.click(within(ask).getByRole('button', { name: 'Отмена' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Статус: К работе/ })).toBeTruthy();
  });

  it('настройка «подтверждать»: «Сменить» записывает переход', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<StatusChip record={rec()} config={cfg({ confirmChange: true })} save={save} />);
    pickActive();
    await act(async () => { fireEvent.click(within(screen.getByRole('group', { name: /Сменить статус/ })).getByRole('button', { name: 'Сменить' })); });
    expect(save).toHaveBeenCalledWith({ type: 'status', id: 'T-1', field: 'status', from: 'todo', to: 'active' });
  });
});

describe('S4-18 · строка таблицы задач', () => {
  const task = (status = 'todo'): TaskRowData => ({ uid: 'S/T-1', id: 'T-1', title: 'Задача', status, order: 1, phase: null } as unknown as TaskRowData);
  const pickRow = async (name: RegExp) => {
    fireEvent.click(screen.getByRole('button', { name: /Статус: к работе/i }));
    await flush();
    fireEvent.click(screen.getByRole('menuitemradio', { name }));
    await flush();
  };

  it('по умолчанию: после смены — «Вернуть» с остатком 8 с; нажатие возвращает прежний статус', async () => {
    const onStatusChange = vi.fn(async () => {});
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" onStatusChange={onStatusChange} label="Задачи" />);
    await pickRow(/В работе/i);
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-1' }), 'active');
    const undo = screen.getByRole('button', { name: /Вернуть/ });
    expect(undo.textContent).toMatch(/8\s*с/);
    await act(async () => { fireEvent.click(undo); });
    await flush();
    expect(onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'T-1' }), 'todo');
  });

  it('statusGuard.confirm: без «Сменить» вызова нет', async () => {
    const onStatusChange = vi.fn(async () => {});
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" onStatusChange={onStatusChange} label="Задачи" statusGuard={{ confirm: true }} />);
    await pickRow(/В работе/i);
    expect(onStatusChange).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(screen.getByRole('group', { name: /Сменить статус/ })).getByRole('button', { name: 'Сменить' })); });
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-1' }), 'active');
  });
});
