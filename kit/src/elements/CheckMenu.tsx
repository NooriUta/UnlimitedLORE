// Выпадающий список с галочками (SPRINT_UXR_S9_SCALE_OPT/S9-08, дополнение владелицы
// 14.11.2026: «выбор типа не полем, а дропдауном»). Кнопка-сводка «Типы рёбер · 2 из 3 ▾»,
// под ней — галочки с цветом и счётом. На <details>: открывается с клавиатуры без своего
// кода, а содержимое доступно и закрытым (скринридер, тесты). Щелчок вне — закрывает.
import { useEffect, useRef, type CSSProperties } from 'react';
import { kitT, type KitLang } from '../i18n';

export interface CheckMenuItem {
  key: string;
  label: string;
  /** CSS-цвет точки (токен уже разрешён вызывающим). */
  color?: string;
  count?: number;
  checked: boolean;
}

export function CheckMenu({ label, items, onToggle, lang, testId, className }: {
  label: string;
  items: readonly CheckMenuItem[];
  onToggle: (key: string) => void;
  lang: KitLang;
  testId?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const on = items.filter(i => i.checked).length;
  return (
    <details ref={ref} className={['sk-checkmenu', className].filter(Boolean).join(' ')} data-testid={testId}>
      <summary className="sk-btn sk-checkmenu__sum">
        <span>{label}</span>
        <span className="sk-checkmenu__n">{kitT(lang, 'kit.checkMenu.of', { n: on, total: items.length })}</span>
        <span aria-hidden="true">▾</span>
      </summary>
      <ul className="sk-checkmenu__list" role="group" aria-label={label}>
        {items.map(i => (
          <li key={i.key}>
            <label className="sk-checkmenu__row">
              <input type="checkbox" checked={i.checked} onChange={() => onToggle(i.key)} />
              {i.color && <span className="sk-gx-dot" aria-hidden="true" style={{ '--gx-c': i.color } as CSSProperties} />}
              <span className="sk-checkmenu__label">{i.label}</span>
              {i.count !== undefined && <span className="sk-checkmenu__count">{i.count}</span>}
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
