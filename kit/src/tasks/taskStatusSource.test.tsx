// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG — таблица задач берёт
// статусы из конфигурации.
//
// Находка, из которой выросла задача: в kit было ДВА источника статусов.
// Конфигурация (`config.statuses`) — тот, который наполняет модель; и
// захардкоженный `TASK_STATUSES` в `taskGroups.ts`, который питал меню смены
// статуса и подписи. Таблица читала второй. Значит, когда модель начнёт
// отдавать статусы, в паспорте они поедут, а в таблице останутся прежними —
// и расхождение будет молчаливым, потому что ничего не упадёт.
//
// Поэтому: есть конфигурация — читаем её; нет — прежний список как умолчание.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import { TaskTable } from './TaskTable';
import type { TaskRowData, TaskPhase } from './taskGroups';
import type { KitConfig } from '../core/contract';

beforeAll(() => { registerGameIcons(gameIcons); });

const PHASES: TaskPhase[] = [];
const task = (over: Partial<TaskRowData> = {}): TaskRowData => ({
  uid: 'u1', id: 'T-1', title: 'Задача', status: 'active', phase: null,
  effortDays: null, executor: null, reviewer: null, taskType: null, workClass: null, order: 1, ...over,
});

/** Статусы из модели: своя ось категорий и свой набор кодов. */
const STATUSES: KitConfig['statuses']['items'] = [
  { code: 'draft', title: 'Черновик', category: 'not_started', icon: 'scroll-quill', color: 'var(--t3)' },
  { code: 'active', title: 'В работе', category: 'in_progress', icon: 'progression', color: 'var(--inf)', allow: ['in_force', 'shelved'] },
  { code: 'in_force', title: 'Действует', category: 'in_force', icon: 'laurel-crown', color: 'var(--suc)' },
  { code: 'shelved', title: 'Отложено', category: 'withdrawn', icon: 'cancel', color: 'var(--wrn)' },
];

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /Статус/i }));

describe('S4-STATUS-AXIS-CONFIG · источник статусов', () => {
  it('без конфигурации — прежний список: умолчание сохранено', () => {
    render(<TaskTable tasks={[task()]} phases={PHASES} groupBy="none" label="З" onStatusChange={vi.fn()} />);
    openMenu();
    const menu = screen.getByRole('menu');
    // Точное имя: в умолчании есть и «Готово», и «Готово к выкатке».
    expect(within(menu).getByRole('menuitemradio', { name: 'Готово' })).toBeTruthy();
    // «Действует» в умолчании нет — его приносит только модель.
    expect(within(menu).queryByRole('menuitemradio', { name: /Действует/ })).toBeNull();
  });

  it('с конфигурацией — пункты из неё, в её порядке', () => {
    render(<TaskTable tasks={[task({ status: 'draft' })]} phases={PHASES} groupBy="none" label="З" statuses={STATUSES} onStatusChange={vi.fn()} />);
    openMenu();
    const items = within(screen.getByRole('menu')).getAllByRole('menuitemradio').map(i => i.textContent);
    expect(items).toEqual(['Черновик', 'В работе', 'Действует', 'Отложено']);
  });

  it('«Действует» доезжает до таблицы — именно его теряла прежняя ось', () => {
    render(<TaskTable tasks={[task({ status: 'in_force' })]} phases={PHASES} groupBy="none" label="З" statuses={STATUSES} onStatusChange={vi.fn()} />);
    openMenu();
    expect(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Действует' })).toBeTruthy();
  });

  it('allow ограничивает переходы: предлагаем только разрешённые сервером', () => {
    render(<TaskTable tasks={[task({ status: 'active' })]} phases={PHASES} groupBy="none" label="З" statuses={STATUSES} onStatusChange={vi.fn()} />);
    openMenu();
    const items = within(screen.getByRole('menu')).getAllByRole('menuitemradio').map(i => i.textContent);
    // Текущий статус остаётся в списке (он отмечен), остальные — по allow.
    expect(items).toEqual(['В работе', 'Действует', 'Отложено']);
  });

  it('allow не задан — предлагаем все: запрет не выдумываем', () => {
    render(<TaskTable tasks={[task({ status: 'draft' })]} phases={PHASES} groupBy="none" label="З" statuses={STATUSES} onStatusChange={vi.fn()} />);
    openMenu();
    expect(within(screen.getByRole('menu')).getAllByRole('menuitemradio')).toHaveLength(4);
  });

  it('статус записи, которого нет в конфигурации, не прячется', () => {
    render(<TaskTable tasks={[task({ status: 'сюрприз' })]} phases={PHASES} groupBy="none" label="З" statuses={STATUSES} onStatusChange={vi.fn()} />);
    openMenu();
    const items = within(screen.getByRole('menu')).getAllByRole('menuitemradio').map(i => i.textContent);
    // Он виден как есть: сбой данных должен быть заметен, а не исчезать.
    expect(items.some(t => t?.includes('сюрприз'))).toBe(true);
  });

  it('выбор пункта отдаёт код статуса наружу', async () => {
    const onStatusChange = vi.fn(async () => {});
    render(<TaskTable tasks={[task({ status: 'draft' })]} phases={PHASES} groupBy="none" label="З" statuses={STATUSES} onStatusChange={onStatusChange} />);
    openMenu();
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Действует' }));
    expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({ uid: 'u1' }), 'in_force');
  });
});
