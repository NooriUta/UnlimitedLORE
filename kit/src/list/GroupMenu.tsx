// Поповер «Группировка» (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-26) — по скрину прототипа v4.
// Значение живёт в кнопке: «Группировка: Статус ▾» (правило «значение — в
// контроле, а не в метке рядом»). В поповере — группа (одна на список, доску и
// таймлайн), разрезы по связям отдельным разделом, подгруппа «внутри „…“» и
// пояснение. Иконок у пунктов нет: по правилу S4-25 иконки — только из канона
// LORE v1, а у полей группировки его нет. Выбранное — ✓ и aria-checked.
import { useEffect, useId, useRef, useState } from 'react';
import { kitT, useKitLang } from '../i18n';
import type { KitKey } from '../i18n';
import { useFocusTrap } from '../keyboard/focusTrap';
import { Sheet } from '../shell/Sheet';
import type { GroupingOptions } from './grouping';
import { checkedRadio } from './ViewMenu';

export interface GroupMenuProps {
  /** Текущая группа (null — без группировки). */
  group: string | null;
  /** Текущая подгруппа (null — без). */
  sub: string | null;
  options: GroupingOptions;
  /** Показывать раздел подгруппы (в списке — да, на доске — нет). */
  withSub: boolean;
  keyTitle: (key: string) => string;
  /** Смена группы; подгруппу, ставшую лишней (нет группы или совпала с ней), снимает ВЫЗЫВАЮЩИЙ одной правкой. */
  onGroup: (key: string | null) => void;
  onSub: (key: string | null) => void;
  /** В рамке сегмента с подписью «Группировка» (08.11): в кнопке только значение, имя — в aria-label. */
  bare?: boolean;
  /** Узкий экран (≤720, от ListView): панель — нижним листом (S4-MOBILE-EDGE). */
  narrow?: boolean;
}

export function GroupMenu({ group, sub, options, withSub, keyTitle, onGroup, onSub, bare, narrow = false }: GroupMenuProps) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  // На листе ловушку, Esc и «мимо» ведёт сам Sheet.
  const onKeyDown = useFocusTrap(panelRef, {
    active: open && !narrow,
    initialFocus: checkedRadio,
    onEscape: () => setOpen(false),
  });

  useEffect(() => {
    if (!open || narrow) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, narrow]);

  const value = group ? keyTitle(group) : t('kit.list.groupNone');
  const radio = (key: string | null, title: string, checked: boolean, pick: () => void) => (
    <button key={key ?? '—'} type="button" role="radio" aria-checked={checked} className={`sk-gmenu__opt${checked ? ' is-on' : ''}`} onClick={pick}>
      <span>{title}</span>
      {checked && <span className="sk-gmenu__check" aria-hidden="true">✓</span>}
    </button>
  );
  const subKeys = options.fields.filter(k => k !== group);

  const body = (
        <>
          <div role="radiogroup" aria-label={t('kit.list.groupMenu.main')} className="sk-gmenu__sec">
            <p className="sk-vmenu__title" aria-hidden="true">{t('kit.list.groupMenu.main')}</p>
            {radio(null, t('kit.list.groupNone'), group === null, () => onGroup(null))}
            {options.fields.map(k => radio(k, keyTitle(k), group === k, () => onGroup(k)))}
          </div>
          {options.relations.length > 0 && (
            <div role="radiogroup" aria-label={t('kit.list.groupRels')} className="sk-gmenu__sec">
              <p className="sk-vmenu__title" aria-hidden="true">{t('kit.list.groupRels')}</p>
              {options.relations.map(p => radio(p.key, keyTitle(p.key), group === p.key, () => onGroup(p.key)))}
            </div>
          )}
          {withSub && group !== null && subKeys.length > 0 && (
            <div role="radiogroup" aria-label={t('kit.list.groupMenu.sub', { group: value })} className="sk-gmenu__sec">
              <p className="sk-vmenu__title" aria-hidden="true">{t('kit.list.groupMenu.sub', { group: value })}</p>
              {radio(null, t('kit.list.groupMenu.subNone'), !sub, () => onSub(null))}
              {subKeys.map(k => radio(k, keyTitle(k), sub === k, () => onSub(k)))}
            </div>
          )}
          <p className="sk-vmenu__hint">{t('kit.list.groupMenu.hint')}</p>
        </>
  );

  return (
    <span ref={wrapRef} className="sk-gmenu">
      <button
        type="button"
        className="sk-list__dir sk-gmenu__btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open && !narrow ? id : undefined}
        onClick={() => setOpen(o => !o)}
        aria-label={bare ? `${t('kit.list.group')}: ${value}` : undefined}
      >
        {bare ? <b>{value}</b> : <>{t('kit.list.group')}: <b>{value}</b></>} <span aria-hidden="true">▾</span>
      </button>
      {open && narrow && (
        <Sheet open onClose={() => setOpen(false)} title={t('kit.list.group')} side="bottom" className="sk-lsheet" initialFocus={checkedRadio}>
          {body}
        </Sheet>
      )}
      {open && !narrow && (
        <div ref={panelRef} id={id} role="dialog" aria-label={t('kit.list.group')} className="sk-vmenu__panel sk-gmenu__panel" onKeyDown={onKeyDown}>
          {body}
        </div>
      )}
    </span>
  );
}
