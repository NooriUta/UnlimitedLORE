// LoadStateView (S4-00c): один переключатель «что рисовать» по результату
// useLoadState — вместо своих ветвлений в каждом экране (там «пусто» и
// «ошибка» и склеиваются). partial = данные + плашка Truncated сверху.
import type { ReactNode } from 'react';
import type { LoadResult } from './useLoadState';
import { metaOf } from './loadState';
import { EmptyState, Forbidden, LoadError, Skeleton } from './StateViews';
import { Truncated } from './Truncated';

export interface LoadStateViewProps<T> {
  result: LoadResult<T>;
  /** Данные (ok и partial). */
  children: (data: T, rows: readonly unknown[]) => ReactNode;
  /** Свои состояния вместо умолчаний. */
  empty?: ReactNode;
  loading?: ReactNode;
  forbidden?: ReactNode;
  /** «Показать ещё» на постраничной выдаче. */
  onMore?: () => void;
}

export function LoadStateView<T>({ result, children, empty, loading, forbidden, onMore }: LoadStateViewProps<T>) {
  switch (result.state) {
    case 'loading':
      return <>{loading ?? <Skeleton />}</>;
    case 'empty':
      return <>{empty ?? <EmptyState />}</>;
    case 'error':
      return <LoadError error={result.error} onRetry={result.reload} />;
    case 'forbidden':
      return <>{forbidden ?? <Forbidden reason={metaOf(result.data)?.outside_scope?.reason} />}</>;
    case 'partial':
      return (
        <>
          <Truncated completeness={result.completeness} onMore={onMore} />
          {children(result.data as T, result.rows ?? [])}
        </>
      );
    case 'ok':
      return <>{children(result.data as T, result.rows ?? [])}</>;
  }
}
