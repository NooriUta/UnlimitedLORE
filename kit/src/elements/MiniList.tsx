// Мини-список — один компонент для квиза и для todo (SPRINT_UXR_S13_KIT4/K4-MINILIST).
//
// Владелица 11.11.2026: «в кит добавь ещё компонент мини список, нужн будет
// как для квизов так и для todo». Три вида:
//   • check  — todo: флажки, «сделано N из M»; без onToggle — только чтение;
//   • choice — квиз: варианты с буквами, выбор одного; после ответа (reveal)
//              верный отмечен, у неверного выбранного — его подсказка;
//              до ответа верный не выдаётся;
//   • plain  — короткий маркированный список.
// Что за пункты, какой верный и что считать «сделано» — данные приложения
// (K-14). Пустой список назван словами: пустая рамка читается как «не загрузилось».
import { useId } from 'react';
import { kitT, useKitLang } from '../i18n';

export interface MiniListItem {
  id: string;
  text: string;
  /** check: пункт отмечен. */
  done?: boolean;
  /** choice: подсказка к этому варианту — показывается, если его выбрали неверно. */
  hint?: string;
}

export interface MiniListProps {
  kind: 'check' | 'choice' | 'plain';
  /** Подпись списка — имя группы для чтения с экрана (вопрос квиза, название плана). */
  label: string;
  items: readonly MiniListItem[];
  /** check: переключили пункт. Нет — только чтение. */
  onToggle?: (id: string, done: boolean) => void;
  /** choice: выбрали вариант. Нет — только чтение. */
  onPick?: (id: string) => void;
  /** choice: выбранный вариант. */
  picked?: string | null;
  /** choice: верный вариант (данные приложения). Показывается только при reveal. */
  correct?: string | null;
  /** choice: ответ дан — показать верный и подсказку к неверному. */
  reveal?: boolean;
  className?: string;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function MiniList({ kind, label, items, onToggle, onPick, picked = null, correct = null, reveal = false, className }: MiniListProps) {
  const lang = useKitLang();
  const name = useId();
  const cls = ['sk-minilist', `sk-minilist--${kind}`, className].filter(Boolean).join(' ');

  if (items.length === 0) {
    return <p className={`${cls} sk-minilist__empty`}>{kitT(lang, 'kit.minilist.empty')}</p>;
  }

  if (kind === 'plain') {
    return <ul className={cls} aria-label={label}>{items.map(it => <li key={it.id} className="sk-minilist__item">{it.text}</li>)}</ul>;
  }

  if (kind === 'check') {
    const done = items.filter(it => it.done).length;
    return (
      <div className={cls}>
        <p className="sk-minilist__count">{kitT(lang, 'kit.minilist.done', { done, total: items.length })}</p>
        <ul className="sk-minilist__list" aria-label={label}>
          {items.map(it => (
            <li key={it.id} className="sk-minilist__item" data-state={it.done ? 'done' : 'todo'}>
              <label className="sk-minilist__row">
                <input type="checkbox" checked={!!it.done} disabled={!onToggle}
                  onChange={e => onToggle?.(it.id, e.target.checked)} />
                <span className="sk-minilist__text">{it.text}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // choice
  const stateOf = (id: string): 'correct' | 'wrong' | 'picked' | 'idle' => {
    if (reveal && correct === id) return 'correct';
    if (reveal && picked === id) return 'wrong';
    if (picked === id) return 'picked';
    return 'idle';
  };
  return (
    <div className={cls} role="radiogroup" aria-label={label}>
      {items.map((it, i) => {
        const st = stateOf(it.id);
        return (
          <label key={it.id} className="sk-minilist__row sk-minilist__opt" data-state={st}>
            <input type="radio" name={name} checked={picked === it.id} disabled={!onPick || reveal}
              onChange={() => onPick?.(it.id)} />
            <span className="sk-minilist__letter" aria-hidden="true">{LETTERS[i] ?? String(i + 1)}</span>
            <span className="sk-minilist__text">{it.text}</span>
            {st === 'correct' && <span className="sk-minilist__mark">{kitT(lang, 'kit.minilist.correct')}</span>}
            {st === 'wrong' && it.hint && <span className="sk-minilist__hint">{it.hint}</span>}
          </label>
        );
      })}
    </div>
  );
}
