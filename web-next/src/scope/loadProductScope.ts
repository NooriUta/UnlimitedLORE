// Список продуктов для верхнего фильтра (SPRINT_LORE_PROJECT_SCOPE/PS-PRODUCT-FILTER, владелица 21.11.2026:
// «считаем продукт логической группировкой проектов; на верхний фильтр выносим продукт»). Источник — срез
// products (code, подпись, вид, проекты). Фильтр раскрывает в проекты бэкенд (?scope_products=), здесь только
// варианты выбора: сначала технологические, потом сервисные; снятые с поддержки не предлагаются.
import type { ScopeOption, SliceCompletenessMeta } from '@seidr/kit';
import type { SliceBody } from '../api/loreSlice';

export interface ProductRow {
  code?: string | null;
  label_ru?: string | null;
  kind?: string[] | string | null;
  git_projects?: (string | null)[] | null;
  is_active?: boolean | null;
  /** Родитель подпродукта (out('PARENT_PRODUCT').code) — списком из одного или строкой. */
  parent_code?: (string | null)[] | string | null;
}

/** Родитель подпродукта: первый непустой код; нет — продукт верхнего уровня. */
const parentOf = (p: ProductRow['parent_code']): string | undefined =>
  (Array.isArray(p) ? p.find((x): x is string => typeof x === 'string' && !!x) : (typeof p === 'string' && p ? p : undefined));

export type ProductScopeData = SliceCompletenessMeta & {
  rows: ScopeOption[];
  mine: 'known' | 'unknown';
  mineCount?: number;
};

type Fetch = <T>(slice: string, params: Record<string, string>, signal?: AbortSignal) => Promise<SliceBody<T>>;

const noOrg = (slug: string) => slug.replace(/^[^/]+\//, '');
const kinds = (k: ProductRow['kind']) => (Array.isArray(k) ? k : k ? [k] : []);

export async function loadProductScope({ fetch, me, signal, noProject = 'без проекта' }: {
  fetch: Fetch;
  /** Мои проекты с сервера (GET /lore/me/projects) — «мой» продукт = продукт моего проекта. */
  me?: (signal?: AbortSignal) => Promise<readonly string[]>;
  signal?: AbortSignal;
  /** Подсказка у продукта без проектов — словами приложения (i18n). */
  noProject?: string;
}): Promise<ProductScopeData> {
  const mineP = me ? me(signal).then(l => new Set(l), () => null) : Promise.resolve(null);
  const [body, mine] = await Promise.all([fetch<ProductRow>('products', {}, signal), mineP]);
  const { rows, ...meta } = body;
  const list = rows
    .filter(r => r && typeof r.code === 'string' && r.code && r.is_active !== false)
    .map(r => {
      const projects = (r.git_projects ?? []).filter((p): p is string => !!p);
      const o: ScopeOption = { id: r.code as string, title: r.label_ru || (r.code as string), hint: projects.length ? projects.map(noOrg).join(' · ') : noProject };
      if (mine) o.mine = projects.some(p => mine.has(p));
      // PS-PRODUCT-FILTER (владелица 21.11.2026: «раскрытием дерева с кнопочкой рядом с составным продуктом»):
      // подпродукт — под родителем в дереве ScopePicker; выбор родителя раскрывает подпродукты бэкенд.
      const parent = parentOf(r.parent_code);
      if (parent) o.parent = parent;
      return { o, tech: kinds(r.kind).includes('tech') };
    });
  // Порядок: технологические, затем сервисные; внутри — как отдал срез (sort_order).
  const ordered = [...list.filter(x => x.tech), ...list.filter(x => !x.tech)].map(x => x.o);
  return mine
    ? { ...meta, rows: ordered, mine: 'known', mineCount: ordered.filter(o => o.mine).length }
    : { ...meta, rows: ordered, mine: 'unknown' };
}
