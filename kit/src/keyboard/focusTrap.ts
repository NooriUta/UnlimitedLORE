// Фокус во всплывающих окнах (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11): одно
// правило для всех модалок и поповеров kit — Sheet/Drawer, меню статуса и окон
// приложений. При открытии фокус уходит внутрь (на заданный или первый
// фокусируемый элемент), Tab и Shift+Tab ходят по кругу и не выпускают фокус
// наружу, Esc закрывает, а при закрытии фокус возвращается на кнопку, которой
// окно открыли: клавиатурный пользователь не теряет место на странице.
import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Фокусируемые потомки в порядке документа (скрытые атрибутом hidden — нет). */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.closest('[hidden]'));
}

export interface FocusTrapOptions {
  /** Окно открыто (для компонентов, которые не размонтируются при закрытии). */
  active?: boolean;
  /** Куда поставить фокус при открытии; null/нет — первый фокусируемый, иначе само окно. */
  initialFocus?: (root: HTMLElement) => HTMLElement | null | undefined;
  /** Вернуть фокус открывателю при закрытии (по умолчанию да). */
  restoreFocus?: boolean;
  /** Esc: закрыть окно. Нет — Esc не перехватывается. */
  onEscape?: () => void;
}

/** Ловушка фокуса. Возвращает onKeyDown — повесить на корень окна. */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  opts: FocusTrapOptions = {},
): (e: ReactKeyboardEvent<HTMLElement>) => void {
  const active = opts.active !== false;
  const latest = useRef(opts);
  useEffect(() => { latest.current = opts; });

  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    const root = ref.current;
    if (root) {
      const target = latest.current.initialFocus?.(root) ?? focusables(root)[0] ?? root;
      target.focus();
    }
    return () => {
      if (latest.current.restoreFocus === false) return;
      if (opener && opener.isConnected) opener.focus();
    };
  }, [active, ref]);

  return useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    const root = ref.current;
    if (!root) return;
    if (e.key === 'Escape' || e.code === 'Escape') {
      const onEscape = latest.current.onEscape;
      if (!onEscape) return;
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = focusables(root);
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !root.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !root.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  }, [ref]);
}
