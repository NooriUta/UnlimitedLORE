// Третий шаг смены статуса (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-07): завершающий
// статус (done/closed/cancelled) ставится только после явного подтверждения.
// Общий для палитры звезды и поповера ядра — одно правило, один вид.
// Фокус сразу на «Поставить», Esc — назад к меню (обрабатывает палитра).
import { useEffect, useId, useRef } from 'react';
import type { CSSProperties } from 'react';
import { kitT, useKitLang } from '../i18n';
import { GameIcon } from './GameIcon';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface StatusConfirmProps {
  /** Подпись статуса для человека. */
  title: string;
  /** Код статуса — в data-status кнопки. */
  code: string;
  /** Слаг game-icons или символ. */
  icon: string;
  /** Цвет — токен var(--…). */
  color: string;
  onConfirm: () => void;
  onBack: () => void;
}

export function StatusConfirm({ title, code, icon, color, onConfirm, onBack }: StatusConfirmProps) {
  const lang = useKitLang();
  const qid = useId();
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    okRef.current?.focus();
  }, []);

  return (
    <div role="group" aria-labelledby={qid} className="sk-sconf" style={{ '--schip-c': color } as CSSProperties}>
      <p id={qid} className="sk-sconf__q">{kitT(lang, 'kit.status.confirm', { title })}</p>
      <button ref={okRef} type="button" className="sk-sconf__do" data-status={code} onClick={onConfirm}>
        {SLUG.test(icon)
          ? <GameIcon slug={icon} size={14} />
          : <span className="sk-glyph" data-glyph={icon} aria-hidden="true" />}
        <span>{kitT(lang, 'kit.status.confirmDo', { title })}</span>
      </button>
      <button type="button" className="sk-sconf__back" onClick={onBack}>
        {kitT(lang, 'kit.status.back')}
      </button>
    </div>
  );
}
