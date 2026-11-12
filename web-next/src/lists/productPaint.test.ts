// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-PRODUCT-HILITE — цвет продукта во всех списках и видах.
//
// Владелица 11.11: в v2 записи разных продуктов «путают одним продуктом». Правило
// ОДНО на все разделы: продукт записи — её собственные продукты (веха, компонент,
// сам продукт) плюс продукты её компонентов (IN_PRODUCT, срез products). Цвет —
// из данных (KnowDictEntry.color); нет цвета или он не похож на цвет — нейтрально,
// и это честное состояние, а не выдуманный оттенок.
//
// Показ — колонкой `fields.product`: такой ключ kit рисует и в строке списка, и на
// карточке, и значком на доске (одно поле — все виды), а цвет несёт иконка значения.
import { describe, expect, it } from 'vitest';
import type { KitRecord } from '@seidr/kit';
import {
  PRODUCT_COLUMN, PRODUCT_NEUTRAL, paintRecords, productColor, productIndex, productValueIcon, withProductColumn,
} from './productPaint';
import { LIST_SCREENS } from './screens';

const ROWS = [
  { code: 'LORE', label_ru: 'Лор', color: '#E0A13D', components: ['HND', 'SEIDRKIT'] },
  { code: 'MINI', label_ru: 'Мини', color: null, components: ['MINILINK'] },
  { code: 'BAD', label_ru: 'Битый', color: 'red;}body{x:1', components: [] },
];

const rec = (id: string, kind: string, fields: Record<string, unknown>): KitRecord => ({ id, kind, title: id, status: '', fields });

describe('продукт записи — одно правило', () => {
  const idx = productIndex(ROWS);

  it('через компоненты записи (спринт, задача, ADR, фича…)', () => {
    const [s] = paintRecords([rec('SPRINT_A', 'sprint', { components: ['HND'] })], idx);
    expect(s.fields.product).toEqual([{ id: 'LORE', label: 'Лор' }]);
    const [t] = paintRecords([rec('S/T-1', 'task', { components: ['HND', 'MINILINK'] })], idx);
    expect((t.fields.product as { id: string }[]).map(c => c.id)).toEqual(['LORE', 'MINI']);
    const [spec] = paintRecords([rec('SPEC-A', 'spec', { component: 'SEIDRKIT' })], idx);
    expect((spec.fields.product as { id: string }[]).map(c => c.id)).toEqual(['LORE']);
  });

  it('свои продукты: веха (products), компонент (его IN_PRODUCT и он сам), продукт — сам себе', () => {
    const [m] = paintRecords([rec('M-1', 'milestone', { products: ['MINI'] })], idx);
    expect((m.fields.product as { id: string }[]).map(c => c.id)).toEqual(['MINI']);
    const [c] = paintRecords([rec('HND', 'component', {})], idx);
    expect((c.fields.product as { id: string }[]).map(x => x.id)).toEqual(['LORE']);
    const [p] = paintRecords([rec('MINI', 'product', {})], idx);
    expect((p.fields.product as { id: string }[]).map(x => x.id)).toEqual(['MINI']);
  });

  it('продукта нет — поле пустое (не выдуманный продукт)', () => {
    const [x] = paintRecords([rec('Q-1', 'question', { components: ['NOPE'] })], idx);
    expect(x.fields.product).toEqual([]);
  });

  it('чипы с подписью; неизвестный код продукта (веха) — кодом', () => {
    const [m] = paintRecords([rec('M-2', 'milestone', { products: ['GHOST'] })], idx);
    expect(m.fields.product).toEqual([{ id: 'GHOST', label: null }]);
  });
});

describe('цвет — из данных, иначе нейтрально', () => {
  const idx = productIndex(ROWS);

  it('цвет продукта как есть; пустой и битый — нейтральный токен', () => {
    expect(productColor(idx, 'LORE')).toBe('#E0A13D');
    expect(productColor(idx, 'MINI')).toBe(PRODUCT_NEUTRAL);
    expect(productColor(idx, 'BAD'), 'строка не цвета не уходит в стиль').toBe(PRODUCT_NEUTRAL);
    expect(productColor(idx, 'GHOST')).toBe(PRODUCT_NEUTRAL);
    expect(PRODUCT_NEUTRAL).toMatch(/^var\(--/);
  });

  it('иконка значения несёт цвет продукта — в ячейке, в фасете, на доске', () => {
    const vi = productValueIcon(idx);
    expect(vi('fields.product', 'LORE')).toMatchObject({ color: '#E0A13D' });
    expect(vi('product', 'MINI')).toMatchObject({ color: PRODUCT_NEUTRAL });
    expect(vi('fields.release', 'v1'), 'чужое поле — не наше дело').toBeUndefined();
  });
});

describe('колонка продукта во всех разделах', () => {
  it('каждый раздел получает поле, колонку (рядом с названием), фасет и разрез «Продукт»', () => {
    for (const [id, def] of Object.entries(LIST_SCREENS)) {
      const cfg = withProductColumn(def.config('ru'), 'Продукт');
      const list = cfg.list!;
      expect(list.columns, id).toContain(PRODUCT_COLUMN);
      const ti = (list.columns ?? []).indexOf('title');
      if (ti >= 0) expect((list.columns ?? []).indexOf(PRODUCT_COLUMN), `${id}: сразу после названия`).toBe(ti + 1);
      expect(list.filters, id).toContain(PRODUCT_COLUMN);
      expect(list.groupings, id).toContain(PRODUCT_COLUMN);
      for (const [kind, k] of Object.entries(cfg.kinds)) {
        expect(k.fields?.some(f => f.key === 'product'), `${id}/${kind}: поле объявлено`).toBe(true);
      }
    }
  });

  it('повторный вызов не дублирует', () => {
    const once = withProductColumn(LIST_SCREENS.sprints.config('ru'), 'Продукт');
    const twice = withProductColumn(once, 'Продукт');
    expect((twice.list!.columns ?? []).filter(c => c === PRODUCT_COLUMN)).toHaveLength(1);
  });
});
