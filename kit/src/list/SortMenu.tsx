// Меню «Порядок» (разбор скрина владелицы 08.11): вместо системного <select> —
// тот же поповер, что у «Группировки» (GroupMenu): значение в кнопке, пункты —
// radio с ✓, Esc и щелчок мимо закрывают. Системный список рисовался чужим
// шрифтом и стрелкой ОС и выбивался из полосы.
import { useEffect, useId, useRef, useState } from 'react';
import { kitT, useKitLang } from '../i18n';
import { useFocusTrap } from '../keyboard/focusTrap';

export interface SortMenuProps {
  /** Ключ порядка (null — как пришло). */
  value: string | null;
  keys: string[];
  keyTitle: (key: string) => string;
  onChange: (key: string | null) => void;
}

export function SortMenu({ value, keys, keyTitle, onChange }: SortMenuProps) {
  const lang = useKitLang();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const onKeyDown = useFocusTrap(panelRef, {
    active: open,
    initialFocus: root => root.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]'),
    onEscape: () => setOpen(false),
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const name = kitT(lang, 'kit.list.sort');
  const title = value ? keyTitle(value) : kitT(lang, 'kit.list.sortNone');
  const radio = (key: string | null, label: string) => {
    const on = key === value;
    return (
      <button key={key ?? '—'} type="button" role="radio" aria-checked={on} className={`sk-gmenu__opt${on ? ' is-on' : ''}`}
        onClick={() => { onChange(key); setOpen(false); }}>
        <span>{label}</span>
        {on && <span className="sk-gmenu__check" aria-hidden="true">✓</span>}
      </button>
    );
  };
  return (
    <span ref={wrapRef} className="sk-gmenu">
      <button type="button" className="sk-list__dir sk-gmenu__btn" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? id : undefined} aria-label={`${name}: ${title}`} onClick={() => setOpen(o => !o)}>
        <b>{title}</b> <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div ref={panelRef} id={id} role="dialog" aria-label={name} className="sk-vmenu__panel sk-gmenu__panel" onKeyDown={onKeyDown}>
          <div role="radiogroup" aria-label={name} className="sk-gmenu__sec">
            {radio(null, kitT(lang, 'kit.list.sortNone'))}
            {keys.map(k => radio(k, keyTitle(k)))}
          </div>
        </div>
      )}
    </span>
  );
}
