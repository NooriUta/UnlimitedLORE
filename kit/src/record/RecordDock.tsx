// Место паспорта (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-33): панелью справа, снизу или на весь экран.
// Обёртка вокруг того же паспорта (RecordView placement) — сам паспорт от места не меняется,
// меняется только раскладка зон внутри него. Под панелью — то, поверх чего она открыта (список).
// «На весь экран» (владелица 08.11: «на весь экран не на весь экран») — слой поверх всей
// страницы (position: fixed), модальный диалог; выход — кнопкой и Esc (onExitFull).
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';
import { ResizeBorder, zoneSaved } from '../shell/ResizeBorder';
import { createSafeStorage } from '../resilience/safeStorage';
import type { WidthStore } from '../list/columnWidths';

/**
 * Пределы размера панели паспорта (S4-30).
 *
 * Умолчания — те же, что в seidr.css, чтобы «не тянули» выглядело как прежде:
 * справа min(560px, 45%), снизу — остаток после списка. Минимумы — чтобы в
 * панели оставалась читаемая запись, а не полоска; максимумы — чтобы список,
 * из которого запись открыта, не исчезал совсем: он живой (решение владелицы
 * 08.11), и «потянула до конца» не должно выглядеть как «список пропал».
 */
const PANEL_W = { def: 560, min: 320, max: 1100 };
const PANEL_H = { def: 420, min: 240, max: 900 };

/**
 * Потолок панели СБОКУ — доля ширины окна, а не число (владелица 11.11.2026:
 * «паспорт сбоку может раздвигаться на две трети экрана»). Число 1100 на
 * широком экране останавливало паспорт задолго до 2/3, а на узком позволяло
 * съесть почти весь список. Минимум остаётся числом: читаемость записи от
 * ширины окна не зависит.
 */
export const DOCK_SIDE_SHARE = 2 / 3;

/** Ширина окна и её изменения: потолок панели пересчитывается вместе с окном. */
function useWindowWidth(): number {
  const read = () => (typeof window === 'undefined' ? 0 : window.innerWidth);
  const [w, setW] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => setW(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

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
  /**
   * Модальный ли слой «во весь экран». По умолчанию да — витрина и демо
   * открывают его поверх окна. Внутри оболочки шапка и меню остаются видимыми
   * и рабочими (замечание владелицы по v1.17.4), и тогда aria-modal был бы
   * ложью: скринридер объявил бы шапку и меню несуществующими.
   */
  modal?: boolean;
  /** Хранилище личных размеров зон (S4-30); нет — размер живёт до перезагрузки. */
  widthStore?: WidthStore;
}

export function RecordDock({ placement, backdrop, children, className, onExitFull, onClose, modal = true, widthStore }: RecordDockProps) {
  const lang = useKitLang();
  const full = placement === 'full';
  // S4-30: список и паспорт делят место, и границу между ними можно тянуть.
  // Личный размер — в хранилище, как ширина колонки списка.
  const store = useMemo(() => widthStore ?? createSafeStorage(), [widthStore]);
  const vertical = placement === 'bottom';
  const winW = useWindowWidth();
  // Сбоку потолок — 2/3 окна, но не ниже минимума. Окна нет (SSR) — прежнее число.
  const sideMax = winW > 0 ? Math.max(PANEL_W.min, Math.round(winW * DOCK_SIDE_SHARE)) : PANEL_W.max;
  const lim = vertical ? PANEL_H : { ...PANEL_W, max: sideMax };
  const zone = vertical ? 'dock.panel.h' : 'dock.panel.w';
  const saved = zoneSaved(store, zone);
  const [size, setSize] = useState(saved ?? lim.def);
  // Запомненный размер — чужое число (хранилище, прежнее окно): рисуем его в
  // пределах ТЕКУЩЕГО окна, иначе сузившееся окно отдало бы панели всё место.
  const shown = Math.max(lim.min, Math.min(lim.max, size));
  // «Не тянули» ≠ «поставила умолчание»: пока не тянули, работает правило
  // раскладки из seidr.css (панель справа — min(560px, 45%), снизу — остаток
  // после списка «по содержимому, но не больше 40 %»). Личный размер его
  // отменяет, и отменять его у того, кто границу не трогал, нельзя.
  const [sized, setSized] = useState(saved !== undefined);
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
      data-sized={sized && !full ? (vertical ? 'h' : 'w') : undefined}
      style={sized && !full ? ({ [vertical ? '--dock-panel-h' : '--dock-panel-w']: `${shown}px` } as CSSProperties) : undefined}
      {...(full && modal ? { role: 'dialog', 'aria-modal': 'true', 'aria-label': kitT(lang, 'kit.record.dock.full') } : {})}>
      {/* Список под паспортом живой: своя прокрутка, щелчок по другой записи (08.11). */}
      {!full && backdrop && <div className="sk-dock__backdrop">{backdrop}</div>}
      {/* Граница списка и паспорта (S4-30). Только когда делить есть с кем: во
          весь экран списка нет, и ручка там обещала бы управление, которого
          нет. Панель лежит ПОСЛЕ границы в обоих местах — справа и снизу. */}
      {!full && backdrop && (
        <ResizeBorder
          zone={zone}
          className="sk-dock__resize"
          axis={vertical ? 'y' : 'x'}
          side="after"
          size={shown}
          min={lim.min}
          max={lim.max}
          store={store}
          onSize={v => { setSize(v); setSized(true); }}
          label={kitT(lang, vertical ? 'kit.record.dock.heightBottom' : 'kit.record.dock.widthRight')}
        />
      )}
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
