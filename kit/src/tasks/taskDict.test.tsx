// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-36 — строка задачи как в v1: тип задачи
// иконкой, класс работы плашкой, оба из словаря LORE (`dictionary`).
// Вариант выбран владелицей 08.11.2026: «плашка как раньше» — то есть
// вариант A прототипа docs/prototypes/s4-36-task-row.html, как в v1.
//
// Правило S4-25: иконки и цвета берём из словаря, своих не придумываем.
// Значение, которого в словаре нет, показываем честно — исходным кодом с
// прямой подписью, а не пустым местом и не выдуманной иконкой.
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { axeViolations } from '../test/axe';
import { registerGameIcons } from '../index';
import { TaskTable } from './TaskTable';
import type { TaskRowData, TaskPhase } from './taskGroups';
import type { KitDictItem } from '../core/contract';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const PHASES: TaskPhase[] = [{ uid: 'ph-1', id: 'P1', title: 'Разведка', order: 1 }];

const TASKS: TaskRowData[] = [
  { uid: 'u1', id: 'PL-01', title: 'Тестовая база', status: 'active', phase: 'ph-1', effortDays: 1.5, executor: 'claude', reviewer: 'owner', taskType: 'dev', workClass: 'enb', order: 1 },
  { uid: 'u2', id: 'PL-10', title: 'Препрод без root', status: 'todo', phase: 'ph-1', effortDays: null, executor: null, reviewer: null, taskType: 'migration', workClass: 'ops-x', order: 2 },
  { uid: 'u3', id: 'PL-11', title: 'Без типа и класса', status: 'todo', phase: 'ph-1', effortDays: null, executor: null, reviewer: null, taskType: null, workClass: null, order: 3 },
];

const DICT: { taskType: KitDictItem[]; workClass: KitDictItem[] } = {
  taskType: [{ code: 'dev', title: 'Разработка', icon: 'wrench', color: 'var(--acc)' }],
  workClass: [{ code: 'enb', title: 'Enabler', color: 'var(--inf)' }],
};

const row = (code: string) => screen.getByText(code).closest('tr')!;

describe('S4-36 · тип и класс работы из словаря', () => {
  it('тип задачи — иконка из словаря с именем, а не слово', () => {
    render(<TaskTable tasks={TASKS} phases={PHASES} groupBy="none" dict={DICT} label="Задачи" />);
    const icon = within(row('PL-01')).getByRole('img', { name: 'Разработка' });
    expect(icon).toBeTruthy();
    // Слово «dev» в строке больше не печатается — его заменила иконка.
    expect(within(row('PL-01')).queryByText('dev')).toBeNull();
  });

  it('класс работы — плашка кодом в верхнем регистре, цвет из словаря', () => {
    render(<TaskTable tasks={TASKS} phases={PHASES} groupBy="none" dict={DICT} label="Задачи" />);
    const cls = within(row('PL-01')).getByTitle('Enabler');
    expect(cls.textContent).toBe('ENB');
    expect(cls.getAttribute('style')).toContain('var(--inf)');
  });

  it('значения вне словаря показаны честно: исходный код и прямая подпись', () => {
    render(<TaskTable tasks={TASKS} phases={PHASES} groupBy="none" dict={DICT} label="Задачи" />);
    const r = row('PL-10');
    // Тип: иконки нет — показываем сам код, а не пустое место.
    const type = within(r).getByTitle('migration · нет в словаре');
    expect(type.textContent).toBe('migration');
    // Класс: плашка пунктиром с исходным кодом.
    const cls = within(r).getByTitle('ops-x · нет в словаре');
    expect(cls.textContent).toBe('OPS-X');
    expect(cls.className).toMatch(/sk-tasks__cls--unknown/);
  });

  it('пустые тип и класс — прочерк, а не «нет в словаре»: это разные вещи', () => {
    render(<TaskTable tasks={TASKS} phases={PHASES} groupBy="none" dict={DICT} label="Задачи" />);
    const r = row('PL-11');
    expect(within(r).queryByText(/нет в словаре/)).toBeNull();
    expect(r.querySelector('.sk-tasks__td--type')?.textContent).toBe('—');
    expect(r.querySelector('.sk-tasks__td--cls')?.textContent).toBe('—');
  });

  it('словарь есть, но значения в нём нет — это не то же самое, что словаря нет', () => {
    // Без словаря мы не вправе судить, «вне» значение или нет, и молчим.
    const { container } = render(<TaskTable tasks={TASKS} phases={PHASES} groupBy="none" label="Задачи" />);
    expect(container.querySelector('.sk-tasks__cls--unknown')).toBeNull();
    expect(within(row('PL-10')).queryByText(/нет в словаре/)).toBeNull();
  });

  it('словаря нет вовсе — строка не падает и показывает исходные значения', () => {
    render(<TaskTable tasks={TASKS} phases={PHASES} groupBy="none" label="Задачи" />);
    expect(within(row('PL-01')).getByText('dev')).toBeTruthy();
    expect(within(row('PL-01')).getByText('ENB')).toBeTruthy();
  });

  it('порядок колонок как в v1: статус, тип, класс, код, задача', () => {
    render(<TaskTable tasks={TASKS} phases={PHASES} groupBy="none" dict={DICT} label="Задачи" />);
    const heads = screen.getAllByRole('columnheader').map(h => h.textContent);
    expect(heads.slice(0, 5)).toEqual(['Статус', 'Тип', 'Класс', 'ID', 'Задача']);
  });

  it('доступность: нарушений axe нет', async () => {
    const { container } = render(<TaskTable tasks={TASKS} phases={PHASES} groupBy="none" dict={DICT} label="Задачи" />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
