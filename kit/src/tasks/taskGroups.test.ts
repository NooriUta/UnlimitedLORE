// SPRINT_UXR_S5_RECORD_TASKS/S5-02 — группировка задач спринта: по фазе, по
// статусу (категории жизненного цикла) или одним списком. Чистая функция:
// экран и таблица получают готовые группы, порядок не зависит от порядка ответа.
import { describe, expect, it } from 'vitest';
import { groupTasks, TASK_STATUSES, validateTaskDraft, type TaskPhase, type TaskRowData } from './taskGroups';

const phases: TaskPhase[] = [
  { uid: 'ph-2', id: 'P2', title: 'Сборка', order: 2 },
  { uid: 'ph-1', id: 'P1', title: 'Разведка', order: 1 },
  { uid: 'ph-3', id: 'P3', title: 'Пустая', order: 3 },
];

function task(id: string, over: Partial<TaskRowData> = {}): TaskRowData {
  return {
    uid: `u-${id}`, id, title: `Задача ${id}`, status: 'todo', phase: null,
    effortDays: null, executor: null, reviewer: null, taskType: null, workClass: null, order: 0, ...over,
  };
}

describe('groupTasks · по фазе', () => {
  const tasks = [
    task('T3', { phase: 'ph-2', order: 2 }),
    task('T1', { phase: 'ph-1', order: 5 }),
    task('T2', { phase: 'ph-2', order: 1 }),
    task('T4', { phase: null, order: 0 }),
    task('T5', { phase: 'ph-gone', order: 0 }),
  ];

  it('фазы — в порядке order_index, задачи внутри — по order', () => {
    const g = groupTasks(tasks, 'phase', phases);
    expect(g.map(x => x.key)).toEqual(['ph-1', 'ph-2', 'nophase', 'orphan']);
    expect(g[1].tasks.map(t => t.id)).toEqual(['T2', 'T3']);
    expect(g[0].label).toBe('P1 · Разведка');
  });

  it('пустая фаза не рисуется группой, но задачи без фазы и с пропавшей фазой не теряются', () => {
    const g = groupTasks(tasks, 'phase', phases);
    expect(g.find(x => x.key === 'ph-3')).toBeUndefined();
    expect(g.find(x => x.key === 'nophase')?.tasks.map(t => t.id)).toEqual(['T4']);
    // Фаза, которой нет в списке фаз, — сбой данных, его видно отдельной группой.
    expect(g.find(x => x.key === 'orphan')?.kind).toBe('orphan');
    expect(g.find(x => x.key === 'orphan')?.tasks.map(t => t.id)).toEqual(['T5']);
  });

  it('все задачи на месте (сумма групп = вход)', () => {
    const g = groupTasks(tasks, 'phase', phases);
    expect(g.reduce((n, x) => n + x.tasks.length, 0)).toBe(tasks.length);
  });
});

describe('groupTasks · по статусу', () => {
  it('категории — в порядке жизненного цикла, неизвестный статус — последней группой', () => {
    const g = groupTasks([
      task('A', { status: 'done' }),
      task('B', { status: 'in_progress' }),
      task('C', { status: 'todo' }),
      task('D', { status: 'weird' }),
      task('E', { status: 'blocked' }),
    ], 'status', phases);
    expect(g.map(x => x.key)).toEqual(['backlog', 'active', 'done', 'blocked', 'unknown']);
    expect(g.every(x => x.kind === 'status')).toBe(true);
  });
});

describe('groupTasks · без группировки', () => {
  it('один список по order', () => {
    const g = groupTasks([task('B', { order: 2 }), task('A', { order: 1 })], 'none', phases);
    expect(g).toHaveLength(1);
    expect(g[0].kind).toBe('all');
    expect(g[0].tasks.map(t => t.id)).toEqual(['A', 'B']);
  });

  it('ноль задач — ноль групп (пустоту рисует экран, а не пустая шапка группы)', () => {
    expect(groupTasks([], 'none', phases)).toEqual([]);
    expect(groupTasks([], 'phase', phases)).toEqual([]);
  });
});

describe('TASK_STATUSES — набор статусов задачи для палитры', () => {
  it('тот же, что пишет POST /lore/status для задачи (v1 TASK_PICK_TOKENS)', () => {
    expect([...TASK_STATUSES]).toEqual(['todo', 'planned', 'active', 'partial', 'ready_for_deploy', 'uat', 'done', 'blocked', 'cancelled']);
  });
});

describe('validateTaskDraft — правка в строке', () => {
  const base = task('T1', { title: 'Было', effortDays: 1 });

  it('без изменений — пустой патч', () => {
    expect(validateTaskDraft(base, { title: 'Было', effort: '1' }))
      .toEqual({ ok: true, patch: {} });
  });

  it('в патч идут только изменённые поля; оценка — число, запятая как точка; ролей в патче нет (PU-17)', () => {
    expect(validateTaskDraft(base, { title: ' Стало ', effort: '1,5' }))
      .toEqual({ ok: true, patch: { title: 'Стало', effortDays: 1.5 } });
  });

  it('пустой заголовок — отказ (бэкенд требует title)', () => {
    expect(validateTaskDraft(base, { title: '  ', effort: '1' }))
      .toEqual({ ok: false, field: 'title' });
  });

  it('оценка не число или отрицательная — отказ', () => {
    expect(validateTaskDraft(base, { title: 'Было', effort: 'abc' }))
      .toEqual({ ok: false, field: 'effort' });
    expect(validateTaskDraft(base, { title: 'Было', effort: '-1' }))
      .toEqual({ ok: false, field: 'effort' });
  });

  it('стереть оценку нельзя (бэкенд читает null как «не трогать») — честный отказ, а не молчаливый no-op', () => {
    expect(validateTaskDraft(base, { title: 'Было', effort: '' }))
      .toEqual({ ok: false, field: 'effort' });
  });

  it('пустое поле, которое и было пустым, — не изменение', () => {
    const blank = task('T2', { title: 'X' });
    expect(validateTaskDraft(blank, { title: 'X', effort: '' }))
      .toEqual({ ok: true, patch: {} });
  });
});
