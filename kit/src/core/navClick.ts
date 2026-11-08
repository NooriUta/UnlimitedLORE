// Щелчок по ссылке, которая ведёт внутрь приложения
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-28, S4-MENU-STATES).
//
// Аудит навигации 08.11.2026 нашёл это дважды: «пункты — кнопки: 11 <button>,
// 0 <a href>» и «крошка — элемент <button class="sk-crumbs__back">, не
// ссылка». Кнопка отбирает у пути свойства пути: новую вкладку, копирование
// адреса, средний клик, и для скринридера превращает навигацию в действие.
//
// Но ссылка, которая всегда перехватывает щелчок, — та же кнопка, просто
// похожая на ссылку. Поэтому перехватывается ТОЛЬКО обычный щелчок левой
// кнопкой без клавиш-модификаторов; Ctrl/⌘/Shift/Alt и средняя кнопка уходят
// браузеру, который и открывает новую вкладку или окно.
import type { MouseEvent as ReactMouseEvent } from 'react';

/** Истина — щелчок просит браузер, а не приложение (новая вкладка, окно). */
export function isBrowserClick(e: ReactMouseEvent): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

/**
 * Обработчик для `<a href>`, ведущей внутрь приложения: обычный щелчок —
 * переход без перезагрузки, щелчок «в новую вкладку» не трогаем.
 */
export function navClick<T extends Element = HTMLAnchorElement>(go: () => void) {
  return (e: ReactMouseEvent<T>) => {
    if (isBrowserClick(e)) return;
    e.preventDefault();
    go();
  };
}
