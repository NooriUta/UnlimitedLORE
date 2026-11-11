// Панель Peek у списка (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10, D-2026-LORE-PEEK-ONE-CARD, P3а/P4а).
//
// Компьютер: панель справа ПОВЕРХ списка — прокрутка и место в списке не сбиваются. Ширина тянется
//   ручкой (мышью и ←/→ с клавиатуры) и запоминается (Jira: узкую нерастягиваемую панель ругали
//   больше всего). Узкий экран (≤720): тот же контент в общем нижнем листе (Sheet + .sk-lsheet).
// Содержимое — от приложения (render): kit не знает, что в карточке (K-14).
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Sheet } from '../shell/Sheet';
import { useNarrow } from '../core/narrow';
import { createSafeStorage } from '../resilience/safeStorage';
import { kitT, useKitLang } from '../i18n';

export interface ListPeek {
  /** Карточка записи по id (приложение грузит и рисует PeekCard). */
  render: (id: string) => ReactNode;
  /** Доступное имя панели / заголовок листа. */
  title: (id: string) => string;
}

const KEY = 'sk.peek.width';
const DEF = 380;
const MIN = 300;
const MAX = 720;
const STEP = 32;
const clamp = (n: number) => Math.max(MIN, Math.min(MAX, Math.round(n)));
const storage = createSafeStorage();

function readWidth(): number {
  const n = Number(storage.get(KEY));
  return Number.isFinite(n) && n > 0 ? clamp(n) : DEF;
}

export function PeekPanel({ id, peek, onClose }: { id: string; peek: ListPeek; onClose: () => void }) {
  const lang = useKitLang();
  const narrow = useNarrow();
  const [width, setWidth] = useState(readWidth);
  const drag = useRef<{ x: number; w: number } | null>(null);

  const apply = (w: number) => { const v = clamp(w); setWidth(v); storage.set(KEY, String(v)); };

  useEffect(() => {
    const move = (e: MouseEvent) => { if (drag.current) apply(drag.current.w + (drag.current.x - e.clientX)); };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  if (narrow) {
    return (
      <Sheet open onClose={onClose} title={peek.title(id)} side="bottom" className="sk-lsheet sk-peek-sheet">
        {peek.render(id)}
      </Sheet>
    );
  }

  const onGripKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); apply(width + STEP); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); apply(width - STEP); }
  };
  const onGripDown = (e: ReactMouseEvent) => { e.preventDefault(); drag.current = { x: e.clientX, w: width }; };

  return (
    <aside className="sk-peek-panel" style={{ width: `${width}px` }} aria-label={peek.title(id)}>
      <div
        className="sk-peek-panel__grip"
        role="separator"
        aria-orientation="vertical"
        aria-label={kitT(lang, 'kit.peek.width')}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={onGripKey}
        onMouseDown={onGripDown}
      />
      <div className="sk-peek-panel__head">
        <span className="sk-peek-panel__hint">{kitT(lang, 'kit.peek.keys')}</span>
        <button type="button" className="sk-btn sk-peek-panel__close" aria-label={kitT(lang, 'kit.peek.close')} onClick={onClose}>✕</button>
      </div>
      <div className="sk-peek-panel__body">{peek.render(id)}</div>
    </aside>
  );
}
