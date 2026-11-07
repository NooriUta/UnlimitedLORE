// Toolbar (S4-00b): role=toolbar с именем, один таб-стоп на всю панель и
// «бегающий» tabindex — стрелки ←/→ (или ↑/↓ у вертикальной), Home/End водят
// фокус по кнопкам (паттерн WAI-ARIA Toolbar). Стрелки и Home/End по e.key не
// зависят от раскладки, в отличие от буквенных клавиш (S4-00f: те — по e.code).
import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface ToolbarProps {
  /** Имя панели — обязательно (у нескольких панелей на экране их различают по имени). */
  label: string;
  children: ReactNode;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

const ITEMS = 'button:not([disabled]), [role="button"]:not([aria-disabled="true"]), a[href], input:not([disabled]), select:not([disabled])';

export function Toolbar({ label, children, orientation = 'horizontal', className }: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);

  const items = () => (ref.current ? [...ref.current.querySelectorAll<HTMLElement>(ITEMS)] : []);

  // Один таб-стоп: активный элемент (или первый) — 0, остальные — -1.
  useLayoutEffect(() => {
    const all = items();
    if (!all.length) return;
    const cur = all.findIndex(el => el.tabIndex === 0 && el.dataset.skRoving === '1');
    all.forEach((el, i) => {
      el.tabIndex = i === (cur >= 0 ? cur : 0) ? 0 : -1;
      el.dataset.skRoving = '1';
    });
  });

  const move = (to: HTMLElement, all: HTMLElement[]) => {
    all.forEach(el => { el.tabIndex = el === to ? 0 : -1; });
    to.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    if (!all.length) return;
    const at = Math.max(0, all.findIndex(el => el === document.activeElement || el.contains(document.activeElement)));
    const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    let to: number | null = null;
    if (e.key === next) to = (at + 1) % all.length;
    else if (e.key === prev) to = (at - 1 + all.length) % all.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = all.length - 1;
    if (to === null) return;
    e.preventDefault();
    move(all[to], all);
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      className={['sk-toolbar', `sk-toolbar--${orientation}`, className].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
