// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-07 — спринт на 200+ задач.
//
// Решение (kit-сессия по поручению владелицы, 10.11.2026: 1а 2а 3а):
//   1а — потолок «50 на группу · ещё N» (LIST_BUDGET.perGroup, то же правило,
//        что у списков), а НЕ виртуализация: при виртуализации Ctrl+F браузера
//        не находит строк вне DOM, и человек решает «такой задачи нет».
//        Обрезка обязана быть сказана числом в КАЖДОЙ группе.
//   2а — четвёртая группировка «Фаза → статус», умолчание остаётся «Фаза».
//   3а — порядок фаз берётся из order_index; под кривые данные не подгоняем.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  groupTasks, LIST_BUDGET, TASK_GROUP_BYS, TaskTable, type TaskPhase, type TaskRowData,
} from '../index';

const PER = LIST_BUDGET.perGroup;

function mk(n: number, phase: string | null, status: (i: number) => string = () => 'todo', from = 0): TaskRowData[] {
  return Array.from({ length: n }, (_, k) => {
    const i = from + k;
    return {
      uid: `u${i}`, id: `T-${String(i).padStart(3, '0')}`, title: `Задача ${i}`, status: status(i), phase,
      effortDays: null, executor: null, reviewer: null, taskType: null, workClass: null, order: i,
    };
  });
}

const rowsIn = (el: HTMLElement) => el.querySelectorAll('tr[data-task]').length;

describe('S9-07 · потолок строк на группу', () => {
  const phases: TaskPhase[] = [{ uid: 'ph-a', id: 'A', title: 'Большая', order: 1 }];
  const big = mk(207, 'ph-a');

  it('группа из 207 задач рисует не больше perGroup строк, а не все 207', () => {
    const { container } = render(<TaskTable tasks={big} phases={phases} groupBy="phase" label="Задачи" />);
    expect(rowsIn(container)).toBe(PER);
  });

  it('обрезка сказана числом в группе: «Показаны 50 из 207» и кнопка «ещё 157»', () => {
    const { container } = render(<TaskTable tasks={big} phases={phases} groupBy="phase" label="Задачи" />);
    const group = container.querySelector('tbody[data-group="phase"]') as HTMLElement;
    expect(within(group).getByText(`Показаны ${PER} из 207`)).toBeTruthy();
    expect(within(group).getByRole('button', { name: `ещё ${207 - PER}` })).toBeTruthy();
    // Заголовок группы по-прежнему называет ПОЛНОЕ число, а не показанное.
    expect(group.querySelector('.sk-tasks__gcount')?.textContent).toBe('207');
  });

  it('«ещё N» кликабельно и добавляет следующий шаг, пока не покажет всё', () => {
    const { container } = render(<TaskTable tasks={big} phases={phases} groupBy="phase" label="Задачи" />);
    fireEvent.click(screen.getByRole('button', { name: `ещё ${207 - PER}` }));
    expect(rowsIn(container)).toBe(2 * PER);
    fireEvent.click(screen.getByRole('button', { name: `ещё ${207 - 2 * PER}` }));
    fireEvent.click(screen.getByRole('button', { name: `ещё ${207 - 3 * PER}` }));
    fireEvent.click(screen.getByRole('button', { name: `ещё ${207 - 4 * PER}` }));
    expect(rowsIn(container)).toBe(207);
    // Всё показано — ни оговорки, ни кнопки: пустая оговорка приучает её не читать.
    expect(screen.queryByText(/^Показаны \d+ из \d+$/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^ещё \d+$/ })).toBeNull();
  });

  it('потолок действует и без группировки («Списком»)', () => {
    const { container } = render(<TaskTable tasks={big} phases={phases} groupBy="none" label="Задачи" />);
    expect(rowsIn(container)).toBe(PER);
    expect(screen.getByText(`Показаны ${PER} из 207`)).toBeTruthy();
  });

  it('у каждой группы своя обрезка и своё число, а не одна на всю таблицу', () => {
    const two: TaskPhase[] = [...phases, { uid: 'ph-b', id: 'B', title: 'Вторая', order: 2 }];
    const tasks = [...mk(60, 'ph-a'), ...mk(80, 'ph-b', () => 'todo', 60)];
    const { container } = render(<TaskTable tasks={tasks} phases={two} groupBy="phase" label="Задачи" />);
    expect(rowsIn(container)).toBe(2 * PER);
    expect(screen.getByText(`Показаны ${PER} из 60`)).toBeTruthy();
    expect(screen.getByText(`Показаны ${PER} из 80`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ещё 10' }));
    // Раскрыта одна группа — вторая осталась обрезанной.
    expect(rowsIn(container)).toBe(60 + PER);
    expect(screen.getByText(`Показаны ${PER} из 80`)).toBeTruthy();
  });

  it('положительный контроль: группа не больше потолка — ни оговорки, ни кнопки', () => {
    const { container } = render(<TaskTable tasks={mk(PER, 'ph-a')} phases={phases} groupBy="phase" label="Задачи" />);
    expect(rowsIn(container)).toBe(PER);
    expect(screen.queryByText(/^Показаны/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^ещё/ })).toBeNull();
  });
});

