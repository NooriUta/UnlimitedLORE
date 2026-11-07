// StatusStar (S4-00b, D-2026-UXR-STATUS-AXIS): статус внутри списков и записей —
// всегда «звезда»: иконка и постоянный цвет --st-* статуса, категория в
// data-category (по ней группирует доска и палитра). Со сменой (onOpen) это
// кнопка, открывающая палитру статусов (сама палитра «2 касания» — S4-07);
// без смены — role=img с именем.
import type { CSSProperties } from 'react';
import { GameIcon } from './GameIcon';
import { statusMeta } from './statusMeta';

export interface StatusStarProps {
  status: string | null | undefined;
  /** Имя для чтения, например «Статус: в работе» (локализует вызывающий). */
  label: string;
  /** Показать текст label рядом с иконкой. */
  showLabel?: boolean;
  /** Открыть палитру смены статуса — делает звезду кнопкой. */
  onOpen?: () => void;
  /** Палитра открыта — aria-expanded у кнопки (только вместе с onOpen). */
  expanded?: boolean;
  size?: number;
  className?: string;
}

export function StatusStar({ status, label, showLabel, onOpen, expanded, size = 14, className }: StatusStarProps) {
  const meta = statusMeta(status);
  const style = { '--star-c': meta.color } as CSSProperties;
  const cls = ['sk-star', onOpen ? 'sk-star--btn' : '', className].filter(Boolean).join(' ');
  const body = (
    <>
      <GameIcon slug={meta.icon} size={size} />
      {showLabel && <span className="sk-star__label" aria-hidden="true">{label}</span>}
    </>
  );
  const common = {
    className: cls,
    style,
    'data-status': meta.code,
    'data-category': meta.category,
  };
  if (onOpen) {
    return (
      <button type="button" {...common} aria-label={label} aria-haspopup="menu" aria-expanded={expanded ?? false} title={label} onClick={onOpen}>
        {body}
      </button>
    );
  }
  return (
    <span {...common} role="img" aria-label={label} title={label}>
      {body}
    </span>
  );
}
