// ОДИН ОБЩИЙ ПОПОВЕР (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MENU-STATES, долг).
//
// Долг назвал сам код: RailMenu в KitShell писал «в kit их уже три (палитра
// статусов, „Ещё“ у вкладок, и это), и общий поповер стоит завести отдельно».
//
// ЧТО СВОДИТСЯ, А ЧТО НЕТ. Сводится ОБОЛОЧКА всплывающего слоя: положение,
// край экрана, Esc, щелчок вне, ловушка фокуса, возврат фокуса открывателю,
// ходьба стрелками. У трёх меню она различалась случайно — у каждого свой
// огрызок: у «Ещё» не было ни щелчка вне, ни фокуса, ни стрелок; у рейки — ни
// ловушки, ни возврата фокуса; полный набор был только у меню статуса.
//
// НЕ сводится СОДЕРЖИМОЕ и его роли — они различаются по существу:
//   • меню статуса — пункты плюс «Отмена» и третий шаг (подтверждение), и
//     «Отмена» обязана лежать ВНЕ role=menu: она не menuitem. Поэтому роль
//     задаётся не всегда у корня — такой вызов просто не передаёт `role`;
//   • «Ещё» у вкладок — корень и есть role=menu, но его ОТКРЫВАТЕЛЬ живёт
//     внутри role=tablist и обязан быть role=tab (обычная кнопка там валит
//     axe: aria-required-children);
//   • меню рейки — внутри ССЫЛКИ на записи и виды, поэтому role=group:
//     объявить меню и положить внутрь ссылки значит соврать скринридеру о том,
//     что это за элемент, и отнять у ссылок их поведение (новая вкладка,
//     копировать адрес). Стрелки там ходят по ссылкам (`walk="focusable"`).
//
// Поповер МОНТИРУЕТСЯ открытым: все три места и раньше рисовали его условно
// (`{open && …}`), а «смонтирован, но закрыт» завёл бы второе состояние, за
// которым пришлось бы следить ещё и ловушке фокуса.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { focusables, useFocusTrap } from '../keyboard/focusTrap';
import { NARROW_QUERY } from '../core/narrow';

/**
 * Куда растёт поповер.
 *
 * `start`/`end` — вниз от якоря, прижат к его левому/правому краю.
 * `side` — вправо от якоря (рейка шириной в иконку: вниз было бы обрезано).
 * `under` — на СВОЁМ месте в потоке, прижат вправо: для случая, когда поповер
 *   обязан лежать сиблингом, а не внутри якоря. Так у свёртки вкладок:
 *   `role="menu"` внутри `role="tablist"` валит axe (aria-required-children),
 *   а обёртку вокруг ряда поставить нельзя — на прямого ребёнка корня
 *   опирается липкий ряд записи. Вертикально такой поповер не переворачивается:
 *   его место задаёт поток, а не замер.
 */
export type PopoverAlign = 'start' | 'end' | 'side' | 'under';
/** По чему ходят стрелки: по пунктам меню или по любому фокусируемому (ссылки). */
export type PopoverWalk = 'menuitem' | 'focusable';

const MENUITEMS = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';
/** Зазор до края экрана, px: геометрия замера, не размер оформления. */
const GAP = 4;

/**
 * Где встать слою рейки (PU-26), в координатах окна: справа от якоря; не
 * влез — слева от него; дальше прижим к краям окна с зазором. По вертикали —
 * от верха якоря, не влез вниз — поднимается. Чистая функция: её и проверяем.
 */
export function sidePlace(
  a: { left: number; right: number; top: number },
  size: { width: number; height: number },
  vw: number,
  vh: number,
): { x: number; y: number } {
  let x = a.right + GAP;
  if (x + size.width > vw - GAP) x = a.left - GAP - size.width;
  x = Math.max(GAP, Math.min(x, vw - GAP - size.width));
  let y = a.top;
  if (y + size.height > vh - GAP) y = vh - GAP - size.height;
  y = Math.max(GAP, y);
  return { x: Math.round(x), y: Math.round(y) };
}

