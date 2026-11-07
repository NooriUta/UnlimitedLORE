// IconButton (S4-00b): кнопка-иконка. Цель касания — не меньше --tap (44px на
// сенсоре, seidr.css), видимый фокус (:focus-visible), имя обязательно: у
// кнопки без текста имя — единственное, что прочтёт скринридер, и пустое имя
// здесь — громкая ошибка, а не тихая безымянная кнопка.
//
// Клавиша (D-2026-UXR-KEYBOARD-LAYER): у каждой клавиши есть кнопка — shortcut
// уходит в aria-keyshortcuts и в подсказку title.
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { GameIcon } from './GameIcon';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Слаг game-icons. */
  icon: string;
  /** Имя кнопки (aria-label и подсказка) — обязательно и не пустое. */
  label: string;
  /** Клавиша, например "F" или "Control+K" (формат aria-keyshortcuts). */
  shortcut?: string;
  /** Переключатель: true/false даёт aria-pressed; undefined — обычная кнопка. */
  pressed?: boolean;
  iconSize?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, shortcut, pressed, iconSize = 15, className, type, title, ...rest },
  ref,
) {
  if (!label || !label.trim()) {
    throw new Error(`IconButton: пустой label у иконки «${icon}» — кнопку без имени не прочитать`);
  }
  const cls = ['sk-iconbtn', pressed ? 'is-on' : '', className].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cls}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      aria-pressed={pressed}
      title={title ?? (shortcut ? `${label} (${shortcut})` : label)}
      {...rest}
    >
      <GameIcon slug={icon} size={iconSize} />
    </button>
  );
});
