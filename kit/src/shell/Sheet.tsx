// Sheet / Drawer (S4-00c): модальная панель — справа (drawer, peek записи),
// слева или снизу (лист «Фильтр и группировка» на телефоне).
// Как в прототипе v4: фокус внутрь при открытии, ловушка Tab, Esc и подложка
// закрывают, фокус возвращается на кнопку-открыватель. Рендер — порталом в
// body: модалка не должна зависеть от overflow/z-index того, кто её открыл.
// S4-11: ловушка фокуса — общий хук kit (useFocusTrap), тот же, что у меню
// статуса и окон приложений.
import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../elements/IconButton';
import { kitT, useKitLang } from '../i18n';
import { focusables, useFocusTrap } from '../keyboard/focusTrap';

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

export function Sheet({ open, onClose, title, side = 'right', actions, children, className }: SheetProps) {
  const lang = useKitLang();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  const onKeyDown = useFocusTrap(panel, {
    active: open,
    onEscape: onClose,
    // Первый элемент тела, а не «Закрыть»: открыли ради содержимого.
    initialFocus: root => {
      const body = root.querySelector<HTMLElement>('.sk-sheet__body');
      return body ? focusables(body)[0] : null;
    },
  });

  if (!open) return null;

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
