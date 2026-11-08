// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11 — клавиатура как слой: модель клавиш.
// Клавиши — по e.code (S4-00f), подписи — для Kbd и aria-keyshortcuts.
import { describe, expect, it } from 'vitest';
import { ariaKeyshortcuts, findAction, kbdKeys, keymapConflicts, LIST_RESERVED_KEYS } from './keymap';

const ev = (code: string, m: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
  ({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...m });

describe('ariaKeyshortcuts — формат aria-keyshortcuts', () => {
  it('Mod → Control, буква заглавная, модификаторы в порядке Control+Alt+Shift', () => {
    expect(ariaKeyshortcuts('Mod+K')).toBe('Control+K');
    expect(ariaKeyshortcuts('shift+mod+e')).toBe('Control+Shift+E');
    expect(ariaKeyshortcuts('x')).toBe('X');
    expect(ariaKeyshortcuts('Escape')).toBe('Escape');
    expect(ariaKeyshortcuts('Delete')).toBe('Delete');
    expect(ariaKeyshortcuts('/')).toBe('/');
    expect(ariaKeyshortcuts('?')).toBe('Shift+?');
  });
});

describe('kbdKeys — подпись клавиш для Kbd', () => {
  it('Ctrl на PC и ⌘ на Mac; стрелки и Esc — символами', () => {
    expect(kbdKeys('Mod+K')).toEqual(['Ctrl', 'K']);
    expect(kbdKeys('Mod+K', { mac: true })).toEqual(['⌘', 'K']);
    expect(kbdKeys('Shift+E')).toEqual(['Shift', 'E']);
    expect(kbdKeys('Escape')).toEqual(['Esc']);
    expect(kbdKeys('ArrowDown')).toEqual(['↓']);
    expect(kbdKeys('Enter')).toEqual(['Enter']);
    expect(kbdKeys('?')).toEqual(['?']);
  });
});

describe('findAction — по e.code, в любой раскладке', () => {
  const actions = [
    { id: 'edit', title: 'Править', hotkey: 'E', run: () => {} },
    { id: 'del', title: 'Удалить', hotkey: 'Shift+Delete', run: () => {} },
    { id: 'nokey', title: 'Без клавиши', run: () => {} },
  ];
  it('русская раскладка: e.key «у», e.code KeyE — находит «Править»', () => {
    expect(findAction(actions, { ...ev('KeyE'), key: 'у' } as never)?.id).toBe('edit');
  });
  it('модификаторы точные: Ctrl+E — не «Править»', () => {
    expect(findAction(actions, ev('KeyE', { ctrlKey: true }))).toBeUndefined();
    expect(findAction(actions, ev('Delete', { shiftKey: true }))?.id).toBe('del');
  });
  it('действие без клавиши клавишей не вызывается', () => {
    expect(findAction(actions, ev('KeyN'))).toBeUndefined();
  });
});

describe('keymapConflicts — одна клавиша = одно действие', () => {
  it('две записи одной комбинации (в разной записи) — конфликт', () => {
    const c = keymapConflicts([{ id: 'a', hotkey: 'E' }, { id: 'b', hotkey: 'e' }, { id: 'c', hotkey: 'Shift+E' }]);
    expect(c).toEqual([{ hotkey: 'E', ids: ['a', 'b'] }]);
  });
  it('занятая слоем списка клавиша (J, X, Enter, Mod+K…) — конфликт с «list»', () => {
    const c = keymapConflicts([{ id: 'a', hotkey: 'X' }, { id: 'b', hotkey: 'Mod+K' }, { id: 'ok', hotkey: 'E' }], LIST_RESERVED_KEYS);
    expect(c.map(x => x.ids)).toEqual([['list', 'a'], ['list', 'b']]);
  });
  it('без клавиш — конфликтов нет', () => {
    expect(keymapConflicts([{ id: 'a' }, { id: 'b' }])).toEqual([]);
  });
});
