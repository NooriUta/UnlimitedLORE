// SPRINT_UXR_S5_RECORD_TASKS/S5-05 · настройки режима чтения: размер текста
// (Aa), правая колонка (ушко) и «сворачивать меню при чтении». Умолчания —
// решения владелицы: колонка свойств выключена (D-2026-UXR-RAIL-OFF), меню при
// чтении сворачивается (D-2026-UXR-READ-COLLAPSE). Всё запоминается.
import { describe, expect, it } from 'vitest';
import { createSafeStorage } from '../resilience/safeStorage';
import {
  DEFAULT_READING_PREFS, READ_SIZES, readReadingPrefs, readingPrefsKey, stepReadSize, writeReadingPrefs,
} from './readingPrefs';

function mem() {
  const m = new Map<string, string>();
  return createSafeStorage(() => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  }) as unknown as Storage);
}

describe('S5-05 · настройки чтения', () => {
  it('умолчания: размер m, колонка свойств выключена, меню сворачивается', () => {
    expect(DEFAULT_READING_PREFS).toEqual({ size: 'm', rail: false, collapseMenu: true });
  });

  it('ступени Aa — только токены шкалы --fs-*', () => {
    expect(READ_SIZES.map(s => s.id)).toEqual(['s', 'm', 'l', 'xl']);
    for (const s of READ_SIZES) expect(s.token).toMatch(/^var\(--fs-[\w-]+\)$/);
  });

  it('пустое хранилище — умолчания; запись переживает перечитывание', () => {
    const st = mem();
    expect(readReadingPrefs(st, 'app')).toEqual(DEFAULT_READING_PREFS);
    writeReadingPrefs(st, 'app', { size: 'l', rail: true, collapseMenu: false });
    expect(readReadingPrefs(st, 'app')).toEqual({ size: 'l', rail: true, collapseMenu: false });
    expect(st.get(readingPrefsKey('app'))).toContain('"size":"l"');
  });

  it('битый JSON и чужие значения — умолчания по полю, а не исключение', () => {
    const st = mem();
    st.set(readingPrefsKey('app'), '{oops');
    expect(readReadingPrefs(st, 'app')).toEqual(DEFAULT_READING_PREFS);
    st.set(readingPrefsKey('app'), JSON.stringify({ size: 'huge', rail: 'yes', collapseMenu: false }));
    expect(readReadingPrefs(st, 'app')).toEqual({ size: 'm', rail: false, collapseMenu: false });
  });

  it('ступень Aa меньше/больше упирается в края шкалы', () => {
    expect(stepReadSize('m', 1)).toBe('l');
    expect(stepReadSize('xl', 1)).toBe('xl');
    expect(stepReadSize('s', -1)).toBe('s');
    expect(stepReadSize('l', -1)).toBe('m');
  });
});