export interface PopoverProps {
  /** Закрыть: Esc и щелчок вне. Вызывающий сам решает, возвращать ли фокус. */
  onClose: () => void;
  /** Роль корня, когда корень и есть содержимое. Нет — роль ставит вызывающий внутри. */
  role?: 'menu' | 'group';
  /** Имя поповера; обязательно вместе с `role`. */
  label?: string;
  /** Id поповера — им открыватель называет связь (aria-controls). */
  id?: string;
  align?: PopoverAlign;
  walk?: PopoverWalk;
  /** Стрелки ходят по пунктам (по умолчанию да; третий шаг меню статуса — нет). */
  arrows?: boolean;
  /** Щелчок вне закрывает (по умолчанию да). */
  closeOnOutside?: boolean;
  /** Вернуть фокус открывателю при закрытии (по умолчанию да, см. ниже). */
  restoreFocus?: boolean;
  /** Куда ставить фокус при открытии; нет — первый пункт, иначе первый фокусируемый. */
  initialFocus?: (root: HTMLElement) => HTMLElement | null | undefined;
  /**
   * Забирать фокус при открытии (по умолчанию да — меню). false — подсказка ПОСРЕДИ набора
   * (мини-окно ссылки в MD, MD-WINDOW): фокус остаётся у поля, иначе следующая буква ушла бы
   * в поповер. Esc внутри, щелчок вне и край экрана работают как обычно.
   */
  takeFocus?: boolean;
  /** Свой разбор клавиш ПЕРЕД общим: preventDefault останавливает общий. */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLElement>) => void;
  className?: string;
  children?: ReactNode;
}

