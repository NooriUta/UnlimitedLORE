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

  it('мусор вместо page не выдаётся за страницу', () => {
    expect(slicePageOf({ rows: [], page: 'x' as unknown as object })).toBeUndefined();
  });
});
