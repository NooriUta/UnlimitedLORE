// «Вид ⌄» списка (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-27): дополнительные настройки вида в поповере,
// а не ещё одной полосой над таблицей. Скрин владелицы (прототип v4, «Вид ·
// дополнительно»): «Показывать закрытые — внизу, свёрнуты / все / за 30 дней /
// скрыть» и пояснение, что считается закрытым. Значение видно в самой кнопке.
// Поповер — диалог с ловушкой фокуса: Esc и щелчок мимо закрывают, фокус
// возвращается на кнопку. Выбор — radiogroup, применяется сразу.
import { useEffect, useId, useRef, useState } from 'react';
import type { KitShowClosed } from '../core/contract';
import type { RecordPlacement } from '../record/RecordDock';
import { ColumnsChoice, type ColumnChoice } from './ColumnsChoice';
import { kitT, useKitLang } from '../i18n';
import type { KitKey } from '../i18n';
import { useFocusTrap } from '../keyboard/focusTrap';

export interface ViewMenuProps {
  closed: KitShowClosed;
  modes: readonly KitShowClosed[];
  onClosed: (mode: KitShowClosed) => void;
  /** Где открывается паспорт записи — настройка использования, а не элемент паспорта (владелица 08.11). Без onPlace раздела нет. */
  place?: RecordPlacement;
  onPlace?: (p: RecordPlacement) => void;
  /**
   * Выбор колонок (S4-35): в прототипе владелицы раздел «Колонки» живёт в этом
   * же поповере «Вид», а не отдельной кнопкой рядом — настройки вида в одном
   * месте. Без onColumns раздела нет.
   */
  columns?: { all: readonly ColumnChoice[]; chosen: readonly string[] };
  onColumns?: (cols: string[]) => void;
}

const PLACES: readonly RecordPlacement[] = ['right', 'bottom', 'full'];

export function ViewMenu({ closed, modes, onClosed, place, onPlace, columns, onColumns }: ViewMenuProps) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
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
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const modeTitle = (m: KitShowClosed) => t(`kit.list.closed.${m}` as KitKey);

  return (
    <span ref={wrapRef} className="sk-vmenu">
      <button
        type="button"
        className="sk-list__dir sk-vmenu__btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(o => !o)}
      >
        {t('kit.list.viewMenu')} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div ref={panelRef} id={id} role="dialog" aria-label={t('kit.list.viewMenu')} className="sk-vmenu__panel" onKeyDown={onKeyDown}>
          <p className="sk-vmenu__title">{t('kit.list.viewMenuTitle')}</p>
          <div role="radiogroup" aria-label={t('kit.list.closed.label')} className="sk-vmenu__seg">
            <span className="sk-vmenu__label" aria-hidden="true">{t('kit.list.closed.label')}</span>
            {modes.map(m => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={m === closed}
                className={`sk-list__view${m === closed ? ' is-on' : ''}`}
                onClick={() => onClosed(m)}
              >
                {modeTitle(m)}
              </button>
            ))}
          </div>
          <p className="sk-vmenu__hint">{t('kit.list.closed.hint')}</p>
          {columns && onColumns && (
            <div className="sk-vmenu__cols">
              <ColumnsChoice all={columns.all} chosen={columns.chosen} onChange={onColumns} />
            </div>
          )}
          {onPlace && (
            <div role="radiogroup" aria-label={t('kit.list.place.label')} className="sk-vmenu__seg">
              <span className="sk-vmenu__label" aria-hidden="true">{t('kit.list.place.label')}</span>
              {PLACES.map(p => (
                <button key={p} type="button" role="radio" aria-checked={p === place}
                  className={`sk-list__view${p === place ? ' is-on' : ''}`} onClick={() => onPlace(p)}>
                  {t(`kit.list.place.${p}` as KitKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
