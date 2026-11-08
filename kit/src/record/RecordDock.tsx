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
  /** Закрыть паспорт — кнопка дока, а не полоса над паспортом (владелица 08.11). */
  onClose?: () => void;
}

export function RecordDock({ placement, backdrop, children, className, onExitFull, onClose }: RecordDockProps) {
  const lang = useKitLang();
  const full = placement === 'full';
  // Esc выходит из слоя — находка P0 аудита навигации 08.11.2026: «Esc не
  // закрывает ни палитру, ни док». Слушатель висел только в полном экране, и в
  // доке справа/снизу клавиши не было вовсе.
  //
  // Полный экран и закрытие — разные действия: из полного экрана Esc
  // возвращает запись в док, и только если возвращать некуда (onExitFull не
  // передан), закрывает её. Иначе одна клавиша и уводила бы из режима, и
  // теряла запись — выбрать, что именно случилось, человек бы не смог.
  //
  // Уже обработанное событие (defaultPrevented) не трогаем: Esc во вложенном
  // редакторе отменяет правку, и закрывать паспорт вместе с несохранённым
  // текстом нельзя.
  useEffect(() => {
    const exit = full && onExitFull ? onExitFull : onClose;
    if (!exit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.code !== 'Escape') return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      exit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full, onExitFull, onClose]);
  return (
    <div className={['sk-dock', className].filter(Boolean).join(' ')} data-placement={placement} data-testid="kit-rec-dock"
      {...(full ? { role: 'dialog', 'aria-modal': 'true', 'aria-label': kitT(lang, 'kit.record.dock.full') } : {})}>
      {/* Список под паспортом живой: своя прокрутка, щелчок по другой записи (08.11). */}
      {!full && backdrop && <div className="sk-dock__backdrop">{backdrop}</div>}
      {full && onExitFull && (
        <button type="button" className="sk-dock__exit" onClick={onExitFull} title="Esc">{kitT(lang, 'kit.record.dock.exitFull')}</button>
      )}
      <section className="sk-dock__panel">
        {onClose && (
          <button type="button" className="sk-dock__close" onClick={onClose} aria-label={kitT(lang, 'kit.record.dock.close')} title={kitT(lang, 'kit.record.dock.close')}>×</button>
        )}
        {children}
      </section>
    </div>
  );
}
