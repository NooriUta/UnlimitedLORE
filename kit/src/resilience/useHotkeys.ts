// Горячие клавиши оболочки (SPRINT_UXR_S10_SEIDR_KIT/K-06): по e.code
// (matchHotkey, S4-00f — русская раскладка), один слушатель keydown на window.
// В поле ввода клавиша без модификатора — это набор текста, а не команда:
// «1» в поиске не должен менять статус. Комбинации с Mod и Escape работают
// откуда угодно (палитра Mod+K открывается и из поиска).
import { useEffect, useRef } from 'react';
import { matchHotkey, parseHotkey } from './hotkeys';
import { isEditableTarget } from './editable';

export type HotkeyHandler = (e: KeyboardEvent) => void;

// S4-13 (B-08): одна проверка на весь kit — видит и потомка contenteditable.
const isTyping = isEditableTarget;

export function useHotkeys(bindings: Record<string, HotkeyHandler>, opts: { enabled?: boolean } = {}): void {
  const ref = useRef(bindings);
  useEffect(() => { ref.current = bindings; });
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const typing = isTyping(e.target);
      for (const [spec, run] of Object.entries(ref.current)) {
        const s = parseHotkey(spec);
        if (typing && !s.mod && s.code !== 'Escape') continue;
        if (!matchHotkey(e, s)) continue;
        e.preventDefault();
        run(e);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
