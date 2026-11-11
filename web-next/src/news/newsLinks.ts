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
 * Человек — его карточка в «Кто где» админки (раскрыта по kc_sub: автор правки
 * пишется именно им, S2-12). Агент — раздел агентов: автор-агент записан
 * client_id, а раскрытие там по actor_id, и подставлять одно вместо другого
 * значило бы открыть не того. Записи — раздел своего типа v2 (проект — с S4-29). Паспорта нет
 * у типа — null: kit рисует текст, а не ссылку-пустышку.
 */
export function newsRefHrefV2(type: string, id: string): string | null {
  if (!id) return null;
  if (type === 'person') return `/admin?${new URLSearchParams({ adm: 'who', 'adm-open': id })}`;
  if (type === 'agent') return '/admin?adm=agents';
  return recordHref(type, id);
}
