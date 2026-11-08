// Tabs (S4-00c): вкладки по WAI-ARIA — tablist/tab/tabpanel, roving tabindex
// (в Tab-порядке только выбранная), стрелки по кругу с пропуском выключенных,
// Home/End, автоматическая активация. Значение — управляемое: состояние
// вкладки живёт в URL у экрана, а не внутри компонента.
import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { GameIcon } from '../elements/GameIcon';

export interface TabItem {
  id: string;
  label: string;
  /** Слаг game-icons. */
  icon?: string;
  /** Счётчик (моно) — сколько записей во вкладке. */
  count?: number;
  disabled?: boolean;
  /** Зона (S4-33): «around» — вычисляемое вокруг записи, рисуется другим тоном. */
  zone?: 'record' | 'around';
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Имя группы вкладок (aria-label у tablist). */
  label: string;
  /** Содержимое выбранной вкладки; нет — вкладки работают как переключатель вида, без панели. */
  children?: ReactNode;
  className?: string;
  /**
   * Форма вкладок (S4-21): «pill» — прежняя, по умолчанию; «underline» — подчёркивание,
   * словарь форм прототипа v4 (вкладки записи). API и клавиатура одинаковы.
   */
  variant?: 'pill' | 'underline';
}

export function Tabs({ items, value, onChange, label, children, className, variant = 'pill' }: TabsProps) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const hasPanel = children !== undefined;
  const panelId = `${base}-panel`;
  const tabId = (id: string) => `${base}-tab-${id}`;
  const enabled = items.filter(i => !i.disabled);
  // Значение вне списка — в Tab-порядок попадает первая доступная вкладка,
  // иначе группа становится недостижимой с клавиатуры.
  const focusId = enabled.some(i => i.id === value) ? value : enabled[0]?.id;

  function go(id: string | undefined) {
    if (!id) return;
    refs.current[id]?.focus();
    if (id !== value) onChange(id);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, id: string) {
    const at = enabled.findIndex(i => i.id === id);
    const n = enabled.length;
    let next: string | undefined;
    if (e.key === 'ArrowRight') next = enabled[(at + 1) % n]?.id;
    else if (e.key === 'ArrowLeft') next = enabled[(at - 1 + n) % n]?.id;
    else if (e.key === 'Home') next = enabled[0]?.id;
    else if (e.key === 'End') next = enabled[n - 1]?.id;
    else return;
    e.preventDefault();
    go(next);
  }

  return (
    <div className={['sk-tabs-root', className].filter(Boolean).join(' ')}>
      <div role="tablist" aria-label={label} className={variant === 'underline' ? 'sk-tabs sk-tabs--underline' : 'sk-tabs'}>
        {items.map(item => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              ref={el => { refs.current[item.id] = el; }}
              type="button"
              role="tab"
              id={tabId(item.id)}
              aria-selected={selected}
              aria-controls={hasPanel && selected ? panelId : undefined}
              tabIndex={item.id === focusId ? 0 : -1}
              disabled={item.disabled}
              className="sk-tab"
              data-zone={item.zone}
              onClick={() => go(item.id)}
              onKeyDown={e => onKeyDown(e, item.id)}
            >
              {item.icon && <GameIcon slug={item.icon} size={13} />}
              <span>{item.label}</span>
              {item.count !== undefined && <span className="sk-tab__count">{item.count}</span>}
            </button>
          );
        })}
      </div>
      {hasPanel && (
        <div role="tabpanel" id={panelId} aria-labelledby={tabId(value)} tabIndex={0} className="sk-tabpanel">
          {children}
        </div>
      )}
    </div>
  );
}
