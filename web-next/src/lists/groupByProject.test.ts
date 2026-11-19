// Владелица 19.11.2026: «в задачках … добавь группировку по проекту и везде где есть проект делай группировку по
// проекту правило если проектов несколько в каждую группу механика универсальная для всех объектов связанных многие
// ко многим». Правило на все экраны: есть поле-ссылка на проект → есть разрез по проекту. Запись в нескольких
// проектах попадает в каждую группу — это общий механизм kit (grouping.ts), отдельной логики экрану не нужно.
import { describe, expect, it } from 'vitest';
import { LIST_SCREENS } from './screens';
import { taskListRecord } from './records';

describe('группировка по проекту — везде, где у записи есть проект', () => {
  it('раздел «Задачи»: у задачи есть поле проекта', () => {
    const c = LIST_SCREENS.tasks.config('ru');
    expect((c.kinds.task?.fields ?? []).some(f => f.key === 'project' && f.type === 'ref')).toBe(true);
    const r = taskListRecord({ task_uid: 'S/T-1', project_slugs: ['A/x', 'B/y'] } as Parameters<typeof taskListRecord>[0]);
    expect(r.fields.project).toEqual(['A/x', 'B/y']);
  });
  for (const [id, s] of Object.entries(LIST_SCREENS)) {
    it(`${id}: поле проекта → разрез по проекту`, () => {
      const c = s.config('ru');
      const hasProject = Object.values(c.kinds).some(k => (k.fields ?? []).some(f => f.key === 'project' && f.type === 'ref'));
      if (!hasProject) return;
      const g = c.list?.groupings ?? [];
      expect(g.some(x => x === 'project' || x === 'fields.project'), `${id}: groupings = ${g.join(', ')}`).toBe(true);
    });
  }
});
