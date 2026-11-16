// Параметр состояния в URL как React-состояние (SPRINT_UXR_S10_SEIDR_KIT/K-06).
// Пишет через pushUrlState (фолбэк на «#», S4-00f), читает readUrlState
// (query + hash). pushState не шлёт popstate, а запись в «#» шлёт hashchange
// асинхронно — поэтому любая запись адреса через kit оповещает сразу (onUrlStateWrite), а
// «Назад»/правка адреса — через popstate и hashchange.
import { useCallback, useSyncExternalStore } from 'react';
import { onUrlStateWrite, pushUrlState, readUrlState } from './urlState';

function subscribe(cb: () => void): () => void {
  const off = onUrlStateWrite(cb);
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', cb);
    window.addEventListener('hashchange', cb);
  }
  return () => {
    off();
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', cb);
      window.removeEventListener('hashchange', cb);
    }
  };
}

/** Записать несколько параметров разом и оповестить все useUrlParam. */
export function setUrlParams(
  patch: Record<string, string | null | undefined>,
  opts: { replace?: boolean } = {},
): 'history' | 'hash' {
  // pushUrlState оповещает всех подписчиков сам (onUrlStateWrite).
  return pushUrlState(patch, opts);
}

export function useUrlParam(
  key: string,
): [string | null, (value: string | null, opts?: { replace?: boolean }) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readUrlState().get(key),
    () => null,
  );
  const set = useCallback(
    (v: string | null, opts?: { replace?: boolean }) => { setUrlParams({ [key]: v }, opts); },
    [key],
  );
  return [value, set];
}