describe('S9-07 · группировка «Фаза → статус»', () => {
  const phases: TaskPhase[] = [
    { uid: 'ph-1', id: 'P1', title: 'Разведка', order: 1 },
    { uid: 'ph-2', id: 'P2', title: 'Сборка', order: 2 },
  ];
  const tasks = [
    ...mk(3, 'ph-1', i => (i === 0 ? 'done' : 'active')),
    ...mk(2, 'ph-2', () => 'todo', 3),
  ];

  it('есть четвёртый разрез, умолчание приложения не меняется — «Фаза» по-прежнему первая', () => {
    expect(TASK_GROUP_BYS).toContain('phase_status');
    expect(TASK_GROUP_BYS[0]).toBe('phase');
  });

  it('модель: группы — фазы по порядку, внутри каждой — статусы', () => {
    const g = groupTasks(tasks, 'phase_status', phases);
    expect(g.map(x => x.key)).toEqual(['ph-1', 'ph-2']);
    expect(g[0].tasks).toHaveLength(3);
    expect(g[0].subgroups?.map(s => s.category)).toEqual(['active', 'done']);
    expect(g[0].subgroups?.map(s => s.tasks.length)).toEqual([2, 1]);
    expect(g[1].subgroups?.map(s => s.category)).toEqual(['backlog']); // todo → категория backlog (statusMeta)
  });

  it('таблица рисует шапку фазы и подшапки статусов внутри неё; колонки «Фаза» нет', () => {
    const { container } = render(<TaskTable tasks={tasks} phases={phases} groupBy="phase_status" label="Задачи" />);
    const p1 = container.querySelector('tbody[data-group="phase"]') as HTMLElement;
    const heads = [...p1.querySelectorAll('th[scope="rowgroup"]')].map(h => h.firstElementChild?.textContent);
    expect(heads).toEqual(['P1 · Разведка', 'В работе', 'Готово']);
    expect(screen.queryByRole('columnheader', { name: 'Фаза' })).toBeNull();
    expect(rowsIn(container)).toBe(5);
  });

  it('потолок действует на подгруппу статуса, и число сказано в ней', () => {
    const many = mk(70, 'ph-1', i => (i < 60 ? 'active' : 'done'));
    const { container } = render(<TaskTable tasks={many} phases={phases} groupBy="phase_status" label="Задачи" />);
    expect(rowsIn(container)).toBe(PER + 10);
    expect(screen.getByText(`Показаны ${PER} из 60`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ещё 10' })).toBeTruthy();
  });

  it('переключатель предлагает «Фаза → статус»', () => {
    const on = vi.fn();
    render(<TaskTable tasks={tasks} phases={phases} groupBy="phase" onGroupByChange={on} label="Задачи" />);
    fireEvent.click(screen.getByRole('button', { name: 'Фаза → статус' }));
    expect(on).toHaveBeenCalledWith('phase_status');
  });
});

describe('S9-07 · порядок фаз — по order_index, а не по коду и не по порядку прихода', () => {
  it('фазы, пришедшие как C, D, A, B, рисуются по order_index', () => {
    const phases: TaskPhase[] = [
      { uid: 'c', id: 'C', title: null, order: 3 },
      { uid: 'd', id: 'D', title: null, order: 4 },
      { uid: 'a', id: 'A', title: null, order: 1 },
      { uid: 'b', id: 'B', title: null, order: 2 },
    ];
    const tasks = ['c', 'd', 'a', 'b'].flatMap((p, k) => mk(1, p, () => 'todo', k));
    expect(groupTasks(tasks, 'phase', phases).map(g => g.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(groupTasks(tasks, 'phase_status', phases).map(g => g.label)).toEqual(['A', 'B', 'C', 'D']);
  });
});
