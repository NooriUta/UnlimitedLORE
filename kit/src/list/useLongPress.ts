// Долгое нажатие на строку/карточку (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-10).
// Один обработчик на контейнер списка: строку находим по data-record-id, так
// что сотни строк не получают по таймеру и набору слушателей каждая.
// Сдвиг больше допуска — это прокрутка, не выбор. Клик, пришедший сразу после
// сработавшего удержания, гасится — иначе отпускание пальца тут же
// переключило бы строку обратно (или открыло ссылку заголовка).
import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { LONG_PRESS } from './listSelection';

function recordIdOf(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target.closest('[data-record-id]') : null;
  return el ? el.getAttribute('data-record-id') : null;
}

export interface LongPressHandlers {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClickCapture: (e: ReactMouseEvent) => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}

export function useLongPress(onLongPress: (id: string) => void, opts: { ms?: number; slop?: number } = {}): LongPressHandlers {
  const ms = opts.ms ?? LONG_PRESS.ms;
  const slop = opts.slop ?? LONG_PRESS.slop;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number; touch: boolean } | null>(null);
  const fired = useRef(false);
  const cb = useRef(onLongPress);
  cb.current = onLongPress;

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    // Левая кнопка мыши или касание/перо; правая кнопка — контекстное меню, не выбор.
    if (e.button !== undefined && e.button > 0) return;
    // Свои контролы (чекбокс, кнопки группы) нажатие обрабатывают сами.
    if (e.target instanceof Element && e.target.closest('input, select, button, textarea')) return;
    const id = recordIdOf(e.target);
    cancel();
    fired.current = false;
    if (!id) return;
    start.current = { x: e.clientX ?? 0, y: e.clientY ?? 0, touch: e.pointerType === 'touch' };
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      cb.current(id);
    }, ms);
  }, [cancel, ms]);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const s = start.current;
    if (!s || timer.current === null) return;
    if (Math.abs((e.clientX ?? 0) - s.x) > slop || Math.abs((e.clientY ?? 0) - s.y) > slop) cancel();
  }, [cancel, slop]);

  const onPointerUp = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const onClickCapture = useCallback((e: ReactMouseEvent) => {
    if (!fired.current) return;
    fired.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Android на удержании открывает системное меню ссылки — при касании гасим его.
  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    if (start.current?.touch || fired.current) e.preventDefault();
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: cancel, onClickCapture, onContextMenu };
}
