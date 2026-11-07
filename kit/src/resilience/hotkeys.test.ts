// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00f, шаг 1: горячие клавиши по e.code.
// Владелица пишет то в русской, то в английской раскладке: e.key в русской
// раскладке для физической K — «л», и клавиша, привязанная к e.key, молчит.
import { describe, expect, it } from 'vitest';
import { matchHotkey, parseHotkey } from './hotkeys';

const ev = (over: Partial<KeyboardEventInit & { isComposing: boolean }>) => ({
  key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
  isComposing: false, ...over,
});

describe('горячие клавиши по e.code', () => {
  it('Mod+K срабатывает в русской раскладке (e.key = «л», e.code = KeyK)', () => {
    expect(matchHotkey(ev({ key: 'л', code: 'KeyK', ctrlKey: true }), 'Mod+K')).toBe(true);
    expect(matchHotkey(ev({ key: 'л', code: 'KeyK', metaKey: true }), 'Mod+K')).toBe(true);
  });

  it('«/» узнаётся по Slash, даже когда раскладка отдаёт «.»', () => {
    expect(matchHotkey(ev({ key: '.', code: 'Slash' }), '/')).toBe(true);
  });

  it('e.key сам по себе не засчитывается: «k» с чужим code — мимо', () => {
    expect(matchHotkey(ev({ key: 'k', code: 'KeyR', ctrlKey: true }), 'Mod+K')).toBe(false);
  });

  it('модификаторы сравниваются точно и набор IME не перехватывается', () => {
    expect(matchHotkey(ev({ code: 'KeyK' }), 'Mod+K')).toBe(false);
    expect(matchHotkey(ev({ code: 'KeyK', ctrlKey: true, shiftKey: true }), 'Mod+K')).toBe(false);
    expect(matchHotkey(ev({ code: 'KeyK', ctrlKey: true, isComposing: true }), 'Mod+K')).toBe(false);
  });

  it('разбор записи: буквы → KeyX, цифры → DigitN, имена клавиш как есть', () => {
    expect(parseHotkey('Mod+Shift+K')).toEqual({ code: 'KeyK', mod: true, shift: true, alt: false });
    expect(parseHotkey('1').code).toBe('Digit1');
    expect(parseHotkey('Escape').code).toBe('Escape');
  });
});
