// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-06 — массовые действия во вложенной таблице задач.
//
// Правило то же, что у списков, и та же функция (onScreenItems в
// listSelection.ts): в действие уходит только ПОКАЗАННОЕ. Хвост за «ещё N»
// на экране не стоит — «выбрать все показанные» его не берёт, а отмеченное
// вне показанного называется числом, а не уходит молча.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LIST_BUDGET, onScreenItems, TaskTable, type TaskPhase, type TaskRowData } from '../index';

const PER = LIST_BUDGET.perGroup;
const phases: TaskPhase[] = [{ uid: 'ph', id: 'P1', title: 'Фаза', order: 1 }];

function mk(n: number): TaskRowData[] {
  return Array.from({ length: n }, (_, i) => ({
    uid: `u${i}`, id: `T-${String(i).padStart(3, '0')}`, title: `Задача ${i}`, status: 'todo', phase: 'ph',
    effortDays: null, executor: null, reviewer: null, taskType: null, workClass: null, order: i,
  }));
}

describe('onScreenItems · одно правило «показанное» для всех таблиц', () => {
  const items = (p: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }));

  it('свёрнутая группа с шапкой не показана — её строк в наборе нет', () => {
    const got = onScreenItems([
      { key: 'a', items: items('a', 3), headed: true },
      { key: 'b', items: items('b', 2), headed: true },
    ], k => k !== 'a', () => 50);
    expect(got.map(x => x.id)).toEqual(['b0', 'b1']);
  });

  it('хвост за «ещё N» не показан: берётся только до потолка группы', () => {
    const got = onScreenItems([{ key: 'a', items: items('a', 7), headed: false }], () => true, () => 5);
    expect(got).toHaveLength(5);
  });

  it('подгруппы: свёрнутая подгруппа не показана, у каждой свой потолок', () => {
    const got = onScreenItems([{
      key: 'g', headed: true, items: [],
      sub: [
        { key: 'g/x', items: items('x', 4), headed: true },
        { key: 'g/y', items: items('y', 4), headed: true },
      ],
    }], k => k !== 'g/y', k => (k === 'g/x' ? 2 : 50));
    expect(got.map(x => x.id)).toEqual(['x0', 'x1']);
  });

  it('запись в двух группах на экране одна — и в наборе одна', () => {
    const got = onScreenItems([
      { key: 'a', items: [{ id: '1' }, { id: '2' }], headed: false },
      { key: 'b', items: [{ id: '2' }, { id: '3' }], headed: false },
    ], () => true, () => 50);
    expect(got.map(x => x.id)).toEqual(['1', '2', '3']);
  });
});

describe('TaskTable · выбор и смена статуса пачкой', () => {
  const props = (over: Partial<Parameters<typeof TaskTable>[0]> = {}) => ({
    tasks: mk(3), phases, groupBy: 'phase' as const, label: 'Задачи', ...over,
  });

  it('без обработчика пачки выбора нет вовсе — таблица прежняя', () => {
    render(<TaskTable {...props()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('с обработчиком у каждой строки — настоящий чекбокс; панель появляется после выбора', () => {
    render(<TaskTable {...props({ onBulkStatusChange: vi.fn() })} />);
    expect(screen.queryByRole('group', { name: 'Действия с выбранными' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: T-000' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: T-002' }));
    const bar = screen.getByRole('group', { name: 'Действия с выбранными' });
    expect(within(bar).getByText('Выбрано: 2')).toBeTruthy();
  });

  it('«выбрать все показанные» берёт только показанные строки, а не хвост за «ещё N»', () => {
    render(<TaskTable {...props({ tasks: mk(207), onBulkStatusChange: vi.fn() })} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: T-000' }));
    const bar = screen.getByRole('group', { name: 'Действия с выбранными' });
    fireEvent.click(within(bar).getByRole('button', { name: `Выбрать все показанные (${PER})` }));
    expect(within(bar).getByText(`Выбрано: ${PER}`)).toBeTruthy();
  });

  it('смена статуса уходит ровно на выбранные показанные задачи', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    render(<TaskTable {...props({ onBulkStatusChange: run })} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: T-001' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: T-002' }));
    const bar = screen.getByRole('group', { name: 'Действия с выбранными' });
    fireEvent.change(within(bar).getByRole('combobox', { name: 'Новый статус' }), { target: { value: 'done' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Сменить статус (2)' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][0].map((t: TaskRowData) => t.id)).toEqual(['T-001', 'T-002']);
    expect(run.mock.calls[0][1]).toBe('done');
  });

  it('статус не выбран — кнопка не жмётся, и причина сказана текстом', () => {
    const run = vi.fn();
    render(<TaskTable {...props({ onBulkStatusChange: run })} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: T-001' }));
    const bar = screen.getByRole('group', { name: 'Действия с выбранными' });
    const btn = within(bar).getByRole('button', { name: 'Сменить статус (1)' });
    fireEvent.click(btn);
    expect(run).not.toHaveBeenCalled();
    expect(within(bar).getByText('Выберите новый статус')).toBeTruthy();
  });

  it('отказ — причина в панели (role=alert), выбор сохраняется', async () => {
    const run = vi.fn().mockRejectedValue(new Error('не сменился у T-001'));
    render(<TaskTable {...props({ onBulkStatusChange: run })} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: T-001' }));
    const bar = screen.getByRole('group', { name: 'Действия с выбранными' });
    fireEvent.change(within(bar).getByRole('combobox', { name: 'Новый статус' }), { target: { value: 'done' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Сменить статус (1)' }));
    expect((await within(bar).findByRole('alert')).textContent).toMatch(/не сменился у T-001/);
    expect(within(bar).getByText('Выбрано: 1')).toBeTruthy();
  });

  it('отмеченное, ушедшее с экрана (смена группировки), названо числом и в действие не уходит', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const tasks = mk(PER + 5);
    const { rerender } = render(<TaskTable {...props({ tasks, groupBy: 'none', onBulkStatusChange: run })} />);
    fireEvent.click(screen.getByRole('button', { name: 'ещё 5' }));
    fireEvent.click(screen.getByRole('checkbox', { name: `Выбрать: T-0${PER + 2}` }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: T-000' }));
    // Переход на другой разрез сбрасывает раскрытие: T-052 снова за «ещё N».
    rerender(<TaskTable {...props({ tasks, groupBy: 'phase', onBulkStatusChange: run })} />);
    const bar = screen.getByRole('group', { name: 'Действия с выбранными' });
    expect(within(bar).getByText('Выбрано: 1')).toBeTruthy();
    expect(within(bar).getByText('отмечено вне показанного: 1')).toBeTruthy();
    fireEvent.change(within(bar).getByRole('combobox', { name: 'Новый статус' }), { target: { value: 'done' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Сменить статус (1)' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][0].map((t: TaskRowData) => t.id)).toEqual(['T-000']);
  });

  it('«Готово» снимает выбор и прячет панель', () => {
    render(<TaskTable {...props({ onBulkStatusChange: vi.fn() })} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: T-001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.queryByRole('group', { name: 'Действия с выбранными' })).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Выбрать: T-001' }) as HTMLInputElement).checked).toBe(false);
  });
});
