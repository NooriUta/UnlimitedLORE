import { describe, expect, it } from 'vitest';
import { slicePageOf } from './backend.js';

// SE-01 / 05.11.2026: бэкенд принимает limit/offset у любого слайса и сообщает
// страницу полем `page` ({limit, offset, total, has_more}). MCP раньше брал из
// ответа только rows и признак усечения — страница выглядела бы полным списком.
// Агент обязан видеть, что строк больше, чем пришло.

describe('slicePageOf: страница слайса не теряется по дороге к агенту', () => {
  it('отдаёт page, когда бэкенд её прислал', () => {
    expect(slicePageOf({ rows: [], page: { limit: 2, offset: 0, total: 7, has_more: true } }))
      .toEqual({ limit: 2, offset: 0, total: 7, has_more: true });
  });

  it('без постраничности — undefined, ответ остаётся голым массивом', () => {
    expect(slicePageOf({ rows: [1, 2] })).toBeUndefined();
  });

  it('предупреждение «колонки не проверены» на пустой выдаче доходит до агента', () => {
    expect(slicePageOf({ rows: [], page: { limit: null, offset: 0, total: 0, has_more: false, fields: ['x'], fields_checked: false, warning: '0 rows: fields [x] could NOT be checked' } }))
      .toMatchObject({ fields_checked: false, warning: expect.stringContaining('NOT be checked') });
  });

  it('MT-MCP-CHANGED-RANGE: применённый период и сортировка доходят до агента', () => {
    expect(slicePageOf({ rows: [], page: { limit: null, offset: 0, total: 3, has_more: false, changed_from: '2026-11-10', changed_to: '2026-11-11', sort: 'changed_at:desc', time_zone: 'UTC' } }))
      .toMatchObject({ total: 3, changed_from: '2026-11-10', changed_to: '2026-11-11', sort: 'changed_at:desc', time_zone: 'UTC' });
  });

  it('мусор вместо page не выдаётся за страницу', () => {
    expect(slicePageOf({ rows: [], page: 'x' as unknown as object })).toBeUndefined();
  });
});
