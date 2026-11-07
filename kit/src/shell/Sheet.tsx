// Sheet / Drawer (S4-00c): модальная панель — справа (drawer, peek записи),
// слева или снизу (лист «Фильтр и группировка» на телефоне).
// Как в прототипе v4: фокус внутрь при открытии, ловушка Tab, Esc и подложка
// закрывают, фокус возвращается на кнопку-открыватель. Рендер — порталом в
// body: модалка не должна зависеть от overflow/z-index того, кто её открыл.
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../elements/IconButton';
import { kitT, useKitLang } from '../i18n';

export type SheetSide = 'right' | 'left' | 'bottom';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Заголовок — он же имя диалога. */
  title: string;
  side?: SheetSide;
  /** Дополнительные кнопки в шапке (слева от «Закрыть»). */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.hasAttribute('hidden'));
}

export function Sheet({ open, onClose, title, side = 'right', actions, children, className }: SheetProps) {
  const lang = useKitLang();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    const root = panel.current;
    if (root) {
      // Первый элемент тела, а не «Закрыть»: открыли ради содержимого.
      const all = focusables(root);
      const body = root.querySelector<HTMLElement>('.sk-sheet__body');
      const first = (body && focusables(body)[0]) ?? all[0] ?? root;
      first.focus();
    }
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const list = focusables(panel.current);
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panel.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <>
      <div className="sk-sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={['sk-sheet', `sk-sheet--${side}`, className].filter(Boolean).join(' ')}
        onKeyDown={onKeyDown}
      >
        <div className="sk-sheet__head">
          <h2 id={titleId} className="sk-sheet__title">{title}</h2>
          {actions}
          <IconButton icon="cross-mark" label={kitT(lang, 'kit.sheet.close')} shortcut="Escape" onClick={onClose} />
        </div>
        <div className="sk-sheet__body">{children}</div>
      </div>
    </>,
    document.body,
  );
}

/** Drawer — Sheet справа (peek записи, панель свойств). */
export function Drawer(props: Omit<SheetProps, 'side'>) {
  return <Sheet {...props} side="right" />;
}
