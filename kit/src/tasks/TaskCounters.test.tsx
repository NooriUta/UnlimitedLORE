// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-36 — счётчики в шапке спринта, как в v1:
// сколько задач в каком статусе, сколько закрыто из скольких и сумма оценок
// (эталон — скрин владелицы 08.11.2026: ряд значков со счётчиками, «6/12 Σ 7д»).
//
// Считаем по тем задачам, что уже загружены для таблицы: второй запрос ради
// цифр в шапке означал бы, что шапка и таблица могут разойтись между собой.
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { registerGameIcons } from '../index';
import { TaskCounters } from './TaskCounters';
import type { TaskRowData } from './taskGroups';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const task = (id: string, over: Partial<TaskRowData> = {}): TaskRowData => ({
  uid: `u-${id}`, id, title: id, status: 'todo', phase: null,
  effortDays: null, executor: null, reviewer: null, taskType: null, workClass: null, order: 0, ...over,
});

const TASKS: TaskRowData[] = [
  task('A', { status: 'done', effortDays: 2 }),
  task('B', { status: 'done', effortDays: 1 }),
  task('C', { status: 'active', effortDays: 1.5 }),
  task('D', { status: 'todo' }),
  task('E', { status: 'todo' }),
];

describe('S4-36 · счётчики в шапке спринта', () => {
  it('«закрыто из всего» считается по категории статуса, а не по коду', () => {
    render(<TaskCounters tasks={TASKS} />);
    expect(screen.getByTestId('tc-progress').textContent).toBe('2/5');
  });

  it('сумма оценок — по тем задачам, у кого оценка есть', () => {
    render(<TaskCounters tasks={TASKS} />);
    // В русской локали дробная часть через запятую — «4,5», и это правильно.
    expect(screen.getByTestId('tc-effort').textContent).toMatch(/4[.,]5/);
  });

  it('у каждого встреченного статуса свой счётчик с читаемым именем', () => {
    render(<TaskCounters tasks={TASKS} />);
    const group = screen.getByTestId('tc-statuses');
    const items = within(group).getAllByRole('img');
    // Три разных статуса в выборке — три значка, не больше.
    expect(items).toHaveLength(3);
    expect(within(group).getByTitle(/Готово.*2/)).toBeTruthy();
  });

  it('статусов, которых в выборке нет, в шапке нет: ноль не рисуем', () => {
    render(<TaskCounters tasks={TASKS} />);
    const group = screen.getByTestId('tc-statuses');
    expect(within(group).queryByTitle(/Отменено/)).toBeNull();
  });

  it('пустой список — шапка молчит, а не показывает 0/0', () => {
    const { container } = render(<TaskCounters tasks={[]} />);
    expect(container.querySelector('[data-testid="tc-progress"]')).toBeNull();
  });

  it('оценок нет ни у кого — сумма не показывается, это не ноль дней', () => {
    render(<TaskCounters tasks={[task('X'), task('Y')]} />);
    expect(screen.queryByTestId('tc-effort')).toBeNull();
    expect(screen.getByTestId('tc-progress').textContent).toBe('0/2');
  });

  it('доступность: нарушений axe нет', async () => {
    const { container } = render(<TaskCounters tasks={TASKS} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
