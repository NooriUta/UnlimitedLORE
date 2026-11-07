// Горячие клавиши по физической клавише (e.code), а не по символу (e.key).
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f: в русской раскладке e.key для K — «л»,
// для «/» — «.»; привязка к e.key молча не срабатывает. e.code одинаков в
// любой раскладке. Mod = Ctrl или ⌘.

export interface HotkeySpec {
  code: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

const SYMBOL_CODES: Record<string, string> = {
  '/': 'Slash', '\\': 'Backslash', '.': 'Period', ',': 'Comma', ';': 'Semicolon',
  "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight', '-': 'Minus', '=': 'Equal',
  '`': 'Backquote', ' ': 'Space', Space: 'Space', Esc: 'Escape',
};

/** Символы, которые набираются только со Shift (раскладка US — как в e.code). */
const SHIFTED: Record<string, string> = { '?': 'Slash' };

function keyToCode(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return SYMBOL_CODES[key] ?? key;
}

/** «Mod+Shift+K» → {code:'KeyK', mod, shift, alt}. Последняя часть — клавиша. */
export function parseHotkey(spec: string): HotkeySpec {
  // «+» сам по себе — клавиша Equal со Shift; поддерживаем только явные имена.
  const parts = spec.split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  // K-06: символы со Shift пишутся как есть («?» = Shift+Slash).
  const shifted = SHIFTED[key];
  return {
    code: shifted ?? keyToCode(key),
    mod: mods.has('mod') || mods.has('ctrl') || mods.has('cmd') || mods.has('meta'),
    shift: mods.has('shift') || shifted !== undefined,
    alt: mods.has('alt') || mods.has('option'),
  };
}

/** true, если событие — ровно эта комбинация (модификаторы сравниваются точно). */
export function matchHotkey(e: KeyLike, spec: HotkeySpec | string): boolean {
  if (e.isComposing) return false;
  const s = typeof spec === 'string' ? parseHotkey(spec) : spec;
  const mod = e.ctrlKey || e.metaKey;
  return sameKey(e.code, s.code) && mod === s.mod && e.shiftKey === s.shift && e.altKey === s.alt;
}

/** K-06: цифры статусов «1…N» — и с основного ряда (DigitN), и с цифрового блока (NumpadN). */
function sameKey(code: string, want: string): boolean {
  if (code === want) return true;
  const digit = /^Digit([0-9])$/.exec(want);
  return digit !== null && code === `Numpad${digit[1]}`;
}
