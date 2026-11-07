// SPRINT_UXR_S5_RECORD_TASKS/S5-04 · маршрут чтения задачи: паспорт задачи
// открывается по URL (?section=tasks&passport=SPRINT/CODE) — из списков S4.
import { describe, expect, it } from 'vitest';
import { routeOf } from '../App';

describe('S5-04 · маршрут задачи в App', () => {
  it('?section=tasks&passport=… — экран чтения задачи', () => {
    expect(routeOf('/', '?section=tasks&passport=SPRINT_A%2FT-1')).toBe('task');
  });
  it('раздел задач без паспорта — не экран задачи (это список S4)', () => {
    expect(routeOf('/', '?section=tasks')).toBe('home');
  });
  it('прежние маршруты не сломаны', () => {
    expect(routeOf('/kit')).toBe('kit');
    expect(routeOf('/kit/')).toBe('kit');
    expect(routeOf('/')).toBe('home');
  });
});
