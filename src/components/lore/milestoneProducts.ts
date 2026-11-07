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
  /** BELONGS_TO_PROJECT продукта → репозитории; роли — параллельным списком (WK-02). */
  git_projects?: (string | null)[] | null;
  git_project_roles?: (string | null)[] | null;
  /** WK-03: SERVES продукт → продукт; вид — параллельным списком. */
  serves_codes?: (string | null)[] | null;
  serves_kinds?: (string | null)[] | null;
}

export type ServesKind = 'count' | 'sell' | 'support';

/**
 * WK-03 (decision:D-2026-LORE-SERVES-EDGE): кому продукт служит и как,
 * сгруппировано по виду — «кого считаем · кого продаём · кого поддерживаем».
 * Неизвестный вид не выдумывается в один из трёх — такая связь пропускается.
 */
export function productServes(p: Pick<ProductRow, 'serves_codes' | 'serves_kinds'>): Record<ServesKind, string[]> {
  const out: Record<ServesKind, string[]> = { count: [], sell: [], support: [] };
  const codes = p.serves_codes ?? [];
  const kinds = p.serves_kinds ?? [];
  codes.forEach((c, i) => {
    const k = kinds[i];
    if (c && (k === 'count' || k === 'sell' || k === 'support') && !out[k].includes(c)) out[k].push(c);
  });
  (Object.keys(out) as ServesKind[]).forEach(k => out[k].sort());
  return out;
}

export type ProductRepoRole = 'owner' | 'consumer';

/**
 * WK-02 (decision:D-2026-LORE-PRODUCT-PROJECT-ROLE): репозитории продукта с
 * ролью связи — owner развивает, consumer пользуется. Связь без роли отдаётся
 * как null, а не «owner»: «не размечено» и «развивает» — разные ответы.
 */
export function productRepos(p: Pick<ProductRow, 'git_projects' | 'git_project_roles'>): { slug: string; role: ProductRepoRole | null }[] {
  const slugs = p.git_projects ?? [];
  const roles = p.git_project_roles ?? [];
  return slugs.flatMap((slug, i) => {
    if (!slug) return [];
    const r = roles[i];
    return [{ slug, role: r === 'owner' || r === 'consumer' ? r : null }];
  });
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

/**
 * Спринт принадлежит продукту через свои компоненты (IN_PRODUCT); подпродукты
 * входят в карту родителя. `null` — без фильтра; NO_PRODUCT — ни один компонент
 * спринта не принадлежит ни одному продукту (незаполненность, её видно).
 */
export function sprintInProduct(s: { components: string[] | null }, code: string | null, products: ProductRow[]): boolean {
  if (!code) return true;
  const comps = s.components ?? [];
  if (code === NO_PRODUCT) {
    const all = new Set(products.flatMap(p => p.components ?? []));
    return !comps.some(c => all.has(c));
  }
  const scope = productScope(code, products);
  const own = new Set(products.filter(p => scope.has(p.code)).flatMap(p => p.components ?? []));
  return comps.some(c => own.has(c));
}

/**
 * Тумблер «Прошлые» выключен → прячем только ЗАКРЫТОЕ прошлое. Открытый спринт
 * с прошедшим сроком — это просрочка, а не архив: раньше он пропадал вместе с
 * закрытыми, и план выглядел чище, чем есть (на стенде 06.11 — «1 / 76 баров»).
 */
export function hiddenAsPast(plannedEnd: Date, today: Date, isClosed: boolean, cropPast: boolean): boolean {
  return cropPast && isClosed && plannedEnd < today;
}

/**
 * «Поток» — работа вне вех по своей природе: уборка, апгрейды СУБД и
 * зависимостей, регрессы, CI, безопасность, бэкапы (RM-V4). Остальное без вехи —
 * «правда забыли». Признака в модели нет, поэтому — по имени спринта.
 */
const STREAM = /HOUSEKEEPING|DEPS|UPGRADE|REGRESSION|ARCADEDB_\d|ARCADE_\d|(^|_)CI(_|$)|SECURITY|BACKUP|VAULT|INFRA_BACKLOG|HYGIENE/i;
export function isStreamSprint(sprintId: string): boolean {
  return STREAM.test(sprintId);
}

/**
 * RM-U6: доля «вне плана» от открытых спринтов продукта, с делением
 * поток / намеренно / забыли. «Вне плана намеренно» — флаг спринта
 * (unplanned_intentional, ставится в карточке спринта): снимает его из
 * «правда забыли», но в доле вне плана он остаётся — карта не должна
 * выглядеть собранней, чем есть. Поток по имени считается потоком, даже
 * если флаг тоже стоит, — чтобы один спринт не попадал в две корзины.
 */
export function unplannedShare<S extends SprintLike & { components: string[] | null; unplanned_intentional?: boolean | null }>(
  sprints: S[], ms: MilestoneLike[], code: string | null, products: ProductRow[],
): { open: number; unplanned: number; stream: number; intentional: number; forgotten: number; pct: number } {
  const open = sprints.filter(s => !CLOSED.test(s.status_raw ?? '') && sprintInProduct(s, code, products)).length;
  const un = unplannedOfProduct(sprints, ms, code, products);
  const stream = un.filter(s => isStreamSprint(s.sprint_id)).length;
  const intentional = un.filter(s => !isStreamSprint(s.sprint_id) && s.unplanned_intentional === true).length;
  return { open, unplanned: un.length, stream, intentional, forgotten: un.length - stream - intentional, pct: open ? Math.round(un.length / open * 100) : 0 };
}
