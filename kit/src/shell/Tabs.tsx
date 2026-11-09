// Tabs (S4-00c): вкладки по WAI-ARIA — tablist/tab/tabpanel, roving tabindex
// (в Tab-порядке только выбранная), стрелки по кругу с пропуском выключенных,
// Home/End, автоматическая активация. Значение — управляемое: состояние
// вкладки живёт в URL у экрана, а не внутри компонента.
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { GameIcon } from '../elements/GameIcon';
import { kitT, useKitLang } from '../i18n';

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
  /** Вид связи UML (паспорт по связям): значок у вкладки и data-relation. */
  relation?: string;
  mark?: string;
  /** Что значит значок связи: подсказка у глифа — иначе он «случайный» (P2 аудита 08.11). */
  markTitle?: string;
  /**
   * Редкая вкладка: в ряду не показывается, живёт под свёрткой «Ещё» (S4-29).
   *
   * Повод — владелица 09.11: «зависимости и прочее можно скрыть под море…
   * интерфейс становится перегруженным». КАКИЕ вкладки редкие, решает
   * приложение (у LORE — умолчание модели плюс личная настройка); kit получает
   * готовый признак и только выбирает, рисовать в ряд или под свёртку.
   *
   * Выбранная вкладка показывается в ряду ВСЕГДА, даже с этим признаком:
   * спрятать то, что человек сейчас читает, хуже перегруженности.
   */
  secondary?: boolean;
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
  const lang = useKitLang();
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const hasPanel = children !== undefined;
  const panelId = `${base}-panel`;
  const tabId = (id: string) => `${base}-tab-${id}`;
  const [moreOpen, setMoreOpen] = useState(false);

  // Редкие вкладки (S4-29). Выбранная остаётся в ряду даже будучи редкой:
  // иначе человек читает раздел, которого не видит в навигации.
  const folded = items.filter(i => i.secondary && i.id !== value);
  const shown = items.filter(i => !folded.includes(i));
  // Клавиатура ряда ходит по ВИДИМЫМ вкладкам: стрелка не должна прыгать в
  // спрятанное — там её не видно, и фокус пропадает «в никуда».
  const enabled = shown.filter(i => !i.disabled);
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
        {shown.map(item => {
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
              data-relation={item.relation}
              onClick={() => go(item.id)}
              onKeyDown={e => onKeyDown(e, item.id)}
            >
              {item.icon && <GameIcon slug={item.icon} size={13} />}
              {item.mark && (
                // aria-hidden: для чтения вслух глиф бесполезен, подпись вкладки уже сказана.
                // title — для глаз: «◆» без объяснения выглядит случайным символом.
                <span className="sk-tab__mark" data-relation-mark aria-hidden="true" title={item.markTitle}>{item.mark}</span>
              )}
              <span>{item.label}</span>
              {item.count !== undefined && <span className="sk-tab__count">{item.count}</span>}
            </button>
          );
        })}
        {folded.length > 0 && (
          // Свёртка — ВСПЛЫВАЮЩАЯ, а не вторая строка вкладок: вторая строка
          // вернула бы перегруженность, от которой свёртка и спасает.
          // Число спрятанного названо: «Ещё» без числа не говорит, стоит ли
          // открывать.
          <span className="sk-tabs__more">
            <button type="button" className="sk-tab sk-tabs__more-btn"
              aria-expanded={moreOpen} aria-haspopup="menu"
              onClick={() => setMoreOpen(v => !v)}>
              <span>{kitT(lang, 'kit.tabs.more')}</span>
              <span className="sk-tab__count">{folded.length}</span>
            </button>
            {moreOpen && (
              <div role="menu" aria-label={kitT(lang, 'kit.tabs.more')} className="sk-tabs__more-pop"
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setMoreOpen(false); } }}>
                {folded.map(item => (
                  <button key={item.id} type="button" role="menuitem" className="sk-tabs__more-item"
                    onClick={() => { setMoreOpen(false); go(item.id); }}>
                    {item.icon && <GameIcon slug={item.icon} size={13} />}
                    <span>{item.label}</span>
                    {item.count !== undefined && <span className="sk-tab__count">{item.count}</span>}
                  </button>
                ))}
              </div>
            )}
          </span>
        )}
      </div>
      {hasPanel && (
        <div role="tabpanel" id={panelId} aria-labelledby={tabId(value)} tabIndex={0} className="sk-tabpanel">
          {children}
        </div>
      )}
    </div>
  );
}
