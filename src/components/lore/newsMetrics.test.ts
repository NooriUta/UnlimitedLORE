import { describe, expect, it } from 'vitest';
import type { LoreNewsItem } from '../../api/lore';
import { createdSplit, taskBurn } from './newsMetrics';

const it_ = (kind: LoreNewsItem['kind'], event: string, agg?: number) =>
  ({ kind, event, date: '2026-09-15', title: 'x', ...(agg != null ? { agg } : {}) }) as LoreNewsItem;

describe('createdSplit — «появилось» по объектам, не скопом', () => {
  it('разносит созданное на задачи / спринты / прочее', () => {
    const list = [
      it_('tasks', 'created'), it_('tasks', 'created'), it_('tasks', 'created', 3),
      it_('sprint', 'created'),
      it_('adr', 'created'), it_('spec', 'created'), it_('decision', 'created'),
      it_('tasks', 'closed'), it_('adr', 'changed'),
    ];
    expect(createdSplit(list)).toEqual({ tasks: 5, sprints: 1, other: 3 });
  });
  it('пустой день — нули', () => {
    expect(createdSplit([])).toEqual({ tasks: 0, sprints: 0, other: 0 });
  });
});

describe('taskBurn — сгорание по задачам', () => {
  it('закрыто − заведено: положительное = сгораем', () => {
    const list = [it_('tasks', 'closed'), it_('tasks', 'closed', 4), it_('tasks', 'created'), it_('sprint', 'closed')];
    expect(taskBurn(list)).toEqual({ closed: 5, created: 1, net: 4 });
  });
  it('завели больше, чем закрыли — отрицательное', () => {
    expect(taskBurn([it_('tasks', 'created'), it_('tasks', 'created'), it_('tasks', 'closed')]).net).toBe(-1);
  });
});
