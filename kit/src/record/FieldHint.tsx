// Подсказка у подписи поля (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-07, «аналог peek» — владелица 16.11).
// Модель знает про поле больше, чем подпись: полное название, определение, описание. Подпись с ними
// помечена пунктиром и ⓘ; наведение и фокус открывают карточку, Esc закрывает (WCAG 1.4.13), нажатие
// переключает — на телефоне наведения нет. Нет ни определения, ни описания — подпись как раньше.
import { useId, useState } from 'react';

export interface FieldHintText { definition?: string; description?: string }

export function hasFieldHint(h: FieldHintText | undefined): h is FieldHintText {
  return !!(h && (h.definition || h.description));
}

export function FieldHint({ fieldKey, label, hint }: { fieldKey: string; label: string; hint: FieldHintText }) {
  const id = useId();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const close = () => { setHover(false); setPinned(false); };
  return (
    <span className="sk-fhint">
      <span
        className="sk-fhint__label" tabIndex={0} data-testid={`kit-field-hint-${fieldKey}`}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)} onBlur={close}
        onClick={() => { if (pinned) close(); else setPinned(true); }}
        onKeyDown={e => {
          if (e.key === 'Escape') close();
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPinned(p => !p); }
        }}
      >{label}<span className="sk-fhint__mark" aria-hidden="true">ⓘ</span></span>
      {open && (
        <span role="tooltip" id={id} className="sk-fhint__card">
          <span className="sk-fhint__title">{label}</span>
          {hint.definition && <span className="sk-fhint__def">{hint.definition}</span>}
          {hint.description && <span className="sk-fhint__desc">{hint.description}</span>}
        </span>
      )}
    </span>
  );
}
