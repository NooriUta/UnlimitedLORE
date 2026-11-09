// Вкладка записи — в URL (?tab=…), с фолбэком в «#» там, где pushState
// запрещён (песочница iframe, file://) — переиспользует urlState фазы A (S4-00f).
//
// **Хук не только пишет адрес, но и СЛЕДИТ за ним** (аудит 09.11, D-21/D-24).
// Раньше адрес читался один раз, при первом показе, и «назад» менял адрес, не
// меняя экран: ссылка обещала одну вкладку, показывалась другая. Это хуже, чем
// если бы вкладка в адресе не жила вовсе, — обещание было, и оно не
// выполнялось.
//
// Отслеживаются оба пути, которыми адрес меняется не нами: `popstate`
// («назад»/«вперёд») и `hashchange` (фолбэк в «#» и правка адреса руками).
// pushState своего события не шлёт, поэтому собственная запись состояние не
// перетирает.
import { useCallback, useEffect, useState } from 'react';
import { pushUrlState, readUrlState, type UrlWindow } from '../resilience/urlState';

export const RECORD_TAB_PARAM = 'tab';

/** Окно, у которого можно спросить адрес и подписаться на его изменения. */
type Listenable = UrlWindow & {
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
};

export function useRecordTab(fallback = 'overview', win?: UrlWindow): [string, (tab: string) => void] {
  const w = win ?? (typeof window === 'undefined' ? undefined : window);
  const read = () => (w ? readUrlState(w).get(RECORD_TAB_PARAM) : null) || fallback;
  const [tab, setTab] = useState(read);

  const set = useCallback((next: string) => {
    setTab(next);
    if (w) pushUrlState({ [RECORD_TAB_PARAM]: next }, { win: w });
  }, [w]);

  useEffect(() => {
    const target = w as Listenable | undefined;
    if (!target?.addEventListener) return;
    // Читаем адрес заново на каждое событие: источник правды — он, а не наше
    // прежнее значение. Параметр убрали руками — возвращаемся к умолчанию, а
    // не застываем на последнем выбранном.
    const sync = () => setTab((w ? readUrlState(w).get(RECORD_TAB_PARAM) : null) || fallback);
    target.addEventListener('popstate', sync);
    target.addEventListener('hashchange', sync);
    return () => {
      target.removeEventListener?.('popstate', sync);
      target.removeEventListener?.('hashchange', sync);
    };
  }, [fallback, w]);

  return [tab, set];
}
