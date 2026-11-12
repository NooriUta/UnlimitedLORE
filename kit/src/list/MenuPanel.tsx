// Панель меню строки управления (поповеры «Вид», «Группировка», «Порядок»):
// рендер порталом в body и position: fixed по кнопке-якорю. Строка управления
// живёт в .sk-dock__backdrop { overflow: auto }, и абсолютный поповер срезался
// границей дока при открытом паспорте. Слой как у PeekPanel: поверх дока
// (z-index 60 в seidr.css), top/left держит у кнопки скролл и resize.
import { useEffect, useLayoutEffect, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

/** Зазор между кнопкой и панелью — как прежний «top: calc(100% + 4px)». */
const GAP = 4;

export interface MenuPanelProps {
  /** Кнопка-открыватель: панель встаёт под её нижним левым углом. */
  anchor: HTMLElement | null;
  /** Доступное имя диалога. */
  label: string;
  id?: string;
  className?: string;
  panelRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  /** Щелчок мимо кнопки и панели закрывает меню. */
  onClose: () => void;
  children?: ReactNode;
}

export function MenuPanel({ anchor, label, id, className, panelRef, onKeyDown, onClose, children }: MenuPanelProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor?.getBoundingClientRect();
      setPos(r ? { top: r.bottom + GAP, left: r.left } : null);
    };
    place();
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchor?.contains(t) && !panelRef.current?.contains(t)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [anchor, onClose, panelRef]);

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={label}
      className={['sk-vmenu__panel', className].filter(Boolean).join(' ')}
      style={pos ? { top: pos.top, left: pos.left } : undefined}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}
