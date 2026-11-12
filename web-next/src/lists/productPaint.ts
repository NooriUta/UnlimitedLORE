// Цвет продукта во всех списках и видах (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-PRODUCT-HILITE).
//
// Владелица 11.11: в v2 записи разных продуктов «путают одним продуктом». Правило
// одно на все разделы, а не точечно по экранам:
//
//   продукт записи = её собственные продукты (поле products у вехи и компонента;
//                    сам продукт; компонент — продукт, в который он входит)
//                  + продукты её компонентов (IN_PRODUCT из среза products).
//
// Цвет — из данных: колонка color статьи словаря product. Цвет не выдумывается:
// пусто или значение, не похожее на цвет, — нейтральный токен, и это честное
// «у продукта цвета нет», а не подобранный оттенок. Значение, не похожее на цвет,
// в стиль не попадает вовсе — строка из базы не должна становиться CSS.
//
// Показ — колонкой `fields.product`: ключ вида `fields.*` kit рисует в строке
// списка, на карточке и значком на доске (ListView: cards.extra, boardBadges), а
// цвет несёт иконка значения (valueIcon). Своей вёрстки здесь нет — kit не правится.
import type { KitConfig, KitRecord } from '@seidr/kit';

/** Ключ поля записи и колонки списка. */
export const PRODUCT_FIELD = 'product';
export const PRODUCT_COLUMN = `fields.${PRODUCT_FIELD}`;
/** Нет цвета у продукта — нейтральный токен темы (честное состояние). */
export const PRODUCT_NEUTRAL = 'var(--t3)';
/** Иконка продукта — канон kit (SECTION_ICONS.value), та же, что у раздела «Продукты». */
export const PRODUCT_ICON = 'bullseye';

export interface ProductInfo { code: string; label: string | null; color: string | null }
export interface ProductIndex {
  byCode: ReadonlyMap<string, ProductInfo>;
  /** Компонент → коды продуктов, в которые он входит (IN_PRODUCT). */
  byComponent: ReadonlyMap<string, readonly string[]>;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strs = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
  const out: string[] = [];
  for (const x of list) {
    const s = typeof x === 'string' ? x.trim()
      : x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id.trim() : '';
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
};

/** Цвет статьи словаря: #rgb/#rrggbb(aa) или токен var(--…); иначе — цвета нет. */
const COLOR = /^(#[0-9a-f]{3,8}|var\(--[a-z0-9-]+\))$/i;

/** Срез products → индекс продуктов. */
export function productIndex(rows: readonly Row[]): ProductIndex {
  const byCode = new Map<string, ProductInfo>();
  const byComponent = new Map<string, string[]>();
  for (const r of rows) {
    const code = str(r.code);
    if (!code) continue;
    const color = str(r.color);
    byCode.set(code, { code, label: str(r.label_ru) || null, color: COLOR.test(color) ? color : null });
    for (const c of strs(r.components)) {
      const l = byComponent.get(c) ?? [];
      if (!l.includes(code)) l.push(code);
      byComponent.set(c, l);
    }
  }
  return { byCode, byComponent };
}

/** Цвет продукта: из данных; нет или не цвет — нейтральный токен. */
export function productColor(idx: ProductIndex, code: string): string {
  return idx.byCode.get(code)?.color ?? PRODUCT_NEUTRAL;
}

/** Коды продуктов записи — по одному правилу для всех типов. */
export function productsOf(r: KitRecord, idx: ProductIndex): string[] {
  const out: string[] = [];
  const add = (c: string) => { if (c && !out.includes(c)) out.push(c); };
  if (r.kind === 'product') add(r.id);
  for (const c of strs(r.fields.products)) add(c);
  const comps = [...strs(r.fields.components), ...strs(r.fields.component), ...(r.kind === 'component' ? [r.id] : [])];
  for (const comp of comps) for (const c of idx.byComponent.get(comp) ?? []) add(c);
  return out;
}

/** Записи с полем `product` — чипы {код, подпись}; подписи нет — код (kit покажет код). */
export function paintRecords(records: readonly KitRecord[], idx: ProductIndex): KitRecord[] {
  return records.map(r => ({
    ...r,
    fields: { ...r.fields, [PRODUCT_FIELD]: productsOf(r, idx).map(id => ({ id, label: idx.byCode.get(id)?.label ?? null })) },
  }));
}

/** Иконка значения для поля продукта; чужие поля — undefined (решает следующий). */
export function productValueIcon(idx: ProductIndex) {
  return (key: string, value: string): { icon: string; color: string } | undefined =>
    key === PRODUCT_FIELD || key === PRODUCT_COLUMN ? { icon: PRODUCT_ICON, color: productColor(idx, value) } : undefined;
}

/**
 * Конфиг раздела + поле «Продукт» у каждого вида записи, колонка сразу после
 * названия, фасет и разрез. Повторный вызов ничего не дублирует.
 */
export function withProductColumn(cfg: KitConfig, title: string): KitConfig {
  const list = cfg.list;
  if (!list) return cfg;
  const kinds: KitConfig['kinds'] = {};
  for (const [k, v] of Object.entries(cfg.kinds)) {
    const fields = v.fields ?? [];
    kinds[k] = fields.some(f => f.key === PRODUCT_FIELD)
      ? v
      : { ...v, fields: [...fields, { key: PRODUCT_FIELD, title, type: 'ref' }] };
  }
  const cols = list.columns ?? [];
  const columns = cols.includes(PRODUCT_COLUMN) ? cols : (() => {
    const at = cols.indexOf('title');
    const next = [...cols];
    next.splice(at >= 0 ? at + 1 : next.length, 0, PRODUCT_COLUMN);
    return next;
  })();
  const add = (xs: readonly string[] | undefined) => (xs ?? []).includes(PRODUCT_COLUMN) ? [...(xs ?? [])] : [...(xs ?? []), PRODUCT_COLUMN];
  return { ...cfg, kinds, list: { ...list, columns, filters: add(list.filters), groupings: add(list.groupings) } };
}
