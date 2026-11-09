// Узкий экран — ОДИН порог на весь kit (S4-03, S9-12).
//
// Жил в `shell/KitShell.tsx`, и из-за этого список не мог им пользоваться:
// тянуть оболочку в список ради одного хука значило бы тащить за ним всё
// меню. Второй порог в списке был бы хуже — «узко» начало бы наступать в
// разных местах по-разному, и правило «на телефоне карточки, а не таблица»
// перестало бы совпадать с правилом «на телефоне меню листом».
//
// Поэтому порог и хук переехали сюда; `KitShell` их реэкспортирует, чтобы
// прежние импорты продолжали работать.
import { useEffect, useState } from 'react';

/** Телефон и узкое окно: ≤720px. Один порог на оболочку, списки и записи. */
export const NARROW_QUERY = '(max-width: 720px)';

/**
 * Узкий экран. `force` задан — без matchMedia (тесты, встройка, демо).
 *
 * На сервере и в среде без matchMedia отвечает «не узко»: угадывать телефон
 * там, где ширину спросить негде, значило бы рисовать карточки всем.
 */
export function useNarrow(force?: boolean): boolean {
  const [matches, setMatches] = useState(() => {
    if (force !== undefined || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(NARROW_QUERY).matches;
  });
  useEffect(() => {
    if (force !== undefined || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(NARROW_QUERY);
    setMatches(mql.matches);
    const onChange = (e: { matches: boolean }) => setMatches(e.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [force]);
  return force ?? matches;
}
