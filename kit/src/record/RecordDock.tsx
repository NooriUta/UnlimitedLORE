// Место паспорта (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-33): панелью справа, снизу или на весь экран.
// Обёртка вокруг того же паспорта (RecordView placement) — сам паспорт от места не меняется,
// меняется только раскладка зон внутри него. Под панелью — то, поверх чего она открыта (список).
import type { ReactNode } from 'react';

export type RecordPlacement = 'right' | 'bottom' | 'full';

export interface RecordDockProps {
  placement: RecordPlacement;
  /** Что под панелью — обычно список, из которого открыли запись. */
  backdrop?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function RecordDock({ placement, backdrop, children, className }: RecordDockProps) {
  return (
    <div className={['sk-dock', className].filter(Boolean).join(' ')} data-placement={placement} data-testid="kit-rec-dock">
      {placement !== 'full' && backdrop && <div className="sk-dock__backdrop" aria-hidden="true">{backdrop}</div>}
      <section className="sk-dock__panel">{children}</section>
    </div>
  );
}
