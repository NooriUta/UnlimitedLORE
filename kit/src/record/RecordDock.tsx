// Место паспорта (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-33): панелью справа, снизу или на весь экран.
// Обёртка вокруг того же паспорта (RecordView placement) — сам паспорт от места не меняется,
// меняется только раскладка зон внутри него. Под панелью — то, поверх чего она открыта (список).
// «На весь экран» (владелица 08.11: «на весь экран не на весь экран») — слой поверх всей
// страницы (position: fixed), модальный диалог; выход — кнопкой и Esc (onExitFull).
import { useEffect, type ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';

export type RecordPlacement = 'right' | 'bottom' | 'full';

export interface RecordDockProps {
  placement: RecordPlacement;
  /** Что под панелью — обычно список, из которого открыли запись. */
  backdrop?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Выход из полного экрана (кнопка и Esc). Без него кнопки нет — выход за приложением. */
  onExitFull?: () => void;
}

export function RecordDock({ placement, backdrop, children, className, onExitFull }: RecordDockProps) {
  const lang = useKitLang();
  const full = placement === 'full';
  useEffect(() => {
    if (!full || !onExitFull) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onExitFull(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full, onExitFull]);
  return (
    <div className={['sk-dock', className].filter(Boolean).join(' ')} data-placement={placement} data-testid="kit-rec-dock"
      {...(full ? { role: 'dialog', 'aria-modal': 'true', 'aria-label': kitT(lang, 'kit.record.dock.full') } : {})}>
      {!full && backdrop && <div className="sk-dock__backdrop" aria-hidden="true">{backdrop}</div>}
      {full && onExitFull && (
        <button type="button" className="sk-dock__exit" onClick={onExitFull} title="Esc">{kitT(lang, 'kit.record.dock.exitFull')}</button>
      )}
      <section className="sk-dock__panel">{children}</section>
    </div>
  );
}
