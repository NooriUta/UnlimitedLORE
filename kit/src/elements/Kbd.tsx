// Kbd (S4-00b, D-2026-UXR-KEYBOARD-LAYER): видимая подсказка клавиши рядом с
// кнопкой. Клавиатура — дополнительный слой: у каждой клавиши есть кнопка, и
// имя/клавишу для чтения несёт сама кнопка (aria-keyshortcuts), поэтому
// подсказка от скринридера скрыта, а на сенсоре — не рисуется (seidr.css).
export interface KbdProps {
  /** Клавиши сочетания по порядку: ['Ctrl', 'K']. */
  keys: readonly string[];
  className?: string;
}

export function Kbd({ keys, className }: KbdProps) {
  return (
    <span className={['sk-kbd', className].filter(Boolean).join(' ')} aria-hidden="true">
      {keys.map((k, i) => <kbd key={`${i}-${k}`}>{k}</kbd>)}
    </span>
  );
}
