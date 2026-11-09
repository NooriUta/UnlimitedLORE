// Куда ведёт строка ленты новостей в v2 (прод v1.17.7, владелица 09.11:
// «некоторые переходы странно себя ведут»; «меню не должны ни по одной ссылке
// пропадать»). kit по умолчанию строит адреса v1 (/lore?section=…&passport=…),
// которых в v2 нет. Адрес записи — единый модуль маршрутов loreRoutes (S4-13).
import type { NewsEvent } from '@seidr/kit';
import { recordHref, recordIdOf } from '../nav/loreRoutes';

export function newsHrefV2(e: NewsEvent): string | null {
  if (!e.el) return null;
  return recordHref(e.type, recordIdOf(e.type, e.el, e.projects?.[0]));
}
