// Верхний фильтр по продукту (SPRINT_LORE_PROJECT_SCOPE/PS-PRODUCT-FILTER, владелица 21.11.2026: «считаем продукт
// логической группировкой проектов; на верхний фильтр выносим продукт — фильтр по продукту делаем для бэка»).
// Вид — тот же kit ScopePicker, что у проектов (подписи — про продукты); выбор — в URL (?prod=A,B); раскрывает
// продукт в его проекты бэкенд (?scope_products=). Проекты остаются детальным фильтром внутри списков (?proj=).
import { useMemo } from 'react';
import { ScopePicker, formatScopeSelection, parseScopeSelection, useLoadState, useUrlParam } from '@seidr/kit';
import { sliceFetcher, type SliceFetcher } from '../api/loreSlice';
import { myProjects } from '../api/me.projects';
import { useAppT } from '../i18n';
import { loadProductScope, type ProductScopeData } from './loadProductScope';

/** Параметр URL с выбранными продуктами. */
export const PRODUCT_SCOPE_PARAM = 'prod';

/** Выбранные продукты из URL — экраны передают их бэкенду (scope_products). Пусто — фильтра нет. */
export function useProductScope(): string[] {
  const [raw] = useUrlParam(PRODUCT_SCOPE_PARAM);
  return useMemo(() => parseScopeSelection(raw).ids.slice(), [raw]);
}

export interface ProductScopeProps {
  fetch?: SliceFetcher;
  me?: ((signal?: AbortSignal) => Promise<readonly string[]>) | null;
  narrow?: boolean;
}

export function ProductScope({ fetch, me, narrow }: ProductScopeProps) {
  const t = useAppT();
  const doFetch = useMemo(() => fetch ?? sliceFetcher(), [fetch]);
  const result = useLoadState<ProductScopeData>(
    signal => loadProductScope({
      fetch: doFetch,
      me: me === null ? undefined : (me ?? (sig => myProjects(sig).then(list => list.map(p => p.slug)))),
      signal,
      noProject: t('scope.product.noProject'),
    }),
    [doFetch, me],
  );
  const [raw, setRaw] = useUrlParam(PRODUCT_SCOPE_PARAM);
  const value = useMemo(() => parseScopeSelection(raw).ids, [raw]);
  const data = result.data;
  return (
    <ScopePicker
      label={t('scope.product.label')}
      labels={{ all: t('scope.product.all'), many: t('scope.product.many'), search: t('scope.product.search') }}
      options={data?.rows ?? []}
      value={value}
      onChange={next => setRaw(formatScopeSelection({ except: false, ids: next }))}
      state={result.state}
      error={result.error}
      onRetry={result.reload}
      completeness={result.completeness}
      mine={data?.mine ?? 'unknown'}
      mineCount={data?.mineCount}
      narrow={narrow}
    />
  );
}
