// Источник сохранённой темы для applyTheme/resolvePrefs (S4-00a): тот же выбор,
// что у v1 — localStorage lore-palette/lore-mode (только чтение) и общая cookie
// seer-prefs. Живёт в storage/, потому что к хранилищу браузера v2 обращается
// только этот каталог (гард S3-08 в storage.test.ts).
export interface ThemeSource {
  local: (key: string) => string | null;
  cookie: string;
}

export function themeSource(): ThemeSource {
  return {
    local: k => {
      try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; }
    },
    cookie: typeof document === 'undefined' ? '' : document.cookie,
  };
}
