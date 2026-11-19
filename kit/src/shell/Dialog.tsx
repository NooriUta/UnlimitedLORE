// Dialog — окно по центру; ReasonDialog — подтверждение с обязательной причиной
// (SPRINT_LORE_MODEL_AS_CONFIG/MC-06).
//
// Sheet — панель сбоку, для просмотра записи и фильтров. Окно по центру — для действия, которое
// надо довести до конца или отменить: правка одного поля, «Применить…» с причиной. На узком экране
// (общий порог kit, NARROW_QUERY) окно занимает весь экран — правило в seidr.css.
// Фокус, Esc и подложка — тот же хук ловушки фокуса, что у Sheet (useFocusTrap).
import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../elements/IconButton';
import { kitT, useKitLang } from '../i18n';
import { focusables, useFocusTrap } from '../keyboard/focusTrap';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Заголовок — он же имя диалога. */
  title: string;
  children?: ReactNode;
  /** Кнопки внизу окна. */
  actions?: ReactNode;
  /** «wide» — для форм в две колонки. */
  size?: 'normal' | 'wide';
  className?: string;
}

export function Dialog({ open, onClose, title, children, actions, size = 'normal', className }: DialogProps) {
  const lang = useKitLang();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onKeyDown = useFocusTrap(panel, {
    active: open,
    onEscape: onClose,
    initialFocus: root => {
      const body = root.querySelector<HTMLElement>('.sk-dialog__body');
      return body ? focusables(body)[0] : null;
    },
  });
  if (!open) return null;
  return createPortal(
    <>
      <div className="sk-dialog-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={['sk-dialog', size === 'wide' ? 'sk-dialog--wide' : null, className].filter(Boolean).join(' ')}
        onKeyDown={onKeyDown}
      >
        <div className="sk-dialog__head">
          <h2 id={titleId} className="sk-dialog__title">{title}</h2>
          <IconButton icon="cross-mark" label={kitT(lang, 'kit.dialog.close')} shortcut="Escape" onClick={onClose} />
        </div>
        <div className="sk-dialog__body">{children}</div>
        {actions && <div className="sk-dialog__actions">{actions}</div>}
      </div>
    </>,
    document.body,
  );
}

export interface ReasonDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Подпись кнопки подтверждения — от приложения: «Применить», «Откатить». */
  confirmLabel: string;
  /** Подтверждено с причиной (обрезанной по краям). */
  onConfirm: (reason: string) => void;
  /** Подпись поля причины; по умолчанию — «Причина». */
  reasonLabel?: string;
  placeholder?: string;
  /** Идёт запись: кнопка занята. */
  busy?: boolean;
  /** Отказ сервера — словами, role=alert. */
  error?: string | null;
  /** Что произойдёт — текстом приложения. */
  children?: ReactNode;
}

/**
 * Подтверждение с причиной: без «что и зачем» действие не выполняется. Пробелы — не причина.
 * Поле причины — однострочное: причина уходит в историю версии строкой, а не документом.
 */
export function ReasonDialog({ open, onClose, title, confirmLabel, onConfirm, reasonLabel, placeholder, busy, error, children }: ReasonDialogProps) {
  const lang = useKitLang();
  const [reason, setReason] = useState('');
  const fieldId = useId();
  const ready = reason.trim() !== '' && !busy;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      actions={(
        <>
          <button type="button" className="sk-btn" onClick={onClose}>{kitT(lang, 'kit.dialog.cancel')}</button>
          <button type="button" className="sk-btn sk-btn--primary" disabled={!ready} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</button>
        </>
      )}
    >
      {children && <div className="sk-dialog__lead">{children}</div>}
      <label className="sk-dialog__field" htmlFor={fieldId}>{reasonLabel ?? kitT(lang, 'kit.dialog.reason')}</label>
      <input id={fieldId} className="sk-dialog__input" value={reason} placeholder={placeholder}
        onChange={e => setReason(e.target.value)} data-testid="kit-reason-input" />
      {error && <p className="sk-dialog__error" role="alert">{error}</p>}
    </Dialog>
  );
}
