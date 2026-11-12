// Меню «Порядок» (разбор скрина владелицы 08.11): вместо системного <select> —
// тот же поповер, что у «Группировки» (GroupMenu): значение в кнопке, пункты —
// radio с ✓, Esc и щелчок мимо закрывают. Системный список рисовался чужим
// шрифтом и стрелкой ОС и выбивался из полосы.
import { useId, useRef, useState } from 'react';
import { kitT, useKitLang } from '../i18n';
import { useFocusTrap } from '../keyboard/focusTrap';
import { MenuPanel } from './MenuPanel';
import { Sheet } from '../shell/Sheet';
import { checkedRadio } from './ViewMenu';

export interface SortMenuProps {
  /** Ключ порядка (null — как пришло). */
  value: string | null;
  keys: string[];
  keyTitle: (key: string) => string;
  onChange: (key: string | null) => void;
  /** Узкий экран (≤720, от ListView): панель — нижним листом (S4-MOBILE-EDGE). */
  narrow?: boolean;
}

export function SortMenu({ value, keys, keyTitle, onChange, narrow = false }: SortMenuProps) {
  const lang = useKitLang();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  // На листе ловушку, Esc и «мимо» ведёт сам Sheet; в поповере — MenuPanel.
  const onKeyDown = useFocusTrap(panelRef, {
    active: open && !narrow,
    initialFocus: checkedRadio,
    onEscape: () => setOpen(false),
  });
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
  const body = (
    <div role="radiogroup" aria-label={name} className="sk-gmenu__sec">
      {radio(null, kitT(lang, 'kit.list.sortNone'))}
      {keys.map(k => radio(k, keyTitle(k)))}
    </div>
  );
  return (
    <span ref={wrapRef} className="sk-gmenu">
      <button type="button" className="sk-list__dir sk-gmenu__btn" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open && !narrow ? id : undefined} aria-label={`${name}: ${title}`} onClick={() => setOpen(o => !o)}>
        <b>{title}</b> <span aria-hidden="true">▾</span>
      </button>
      {open && narrow && (
        <Sheet open onClose={() => setOpen(false)} title={name} side="bottom" className="sk-lsheet" initialFocus={checkedRadio}>
          {body}
        </Sheet>
      )}
      {open && !narrow && (
        <MenuPanel panelRef={panelRef} id={id} label={name} className="sk-gmenu__panel" anchor={wrapRef.current} onKeyDown={onKeyDown} onClose={() => setOpen(false)}>
          {body}
        </MenuPanel>
      )}
    </span>
  );
}
