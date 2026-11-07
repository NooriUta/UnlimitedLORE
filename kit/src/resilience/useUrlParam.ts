// Параметр состояния в URL как React-состояние (SPRINT_UXR_S10_SEIDR_KIT/K-06).
// Пишет через pushUrlState (фолбэк на «#», S4-00f), читает readUrlState
// (query + hash). pushState не шлёт popstate, а запись в «#» шлёт hashchange
// асинхронно — поэтому свои записи оповещаются сразу через общий канал, а
// «Назад»/правка адреса — через popstate и hashchange.
import { useCallback, useSyncExternalStore } from 'react';
import { pushUrlState, readUrlState } from './urlState';

const local = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  local.add(cb);
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', cb);
    window.addEventListener('hashchange', cb);
  }
  return () => {
    local.delete(cb);
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
  const mode = pushUrlState(patch, opts);
  local.forEach((cb) => cb());
  return mode;
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
