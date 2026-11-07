// Tooltip (S4-00b): подсказка по наведению И по фокусу (клавиатура не хуже
// мыши), Esc закрывает (WCAG 1.4.13). Подсказка связана с элементом через
// aria-describedby, а не заменяет его имя: имя у кнопки должно быть своё.
import { cloneElement, useId, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactElement } from 'react';

type TriggerProps = {
  'aria-describedby'?: string;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
};

export interface TooltipProps {
  text: string;
  /** Один элемент-триггер (кнопка, ссылка, пилюля). */
  children: ReactElement<TriggerProps>;
  placement?: 'top' | 'bottom';
}

export function Tooltip({ text, children, placement = 'top' }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const p = children.props;
  const describedBy = [p['aria-describedby'], open ? id : undefined].filter(Boolean).join(' ') || undefined;

  const trigger = cloneElement(children, {
    'aria-describedby': describedBy,
    onMouseEnter: e => { p.onMouseEnter?.(e); setOpen(true); },
    onMouseLeave: e => { p.onMouseLeave?.(e); setOpen(false); },
    onFocus: e => { p.onFocus?.(e); setOpen(true); },
    onBlur: e => { p.onBlur?.(e); setOpen(false); },
    onKeyDown: e => { p.onKeyDown?.(e); if (e.key === 'Escape') setOpen(false); },
  });

  return (
    <span className="sk-tip-wrap">
      {trigger}
      {open && (
        <span role="tooltip" id={id} className={`sk-tip sk-tip--${placement}`}>{text}</span>
      )}
    </span>
  );
}
