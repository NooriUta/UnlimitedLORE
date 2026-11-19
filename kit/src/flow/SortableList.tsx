// SortableList — порядок строк перетаскиванием и кнопками (SPRINT_LORE_MODEL_AS_CONFIG/MC-06).
//
// Перетаскивание мышью удобно, но недоступно с клавиатуры и капризно пальцем, поэтому оно здесь —
// ускоритель, а не единственный путь: у каждой строки есть «выше/ниже» с именем строки, а Alt+↑/↓
// двигает строку в фокусе. Элемент только сообщает «из i в j» — что за строки и как их хранить,
// знает приложение (K-14).
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';
import { IconButton } from '../elements/IconButton';

export interface SortableItem {
  id: string;
  /** Имя строки — для кнопок «выше/ниже» и для строки по умолчанию. */
  label: string;
}

export interface SortableListProps<T extends SortableItem = SortableItem> {
  items: readonly T[];
  /** Переставить строку из позиции from в позицию to. */
  onMove: (from: number, to: number) => void;
  /** Имя списка (aria-label). */
  label: string;
  /** Содержимое строки; не задано — label. */
  renderItem?: (item: T, index: number) => ReactNode;
  /** Изменённые строки (подсветка). */
  changed?: ReadonlySet<string>;
  /** Только чтение: без кнопок и перетаскивания. */
  readOnly?: boolean;
  className?: string;
}

export function SortableList<T extends SortableItem>({ items, onMove, label, renderItem, changed, readOnly, className }: SortableListProps<T>) {
  const lang = useKitLang();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    onMove(from, to);
  };
  const onKey = (i: number) => (e: KeyboardEvent<HTMLLIElement>) => {
    if (readOnly || !e.altKey) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
  };
  return (
    <ul className={['sk-sortable', className].filter(Boolean).join(' ')} aria-label={label}>
      {items.map((it, i) => (
        <li
          key={it.id}
          className="sk-sortable__row"
          data-sortable-id={it.id}
          data-changed={changed?.has(it.id) ? '' : undefined}
          data-over={over === i && drag !== null && drag !== i ? '' : undefined}
          draggable={readOnly ? undefined : true}
          onKeyDown={onKey(i)}
          onDragStart={readOnly ? undefined : e => {
            setDrag(i);
            try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id); } catch { /* jsdom/старые браузеры */ }
          }}
          onDragOver={readOnly ? undefined : e => { if (drag !== null) { e.preventDefault(); setOver(i); } }}
          onDragLeave={readOnly ? undefined : () => setOver(o => (o === i ? null : o))}
          onDrop={readOnly ? undefined : e => {
            e.preventDefault();
            if (drag !== null) move(drag, i);
            setDrag(null);
            setOver(null);
          }}
          onDragEnd={() => { setDrag(null); setOver(null); }}
        >
          {!readOnly && <span className="sk-sortable__grip" aria-hidden="true">⠿</span>}
          <div className="sk-sortable__body">{renderItem ? renderItem(it, i) : it.label}</div>
          {!readOnly && (
            <span className="sk-sortable__btns">
              <IconButton icon="lucide:chevron-up" className="sk-sortable__up" label={kitT(lang, 'kit.sortable.up', { name: it.label })}
                disabled={i === 0} onClick={() => move(i, i - 1)} iconSize={12} />
              <IconButton icon="lucide:chevron-down" className="sk-sortable__down" label={kitT(lang, 'kit.sortable.down', { name: it.label })}
                disabled={i === items.length - 1} onClick={() => move(i, i + 1)} iconSize={12} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
