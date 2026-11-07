// Ear — «ушко» (S4-00c): узкая вертикальная кнопка на краю свёрнутой колонки
// (меню слева, свойства/граф справа), как в прототипе v4. Подпись видимая —
// по ней понятно, что спрятано; aria-expanded/aria-controls связывают ушко с
// колонкой. Ширина — не меньше --tap на сенсоре.
import type { ButtonHTMLAttributes } from 'react';

export interface EarProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onToggle'> {
  /** Видимая подпись — что откроется. */
  label: string;
  /** С какого края прилегает (скругление внутрь страницы). */
  side?: 'left' | 'right';
  /** Колонка раскрыта? undefined — ушко без состояния. */
  expanded?: boolean;
  /** id колонки, которую ушко открывает. */
  controls?: string;
  onToggle?: () => void;
}

export function Ear({ label, side = 'right', expanded, controls, onToggle, onClick, className, type, ...rest }: EarProps) {
  return (
    <button
      type={type ?? 'button'}
      className={['sk-ear', `sk-ear--${side}`, className].filter(Boolean).join(' ')}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={e => { onClick?.(e); onToggle?.(); }}
      {...rest}
    >
      {label}
    </button>
  );
}
