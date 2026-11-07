// Pill / Chip (S4-00b): скругление 999 (--r-pill). Три варианта:
//  - value  — значение (статус, тип, метка), только показ;
//  - id     — ID-пилюля записи, моноширинная;
//  - filter — фильтр-переключатель: кнопка с aria-pressed и, по желанию,
//             крестиком «снять» со своим именем (цель ≥ --tap на касании).
import type { CSSProperties, ReactNode } from 'react';

export type PillTone = 'acc' | 'suc' | 'wrn' | 'dng' | 'inf' | 't2' | 't3';

interface Base {
  children: ReactNode;
  /** Оттенок — имя токена (--acc, --dng, …), в CSS приходит как --pill-c. */
  tone?: PillTone;
  className?: string;
  title?: string;
}

interface StaticPill extends Base {
  variant?: 'value' | 'id';
}

interface FilterPill extends Base {
  variant: 'filter';
  pressed: boolean;
  onToggle?: (next: boolean) => void;
  onRemove?: () => void;
  /** Имя крестика «снять» — обязательно, если есть onRemove. */
  removeLabel?: string;
}

export type PillProps = StaticPill | FilterPill;

export function Pill(props: PillProps) {
  const { children, tone, className, title } = props;
  const variant = props.variant ?? 'value';
  const cls = ['sk-pill', `sk-pill--${variant}`, className].filter(Boolean).join(' ');
  const style = tone ? ({ '--pill-c': `var(--${tone})` } as CSSProperties) : undefined;

  if (props.variant !== 'filter') {
    return <span className={cls} style={style} title={title}>{children}</span>;
  }

  const { pressed, onToggle, onRemove, removeLabel } = props;
  if (onRemove && !removeLabel?.trim()) {
    throw new Error('Pill: у фильтра с onRemove обязателен removeLabel — крестик без имени не прочитать');
  }
  return (
    <span className={`${cls}${pressed ? ' is-on' : ''}`} style={style}>
      <button
        type="button"
        className="sk-pill__main"
        aria-pressed={pressed}
        title={title}
        onClick={() => onToggle?.(!pressed)}
      >
        {children}
      </button>
      {onRemove && (
        <button type="button" className="sk-pill__x" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  );
}

/** Chip — то же, что Pill (одно имя на элемент, второе — для привычки). */
export const Chip = Pill;
