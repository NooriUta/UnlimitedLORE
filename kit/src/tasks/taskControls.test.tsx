// @vitest-environment jsdom
// Таблица задач со стандартной полосой управления
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-SPRINT-TASKS-CONTROLS, «и а и б» владелицы 11.11.2026).
//
// Правила:
//   • полоса — та же, что у списков (ControlBar): поиск, фасеты статус /
//     исполнитель / фаза, сегмент группировки, порядок;
//   • прежнее не теряется: группировка фаза / фаза+статус / статус / списком
//     (кнопки остаются, теперь в стандартном сегменте группы), выбор колонок,
//     правка в строке, массовый статус;
//   • массовый статус получает только ПОКАЗАННЫЕ задачи: отсеянное фильтром не
//     меняется молча.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons, TaskTable, type TaskPhase, type TaskRowData } from '../index';

beforeAll(() => { registerGameIcons(gameIcons); });

const phases: TaskPhase[] = [
  { uid: 'ph-1', id: 'P1', title: 'Разведка', order: 1 },
  { uid: 'ph-2', id: 'P2', title: 'Сборка', order: 2 },
];
const tasks: TaskRowData[] = [
  { uid: 'u1', id: 'S5-01', title: 'Паспорт спринта', status: 'active', phase: 'ph-1', effortDays: 2, executor: 'claude', reviewer: 'owner', taskType: null, workClass: null, order: 1 },
  { uid: 'u2', id: 'S5-02', title: 'Вкладка задач', status: 'todo', phase: 'ph-2', effortDays: 1.5, executor: null, reviewer: null, taskType: null, workClass: null, order: 2 },
  { uid: 'u3', id: 'S5-03', title: 'Готовое', status: 'done', phase: 'ph-2', effortDays: 3, executor: 'codex', reviewer: 'claude', taskType: null, workClass: null, order: 3 },
];

const ids = () => Array.from(document.querySelectorAll('tbody tr td')).map(td => td.textContent ?? '').filter(s => /^S5-0\d$/.test(s));

function show(over: Partial<Parameters<typeof TaskTable>[0]> = {}) {
  return render(
    <KitLangProvider lang="ru">
      <TaskTable tasks={tasks} phases={phases} groupBy="none" label="Задачи" controls onGroupByChange={() => {}} {...over} />
    </KitLangProvider>,
  );
}

describe('TaskTable · стандартная полоса управления', () => {
  it('без controls полосы нет — прежняя таблица не меняется', () => {
    render(<TaskTable tasks={tasks} phases={phases} groupBy="none" label="Задачи" />);
    expect(document.querySelector('.sk-list__controls')).toBeNull();
  });

  it('сегменты filter · group · sort; фасеты статус, исполнитель, фаза', () => {
    const { container } = show();
    expect(Array.from(container.querySelectorAll('fieldset.sk-list__seg')).map(f => (f as HTMLElement).dataset.seg)).toEqual(['filter', 'group', 'sort']);
    const filterSeg = container.querySelector('fieldset[data-seg="filter"]') as HTMLElement;
    expect(within(filterSeg).getByRole('searchbox')).toBeTruthy();
    for (const name of [/^Статус/, /^Исполнитель/, /^Фаза/]) expect(within(filterSeg).getByRole('button', { name })).toBeTruthy();
    // Прежние кнопки группировки — в стандартном сегменте группы.
    const groupSeg = container.querySelector('fieldset[data-seg="group"]') as HTMLElement;
    expect(within(groupSeg).getAllByRole('button').map(b => b.getAttribute('aria-pressed'))).toContain('true');
  });

  it('поиск по ID и названию сужает строки и говорит «Показано N из M»', () => {
    show();
    expect(ids()).toEqual(['S5-01', 'S5-02', 'S5-03']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Текст в ID или названии' }), { target: { value: 'вкладка' } });
    expect(ids()).toEqual(['S5-02']);
    expect(screen.getByText('Показано 1 из 3')).toBeTruthy();
  });

  it('фасет «Исполнитель»: значения со счётчиком, выбор сужает строки', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Исполнитель/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /codex/ }));
    expect(ids()).toEqual(['S5-03']);
  });

  it('порядок по оценке, по убыванию — внутри группы', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /Порядок: как пришло/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Оценка, д' }));
    expect(ids()).toEqual(['S5-02', 'S5-01', 'S5-03']);
    fireEvent.click(screen.getByRole('button', { name: 'по убыванию' }));
    expect(ids()).toEqual(['S5-03', 'S5-01', 'S5-02']);
  });

  it('под фильтр ничего не подошло — сказано словами, а не пустой таблицей', () => {
    show();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Текст в ID или названии' }), { target: { value: 'нет-такого' } });
    expect(screen.getByText('Под фильтр ничего не подошло')).toBeTruthy();
  });

  it('правка в строке и массовый статус на месте; пачка — только показанные', async () => {
    const run = vi.fn(async () => {});
    show({ onSave: async () => {}, onBulkStatusChange: run, onStatusChange: async () => {} });
    expect(screen.getByRole('button', { name: 'Править S5-01' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Текст в ID или названии' }), { target: { value: 'S5-0' } });
    // выбрать все показанные, затем сузить поиск — в пачку идёт только видимое
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать: S5-01' }));
    fireEvent.click(screen.getByRole('button', { name: /Выбрать все показанные/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Текст в ID или названии' }), { target: { value: 'готовое' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Новый статус' }), { target: { value: 'done' } });
    fireEvent.click(screen.getByRole('button', { name: /Сменить статус/ }));
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect((run.mock.calls[0] as unknown as [TaskRowData[]])[0].map(t => t.id)).toEqual(['S5-03']);
  });
});
