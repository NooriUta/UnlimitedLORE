// Куда ведёт строка ленты новостей в v2 (прод v1.17.7, владелица 09.11:
// «некоторые переходы странно себя ведут»; «меню не должны ни по одной ссылке
// пропадать»). kit по умолчанию строит адреса v1 (/lore?section=…&passport=…),
// которых в v2 нет. Адрес записи — единый модуль маршрутов loreRoutes (S4-13).
import type { NewsEvent } from './feed';
import { recordHref, recordIdOf } from '../nav/loreRoutes';

export function newsHrefV2(e: NewsEvent): string | null {
  if (!e.el) return null;
  return recordHref(e.type, recordIdOf(e.type, e.el, e.projects?.[0]));
}

/**
 * Связанное в строке ленты — автор, спринт задачи, ADR решения (S7A-08, п.24).
 * Решение владелицы 10.11.2026: «всё, что можно открыть, делать ссылкой: в ленте
 * открываются люди и любой объект, у которого есть паспорт».
 *
 * Человек — его личная страница вне админки (?sec=user, ключ kc_sub: автор правки пишется
 * именно им, S2-12). Агент — его карточка вне админки (?sec=agent): автор-агент записан
 * client_id, и срез agent_by_id находит агента и по client_id. Владелица 21.11.2026: «ни одна
 * связь не ведёт в админку из общих поверхностей». Записи — раздел своего типа v2 (проект — с S4-29). Паспорта нет
 * у типа — null: kit рисует текст, а не ссылку-пустышку.
 */
export function newsRefHrefV2(type: string, id: string): string | null {
  if (!id) return null;
  if (type === 'person') return recordHref('user', id);
  if (type === 'agent') return recordHref('agent', id);
  return recordHref(type, id);
}