export function Popover({
  onClose, role, label, id, align = 'start', walk = 'menuitem', arrows = true,
  closeOnOutside = true, restoreFocus = true, initialFocus, takeFocus = true, onKeyDown, className, children,
}: PopoverProps) {
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const latest = useRef({ onClose, restoreFocus, id });
  useEffect(() => { latest.current = { onClose, restoreFocus, id }; });

  const [dx, setDx] = useState(0);
  const [up, setUp] = useState(false);
  const [xy, setXY] = useState<{ x: number; y: number } | null>(null);
  const [sheet, setSheet] = useState(false);

  // Открывателя запоминаем ДО ловушки фокуса (она сейчас же уведёт фокус
  // внутрь), поэтому этот эффект объявлен раньше useFocusTrap.
  //
  // Возврат фокуса — УМНЫЙ, и это не придирка. Вернуть его безусловно нельзя:
  // при щелчке мимо фокус должен остаться там, куда щёлкнули (правило чипа
  // статуса, S4-11), иначе поповер отбирает фокус у поля, в которое человек
  // только что ткнул. Не возвращать совсем тоже нельзя: после Esc фокус
  // остался бы в никуда. Поэтому возвращаем ровно тогда, когда фокус был
  // внутри закрываемого поповера (или нигде) — то есть забирать его не у кого.
  useEffect(() => {
    const panel = root.current;
    const was = document.activeElement;
    opener.current = was instanceof HTMLElement && was !== document.body ? was : null;
    return () => {
      const back = opener.current;
      opener.current = null;
      if (latest.current.restoreFocus === false || !back || !back.isConnected) return;
      const at = document.activeElement;
      if (!at || at === document.body || (panel && panel.contains(at))) back.focus();
    };
  }, []);

  const trap = useFocusTrap(root, {
    // active=false снимает только перевод фокуса при открытии; Esc и Tab внутри — как обычно.
    active: takeFocus,
    onEscape: () => latest.current.onClose(),
    // Возврат фокуса — свой, умный (см. выше), а не безусловный хуковый.
    restoreFocus: false,
    initialFocus: initialFocus ?? (r => r.querySelector<HTMLElement>(MENUITEMS)),
  });

  // Щелчок вне. Щелчок по самому открывателю — НЕ «вне»: он переключатель, и
  // закрыть по mousedown, чтобы его же click открыл заново, значит сделать
  // кнопку неработающей. Открывателя узнаём по aria-controls на наш id:
  // при открытии мышью фокуса на нём может и не быть, так что по фокусу его
  // опознать нельзя.
  useEffect(() => {
    if (!closeOnOutside || typeof document === 'undefined') return;
    const onDown = (e: MouseEvent) => {
      const panel = root.current;
      const t = e.target as Node | null;
      if (!panel || !t) return;
      if (panel.contains(t)) return;
      const own = latest.current.id;
      if (own && t instanceof Element && t.closest(`[aria-controls="${own}"]`)) return;
      if (opener.current && opener.current.contains(t)) return;
      latest.current.onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [closeOnOutside]);

  // Слой рейки (`side`) — position:fixed по координатам якоря (PU-26). Был
  // абсолютным ВНУТРИ колонки меню, а у неё overflow:auto: слой справа от
  // колонки в 56px уходил в её прокрутку — обрезался, а фокус на первой ссылке
  // прокручивал колонку вбок, и список уезжал влево, на рейку и за край окна.
  // Замер окна (--pop-dx) это не лечил: резало не окно, а колонка. Поэтому
  // координаты считаются от якоря и окна: справа от значка; не влез — влево
  // от значка; дальше прижим к краям. На телефоне — нижний лист.
  const placeSide = useCallback(() => {
    const panel = root.current;
    const anchor = panel?.parentElement;
    if (!panel || !anchor || typeof window === 'undefined') return;
    if (typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches) {
      setSheet(true);
      setXY(null);
      return;
    }
    setSheet(false);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const a = anchor.getBoundingClientRect();
    const r = panel.getBoundingClientRect();
    if (!vw || !vh || !r.width) return;
    setXY(sidePlace(a, { width: r.width, height: r.height }, vw, vh));
  }, []);

  useLayoutEffect(() => {
    if (align !== 'side' || typeof window === 'undefined') return;
    placeSide();
    // Колонка меню или окно сдвинулись — слой идёт за значком, а не висит там,
    // где его открыли.
    const on = () => placeSide();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  }, [align, placeSide]);

  // Край экрана. Замер один раз при открытии: сдвиг меняет сам прямоугольник,
  // поэтому повторный замер по его же результату зацикливался бы.
  useLayoutEffect(() => {
    const panel = root.current;
    if (align === 'side' || !panel || typeof window === 'undefined') return;
    const r = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Нет раскладки (jsdom, скрытый родитель) — двигать нечего и не от чего.
    if (!vw || !vh || !r.width) return;
    let shift = 0;
    if (r.right > vw - GAP) shift = Math.round(vw - GAP - r.right);
    if (r.left + shift < GAP) shift = Math.round(GAP - r.left);
    setDx(shift);
    setUp(align !== 'under' && Boolean(r.height) && r.bottom > vh - GAP && r.top - r.height > GAP);
  }, [align]);

  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    trap(e);
    if (e.defaultPrevented || !arrows) return;
    const down = e.key === 'ArrowDown' || e.code === 'ArrowDown';
    const upKey = e.key === 'ArrowUp' || e.code === 'ArrowUp';
    if (!down && !upKey) return;
    const panel = root.current;
    if (!panel) return;
    const items = walk === 'menuitem'
      ? [...panel.querySelectorAll<HTMLElement>(MENUITEMS)]
      : focusables(panel);
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = at < 0
      ? (down ? 0 : items.length - 1)
      : (down ? (at + 1) % items.length : (at - 1 + items.length) % items.length);
    items[next].focus();
  }, [arrows, onKeyDown, trap, walk]);

  return (
    <div
      ref={root}
      id={id}
      role={role}
      aria-label={role ? label : undefined}
      // Поповер без фокусируемого содержимого («пока пусто») всё равно должен
      // принять фокус — иначе честный пустой текст не прочитается вслух.
      tabIndex={-1}
      className={['sk-pop', className].filter(Boolean).join(' ')}
      data-align={align}
      data-side={up ? 'up' : undefined}
      data-sheet={sheet ? 'bottom' : undefined}
      style={xy
        ? ({ '--pop-x': `${xy.x}px`, '--pop-y': `${xy.y}px` } as CSSProperties)
        : dx ? ({ '--pop-dx': `${dx}px` } as CSSProperties) : undefined}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}
