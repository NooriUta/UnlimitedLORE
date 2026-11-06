/**
 * Вехи по продуктам (RM-P5 / RM-U2 / RM-U6; прототип RM-U1 v4, «да» владелицы
 * 06.11.2026). Чистая логика, без React — чтобы её можно было проверить тестом.
 *
 * Карта принадлежит ПРОДУКТУ (ADR-LORE-040, D-2026-LORE-PRODUCT-IS-OWN-ENTITY),
 * подпродукты показываются внутри родителя: карта AIDA несёт и вехи HOUND/SEIDR,
 * а выбор подпродукта сужает карту до него одного.
 */

export const NO_PRODUCT = '__none';

/** Строка среза `products`. */
export interface ProductRow {
  code: string;
  label_ru: string | null;
  parent_code: string[] | null;
  sub_products: string[] | null;
  components: string[] | null;
}

interface MilestoneLike { milestone_id: string; products?: string[] | null; direct_sprint_ids?: string[] | null }
interface SprintLike { sprint_id: string; status_raw: string | null; components: string[] | null }

/** Продукт и все его подпродукты (вниз по дереву, без циклов). */
export function productScope(code: string, products: ProductRow[]): Set<string> {
  const by = new Map(products.map(p => [p.code, p]));
  const out = new Set<string>();
  const walk = (c: string) => {
    if (out.has(c)) return;
    out.add(c);
    for (const k of by.get(c)?.sub_products ?? []) walk(k);
  };
  walk(code);
  return out;
}

/**
 * Вехи выбранного продукта. `null` — все вехи; NO_PRODUCT — вехи без продукта
 * (незаполненность, её надо видеть, а не прятать).
 */
export function milestonesOfProduct<M extends MilestoneLike>(ms: M[], code: string | null, products: ProductRow[]): M[] {
  if (!code) return ms;
  if (code === NO_PRODUCT) return ms.filter(m => !(m.products ?? []).length);
  const scope = productScope(code, products);
  return ms.filter(m => (m.products ?? []).some(p => scope.has(p)));
}

/**
 * Замороженная веха: календарь забега M0–M7 и история по сериям релизов
 * (`…-HIST-…`), D-2026-LORE-HISTORY-SPLIT-AND-FREEZE. Признака «заморожена» в
 * модели вехи нет — до поля держимся соглашения об идентификаторах, принятого
 * при раскладке 06.11.2026.
 */
export function isFrozenMilestone(id: string): boolean {
  return /^M[0-7]$/.test(id) || /-HIST-/.test(id);
}

const CLOSED = /DONE|CLOSED|ЗАВЕРШ|ЗАКРЫТ|MERGED|✅|CANCEL|ОТМЕН|🚫/i;

/**
 * «Вне плана» (RM-U6): открытые спринты продукта, не стоящие ни в одной вехе.
 * Спринт относится к продукту через свои компоненты (IN_PRODUCT), подпродукты
 * входят. Без выбора продукта — все открытые спринты без вехи.
 */
export function unplannedOfProduct<S extends SprintLike>(
  sprints: S[], ms: MilestoneLike[], code: string | null, products: ProductRow[],
): S[] {
  const planned = new Set<string>();
  ms.forEach(m => (m.direct_sprint_ids ?? []).forEach(id => planned.add(id)));
  const open = sprints.filter(s => !planned.has(s.sprint_id) && !CLOSED.test(s.status_raw ?? ''));
  if (!code) return open;
  const scope = productScope(code, products);
  const comps = new Set(products.filter(p => scope.has(p.code)).flatMap(p => p.components ?? []));
  if (code === NO_PRODUCT) {
    const all = new Set(products.flatMap(p => p.components ?? []));
    return open.filter(s => !(s.components ?? []).some(c => all.has(c)));
  }
  return open.filter(s => (s.components ?? []).some(c => comps.has(c)));
}
