// Паспорт спринта писал «Задач нет», хотя задачи есть (владелица 09.11.2026,
// после v1.17.5: «в разделе спринтов раскрытие пишет „задач нет“, а они есть;
// и в паспорте спринта аналогично»).
//
// Корень: с v1.17.5 паспорт идёт с серверного фасада /lore/record (#963), а
// сервер отдаёт задачи спринта связью PART_OF, направление «in» (задача →
// спринт; LoreRecordRegistry, часть "tasks"). Вердикт паспорта искал связь
// HAS_TASK «out» — так её называла прежняя эмуляция из срезов. Ни одного
// совпадения — и проверенный ноль «Задач нет» вместо «задачи x/y».
//
// Сервер задачи отдавал всё это время (tasks_of_sprint на проде — 16 задач у
// SPRINT_UXR_S7B_ADMIN): ломалось на клиенте, между ответом и экраном.
import { describe, expect, it } from 'vitest';
import { recordFacts, type KitCtx } from '@seidr/kit';
import { fromLoreRecord, type LoreRecord1 } from './loreRecordContract';

const sprint = (links: LoreRecord1['links'], facade: 'server' | 'client-emulated' = 'server'): LoreRecord1 => ({
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SPRINT_X', title: 'Спринт', status: 'active', version: null, updated_at: null, updated_by: null },
  schema: { type: 'sprint', label: 'Спринт', icon: 'sprint', fields: [], tabs: [], relations: [] },
  values: { title: 'Спринт', planned_end_date: null },
  links,
  facts: { tasks: { done: 1, total: 2 }, due: null },
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  meta: { loaded_at: '2026-11-09T00:00:00.000Z', facade, sources: [] },
});

function tasksOf(c: LoreRecord1) {
  const load = fromLoreRecord(c, 'ru');
  expect(load.facts).toBeDefined();
  const ctx = { data: load.data, config: load.config } as unknown as KitCtx;
  return recordFacts(load.record, ctx, load.facts!).tasks;
}

describe('паспорт спринта: задачи с серверного фасада', () => {
  it('сервер отдаёт задачи связью PART_OF «in» — вердикт видит их, а не «Задач нет»', () => {
    const t = tasksOf(sprint([
      { rel: 'PART_OF', dir: 'in', id: 'SPRINT_X/X-1', type: 'task', title: 'Первая', status: 'done' },
      { rel: 'PART_OF', dir: 'in', id: 'SPRINT_X/X-2', type: 'task', title: 'Вторая', status: 'in_progress' },
    ]));
    expect(t?.state).toBe('ok');
    expect(t).toMatchObject({ total: 2, done: 1 });
  });

  it('прежняя форма (HAS_TASK «out», эмуляция из срезов) по-прежнему работает', () => {
    const t = tasksOf(sprint([
      { rel: 'HAS_TASK', dir: 'out', id: 'SPRINT_X/X-1', type: 'task', title: 'Первая', status: 'todo' },
    ], 'client-emulated'));
    expect(t).toMatchObject({ state: 'ok', total: 1 });
  });

  it('PART_OF к НЕ задаче (спринт в вехе и т.п.) задачами не считается', () => {
    const t = tasksOf(sprint([
      { rel: 'PART_OF', dir: 'out', id: 'MILESTONE_1', type: 'milestone', title: 'Веха', status: 'active' },
    ]));
    expect(t?.state).toBe('none');
  });

  it('у спринта правда нет задач — честное «Задач нет»', () => {
    expect(tasksOf(sprint([]))?.state).toBe('none');
  });
});
