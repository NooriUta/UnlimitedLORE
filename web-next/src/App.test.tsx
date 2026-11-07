import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import App, { sprintPassportOf } from './App';

// S5-02: паспорт спринта открывается из списков по URL (?section=…&passport=…);
// вкладка «Задачи» — первая и по умолчанию.
describe('LORE v2 — маршрут паспорта спринта', () => {
  it('?section=sprints&passport=ID — паспорт спринта, вкладка tasks по умолчанию', () => {
    expect(sprintPassportOf('?section=sprints&passport=SPRINT_X')).toEqual({ sprintId: 'SPRINT_X', tab: 'tasks' });
    expect(sprintPassportOf('?section=sprints&passport=SPRINT_X&tab=tasks&group=status')).toEqual({ sprintId: 'SPRINT_X', tab: 'tasks' });
  });

  it('без passport или в другом разделе — не паспорт спринта', () => {
    expect(sprintPassportOf('?section=sprints')).toBeNull();
    expect(sprintPassportOf('?section=adrs&passport=ADR-1')).toBeNull();
    expect(sprintPassportOf('')).toBeNull();
  });

  it('оболочка с таким адресом рисует вкладку «Задачи» спринта', () => {
    const html = renderToString(<App path="/" search="?section=sprints&passport=SPRINT_X" />);
    expect(html).toContain('data-lore-app="v2"');
    expect(html).toContain('SPRINT_X');
    expect(html).toContain('role="tab"');
    expect(html).toContain('Задачи');
  });
});

describe('LORE v2 — оболочка', () => {
  it('рендерится и называет себя v2, чтобы её нельзя было спутать с v1', () => {
    const html = renderToString(<App />);
    expect(html).toContain('LORE');
    expect(html).toContain('data-lore-app="v2"');
  });
});
