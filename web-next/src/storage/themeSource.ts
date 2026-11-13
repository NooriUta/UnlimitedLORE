// Источник сохранённой темы для applyTheme/resolvePrefs (S4-00a): тот же выбор,
// что у v1 — localStorage lore-palette/lore-mode (только чтение) и общая cookie
// seer-prefs. Живёт в storage/, потому что к хранилищу браузера v2 обращается
// только этот каталог (гард S3-08 в storage.test.ts).
import type { StorageKeys } from '@seidr/kit';
import { SHARED_PREFS_COOKIE } from './storage';

/** Ключи выбора темы LORE — общие с v1 (K-14: имена приложения, не kit). */
export const LORE_THEME_KEYS: StorageKeys = {
  palette: 'lore-palette',
  mode: 'lore-mode',
  legacy: 'lore-theme',
  density: 'lore-density',
};

export interface ThemeSource {
  local: (key: string) => string | null;
  cookie: string;
  keys: StorageKeys;
  cookieName: string;
}

export function themeSource(): ThemeSource {
  return {
    local: k => {
      try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; }
    },
    cookie: typeof document === 'undefined' ? '' : document.cookie,
    keys: LORE_THEME_KEYS,
    cookieName: SHARED_PREFS_COOKIE,
  };
}
