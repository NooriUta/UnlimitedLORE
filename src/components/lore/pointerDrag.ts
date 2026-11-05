// SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-08 — ресайз панелей пальцем.
//
// Ручки ресайза плана и паспорта слушали только onMouseDown + mousemove/mouseup:
// на телефоне и планшете касание их не двигало. Pointer events покрывают мышь,
// палец и перо одним обработчиком; touchAction:'none' на ручке не даёт браузеру
// забрать жест под прокрутку страницы.

/** То, что нужно от события начала жеста (React.PointerEvent подходит). */
export interface DragStartEvent {
  clientX: number;
  clientY: number;
  pointerId: number;
  preventDefault(): void;
  currentTarget?: unknown;
}

export interface DragOpts {
  /** Ось жеста: 'x' — ширина, 'y' — высота. */
  axis: 'x' | 'y';
  /** Смещение от точки начала жеста, px. */
  onDelta: (delta: number) => void;
  onEnd?: () => void;
}

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Начать жест ресайза. Слушает pointermove/pointerup/pointercancel на `target`
 * (по умолчанию window) и снимает слушатели сам по окончании. Возвращает
 * функцию досрочной отмены (для размонтирования посреди жеста).
 */
export function startPointerDrag(e: DragStartEvent, opts: DragOpts, target: Listenable = window): () => void {
  e.preventDefault();
  const el = e.currentTarget as { setPointerCapture?: (id: number) => void } | null | undefined;
  // Захват указателя — чтобы жест не обрывался, когда палец уходит с узкой
  // ручки. Не во всех окружениях он есть (старые webview) — тогда хватает
  // слушателей на window.
  if (el && typeof el.setPointerCapture === 'function') {
    try { el.setPointerCapture(e.pointerId); } catch (err) { console.debug('setPointerCapture failed', err); }
  }
  const x0 = e.clientX, y0 = e.clientY;
  const onMove = (ev: Event) => {
    const p = ev as unknown as { clientX: number; clientY: number };
    opts.onDelta(opts.axis === 'x' ? p.clientX - x0 : p.clientY - y0);
  };
  const stop = () => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
  };
  const end = () => { stop(); opts.onEnd?.(); };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  return stop;
}

/** Значение в границах [min, max]. */
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Стиль ручки: жест не уходит в прокрутку страницы. */
export const dragHandleTouch = { touchAction: 'none' as const };
