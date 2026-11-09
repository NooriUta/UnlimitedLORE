// Палитра: «Копировать ссылку» и переход по записи давали ?rec=<id> — такого
// маршрута в v2 нет, ссылка открывала «Новости» (S4-13, переоткрыто 09.11.2026).
import { describe, expect, it } from 'vitest';
import type { KitRecord } from '@seidr/kit';
import { defaultHref, paletteHref } from './LorePalette';

const rec = (id: string, kind: string) => ({ id, kind, title: id } as unknown as KitRecord);

describe('ссылка на запись из палитры — адрес раздела её типа', () => {
  it('известная запись → ?mod&sec&open из loreRoutes, а не ?rec=', () => {
    const h = paletteHref('ADR-LORE-049', [rec('ADR-LORE-049', 'adr')], defaultHref);
    expect(h).toBe('/?mod=forseti&sec=adr&open=ADR-LORE-049');
    expect(h).not.toMatch(/[?&]rec=/);
  });

  it('задача с «/» в коде открывается в «Задачах»', () => {
    expect(paletteHref('S/T-1', [rec('S/T-1', 'task')], defaultHref)).toBe('/?mod=forseti&sec=task&open=S%2FT-1');
  });

  it('тип записи неизвестен — переданная ссылка, без выдумывания раздела', () => {
    expect(paletteHref('X-1', [], id => `custom:${id}`)).toBe('custom:X-1');
    expect(paletteHref('D-1', [rec('D-1', 'doc')], id => `custom:${id}`)).toBe('custom:D-1');
  });
});
