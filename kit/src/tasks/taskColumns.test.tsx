// @vitest-environment jsdom
// Замечание владелицы по v1.17.4: «задачи в паспорте спринта — общей таблицей
// с колонками S4-35… наши любимые общие колонки».
//
// Колонки строки задачи уже как в v1 (S4-36): статус, тип, класс, код,
// название, оценка, исполнитель, рецензент. Чего не было — выбора колонок: в
// списках он есть с S4-35 (ColumnsChoice, набор в адресе, личная ширина), а в
// таблице задач набор был зашит.
//
// Что закрепляется:
//   • набор колонок задаётся снаружи, в порядке показа; не задан — прежний
//     полный набор, чтобы паритет с v1 не пропал молча;
//   • «Название» снять нельзя: таблица без записи бессмысленна (то же правило,
//     что у «Записи» в списках);
//   • незнакомая колонка из адреса не ломает таблицу и не показывает пустой
//     столбец — она отбрасывается;
//   • при группировке по фазе колонка «Фаза» недоступна: фаза уже в заголовке
//     группы, второй раз это шум;
//   • правка в строке и смена статуса работают при любом наборе колонок —
//     иначе выбор колонок отбирал бы возможности.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../index';
import { TASK_COLUMNS, TaskTable } from './TaskTable';
import type { TaskRowData } from './taskGroups';

beforeAll(() => { registerGameIcons(gameIcons); });

const task = (over: Partial<TaskRowData> = {}): TaskRowData => ({
  uid: 'SP/T1', id: 'T1', title: 'Задача T1', status: 'active', phase: null,
  effortDays: 1, executor: 'Клод', reviewer: 'владелица', taskType: 'dev', workClass: 'enb',
  order: 1, ...over,
});

const heads = () => within(screen.getByRole('table')).getAllByRole('columnheader').map(th => th.textContent?.trim());

describe('набор колонок таблицы задач', () => {
  it('положительный контроль: без набора — прежние колонки v1', () => {
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" label="Задачи" />);
    expect(heads()).toEqual(['Статус', 'Тип', 'Класс', 'ID', 'Задача', 'Фаза', 'Оценка, д', 'Исполнитель', 'Ревьюер']);
  });

  it('набор задан — показаны только эти колонки и в этом порядке', () => {
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" label="Задачи" columns={['id', 'title', 'status']} />);
    expect(heads()).toEqual(['ID', 'Задача', 'Статус']);
  });

  it('«Задача» (название) не снять: таблица без записи бессмысленна', () => {
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" label="Задачи" columns={['id', 'status']} />);
    expect(heads()).toContain('Задача');
    expect(TASK_COLUMNS.find(c => c.key === 'title')?.locked).toBe(true);
  });

  it('незнакомая колонка отбрасывается, а не рисует пустой столбец', () => {
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" label="Задачи" columns={['id', 'выдумка', 'title']} />);
    expect(heads()).toEqual(['ID', 'Задача']);
  });

  it('при группировке по фазе колонки «Фаза» нет — она в заголовке группы', () => {
    render(<TaskTable tasks={[task({ phase: 'P1' })]} phases={[{ uid: 'P1', id: 'P1', title: 'Разведка', order: 1 }]} groupBy="phase" label="Задачи" />);
    expect(heads()).not.toContain('Фаза');
  });

  it('ячейки встают в порядок колонок, а не в свой прежний', () => {
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" label="Задачи" columns={['title', 'id']} />);
    const cells = within(screen.getByRole('table')).getAllByRole('cell').map(td => td.textContent?.trim());
    // Группировки нет, значит в строке ровно две ячейки — и в заданном порядке.
    expect(cells).toEqual(['Задача T1', 'T1']);
  });

  it('правка в строке работает при усечённом наборе колонок', () => {
    const onSave = vi.fn(async () => {});
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" label="Задачи" columns={['id', 'title']} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /Править T1/ }));
    expect(screen.getByLabelText('Задача')).toBeTruthy();
  });

  it('смена статуса работает, даже если колонки «Статус» в наборе нет', () => {
    const onStatusChange = vi.fn(async () => {});
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" label="Задачи" columns={['id', 'title', 'status']} onStatusChange={onStatusChange} />);
    expect(screen.getByRole('button', { name: /Статус/ })).toBeTruthy();
  });
});

describe('выбор колонок — тот же, что у списков', () => {
  it('обработчик передан — в полосе есть выбор колонок', () => {
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" label="Задачи"
      columns={['id', 'title']} onColumnsChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Колонки/ })).toBeTruthy();
  });

  it('обработчика нет — выбора нет: показывать то, чем нельзя управлять, незачем', () => {
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" label="Задачи" />);
    expect(screen.queryByRole('button', { name: /Колонки/ })).toBeNull();
  });

  it('включение колонки отдаётся наружу в порядке типа, а не в порядке нажатий', () => {
    const onColumnsChange = vi.fn();
    render(<TaskTable tasks={[task()]} phases={[]} groupBy="none" label="Задачи"
      columns={['id', 'title']} onColumnsChange={onColumnsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Колонки/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Статус' }));
    expect(onColumnsChange).toHaveBeenCalledWith(['status', 'id', 'title']);
  });
});
