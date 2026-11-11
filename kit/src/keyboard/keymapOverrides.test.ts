// Переназначение горячих клавиш — чистая модель (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11).
//
// Решение владелицы 11.11.2026: «горячие клавиши должна быть настраиваемая
// тема: приложение задаёт умолчание, kit отрисовывает и реагирует, но можно
// переопределить и сохранить». Здесь — то, что от вида не зависит: сочетание
// из нажатия (по физической клавише — работает в русской раскладке), наложение
// переназначений на умолчание и хранение личной раскладки.
import { describe, expect, it } from 'vitest';
import { applyKeymapOverrides, hotkeyFromEvent, memoryKeymapStore } from './keymapOverrides';

const ev = (code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
  ({ code, key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('сочетание из нажатия', () => {
  it('буква — по физической клавише: в русской раскладке «у» на месте E даёт «E»', () => {
    expect(hotkeyFromEvent({ ...ev('KeyE'), key: 'у' })).toBe('E');
  });

  it('модификаторы: Ctrl/⌘ → Mod, порядок Mod+Alt+Shift', () => {
    expect(hotkeyFromEvent(ev('KeyD', { shiftKey: true, ctrlKey: true }))).toBe('Mod+Shift+D');
    expect(hotkeyFromEvent(ev('Digit2', { metaKey: true, altKey: true }))).toBe('Mod+Alt+2');
  });

  it('одиночный модификатор — ещё не сочетание (ждём клавишу)', () => {
    expect(hotkeyFromEvent(ev('ShiftLeft', { shiftKey: true }))).toBeNull();
    expect(hotkeyFromEvent(ev('ControlLeft', { ctrlKey: true }))).toBeNull();
  });

  it('служебные клавиши — своими именами', () => {
    expect(hotkeyFromEvent(ev('Enter'))).toBe('Enter');
    expect(hotkeyFromEvent(ev('Slash'))).toBe('/');
  });
});

describe('наложение переназначений', () => {
  const actions = [
    { id: 'done', title: 'Готово', hotkey: 'E' },
    { id: 'drop', title: 'Убрать', hotkey: 'Shift+D' },
    { id: 'copy', title: 'Копировать' },
  ];

  it('переназначение меняет клавишу, остальное — умолчание приложения', () => {
    const out = applyKeymapOverrides(actions, { done: 'G' });
    expect(out.map(a => a.hotkey)).toEqual(['G', 'Shift+D', undefined]);
  });

  it('null — клавиша снята (действие только кнопкой), а не «вернуть умолчание»', () => {
    expect(applyKeymapOverrides(actions, { drop: null })[1].hotkey).toBeUndefined();
  });

  it('переназначение для неизвестного действия игнорируется; исходный массив не меняется', () => {
    const out = applyKeymapOverrides(actions, { ghost: 'Q' });
    expect(out.map(a => a.hotkey)).toEqual(['E', 'Shift+D', undefined]);
    expect(actions[0].hotkey).toBe('E');
  });
});

describe('хранение личной раскладки', () => {
  it('записанное читается обратно; пустое хранилище — пустая раскладка', () => {
    const s = memoryKeymapStore();
    expect(s.read()).toEqual({});
    s.write({ done: 'G', drop: null });
    expect(s.read()).toEqual({ done: 'G', drop: null });
  });
});
