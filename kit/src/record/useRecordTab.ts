// Вкладка записи — в URL (?tab=…), с фолбэком в «#» там, где pushState
// запрещён (песочница iframe, file://) — переиспользует urlState фазы A (S4-00f).
import { useCallback, useState } from 'react';
import { pushUrlState, readUrlState, type UrlWindow } from '../resilience/urlState';

export const RECORD_TAB_PARAM = 'tab';

export function useRecordTab(fallback = 'overview', win?: UrlWindow): [string, (tab: string) => void] {
  const w = win ?? (typeof window === 'undefined' ? undefined : window);
  const [tab, setTab] = useState(() => (w ? readUrlState(w).get(RECORD_TAB_PARAM) : null) || fallback);
  const set = useCallback((next: string) => {
    setTab(next);
    if (w) pushUrlState({ [RECORD_TAB_PARAM]: next }, { win: w });
  }, [w]);
  return [tab, set];
}
