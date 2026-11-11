// Peek со ссылки [[…]] в тексте (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10, D-2026-LORE-PEEK-ONE-CARD, P1а/P2а).
//
// Мышь: наведение держится ~0,4 с → карточка у ссылки (Popover без захвата фокуса); щелчок —
//   по-прежнему переход в паспорт. Ушёл раньше задержки — карточки нет. С ссылки на карточку можно
//   перейти мышью: короткая пауза перед закрытием (Wikipedia: люди читают, водя мышью — задержка
//   отсекает случайные всплытия).
// Палец: тап → нижний лист (общий Sheet side="bottom" + .sk-lsheet — отступ под системную полосу,
//   договорённость с мобильной сессией 11.11), перехода нет. На сенсоре наведение выключено вовсе
//   (pointer: coarse), и mouseover, который браузер шлёт вслед за касанием, карточку не открывает.
// Выключатель (enabled=false) — карточек по наведению нет; тап на телефоне лист всё равно открывает:
//   это не всплытие, а явное действие.
// Содержимое — от приложения (render): kit знает время, место и лист, но не что показывать (K-14).
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode, TouchEvent as ReactTouchEvent } from 'react';
import { Popover } from '../shell/Popover';
import { Sheet } from '../shell/Sheet';

export interface MartPeekRef { id: string; type: string | null }

export interface MartRefPeek {
  /** Содержимое карточки по ссылке (приложение грузит и рисует PeekCard). */
  render: (ref: MartPeekRef) => ReactNode;
  /** Заголовок листа на телефоне — доступное имя диалога. */
  title: (ref: MartPeekRef) => string;
  /** Задержка перед карточкой по наведению, мс (по умолчанию 400). */
  delayMs?: number;
  /** Карточки по наведению включены (настройка; по умолчанию да). */
  enabled?: boolean;
}

/** Сколько после касания игнорировать «мышиные» события, которые браузер шлёт вслед за тапом. */
const TOUCH_GRACE_MS = 800;
/** Пауза перед закрытием: успеть перевести мышь со ссылки на карточку. */
const CLOSE_GRACE_MS = 150;

const isCoarse = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/** Что считать ссылкой для Peek: по умолчанию вики-ссылка текста; ленты и списки дают свой класс. */
const DEFAULT_SELECTOR = '.sk-wref';

function refOf(target: EventTarget | null, selector = DEFAULT_SELECTOR): { el: HTMLElement; ref: MartPeekRef } | null {
  // Ссылки внутри самой карточки или листа — не вход в новый Peek (иначе карточка подменяла бы себя).
  if ((target as Element | null)?.closest?.('.sk-peek-hover, .sk-peek-sheet')) return null;
  const el = (target as Element | null)?.closest?.(selector) as HTMLElement | null;
  const id = el?.getAttribute('data-ref');
  return el && id ? { el, ref: { id, type: el.getAttribute('data-ref-type') } } : null;
}

/**
 * Слой Peek: наведение мышью — карточка после задержки, касание — нижний лист.
 * `selector` — какие элементы считать ссылками (у них data-ref и data-ref-type); по умолчанию
 * вики-ссылки текста. Владелица 11.11.2026: «и к новостям тоже приделай peek» — строки ленты.
 */
export function useRefPeek(peek?: MartRefPeek, opts?: { selector?: string }) {
  const sel = opts?.selector ?? DEFAULT_SELECTOR;
  const [hover, setHover] = useState<{ ref: MartPeekRef; left: number; top: number } | null>(null);
  const [sheet, setSheet] = useState<MartPeekRef | null>(null);
  const openT = useRef<number | undefined>(undefined);
  const closeT = useRef<number | undefined>(undefined);
  const lastTouch = useRef(0);
  useEffect(() => () => { window.clearTimeout(openT.current); window.clearTimeout(closeT.current); }, []);

  if (!peek) return { handlers: {}, layer: null };

  const recentTouch = () => Date.now() - lastTouch.current < TOUCH_GRACE_MS;
  const scheduleClose = () => {
    window.clearTimeout(closeT.current);
    closeT.current = window.setTimeout(() => setHover(null), CLOSE_GRACE_MS);
  };

  const handlers = {
    onTouchStart: (e: ReactTouchEvent) => { if (refOf(e.target, sel)) lastTouch.current = Date.now(); },
    onMouseOver: (e: ReactMouseEvent) => {
      if (peek.enabled === false || isCoarse() || recentTouch()) return;
      const hit = refOf(e.target, sel);
      if (!hit) return;
      window.clearTimeout(closeT.current);
      if (hover?.ref.id === hit.ref.id) return;
      window.clearTimeout(openT.current);
      openT.current = window.setTimeout(() => {
        const r = hit.el.getBoundingClientRect();
        setHover({ ref: hit.ref, left: r.left, top: r.bottom });
      }, peek.delayMs ?? 400);
    },
    onMouseOut: (e: ReactMouseEvent) => {
      if (!refOf(e.target, sel)) return;
      window.clearTimeout(openT.current);
      scheduleClose();
    },
    onClick: (e: ReactMouseEvent) => {
      const hit = refOf(e.target, sel);
      if (!hit || !(isCoarse() || recentTouch())) return; // мышь — обычный переход по ссылке
      e.preventDefault();
      window.clearTimeout(openT.current);
      setHover(null);
      setSheet(hit.ref);
    },
  };

  const layer = (
    <>
      {hover && (
        <div
          className="sk-peek-hover"
          style={{ left: hover.left, top: hover.top }}
          onMouseEnter={() => window.clearTimeout(closeT.current)}
          onMouseLeave={scheduleClose}
        >
          <Popover onClose={() => setHover(null)} takeFocus={false} walk="focusable" arrows={false} className="sk-peek-hover__pop">
            {peek.render(hover.ref)}
          </Popover>
        </div>
      )}
      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet ? peek.title(sheet) : ''} side="bottom" className="sk-lsheet sk-peek-sheet">
        {sheet && peek.render(sheet)}
      </Sheet>
    </>
  );
  return { handlers, layer };
}
