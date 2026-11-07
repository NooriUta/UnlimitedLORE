// Тема Seiðr-kit (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a): палитра, режим и
// плотность. Выбор читается из тех же мест, что у v1 (src/theme/prefs.ts):
// свой localStorage `lore-palette`/`lore-mode` → общая cookie платформы
// `seer-prefs` → умолчание. Иначе пользователь, переключивший тему в v1 или в
// Verdandi, открыл бы v2 в другой.
//
// Функции чистые (источники передаются аргументами): так их можно проверить
// без DOM, а потребитель сам решает, откуда читать.

export type Palette = 'amber-forest' | 'lichen' | 'slate' | 'juniper' | 'warm-dark';
export type Mode = 'dark' | 'light';
export type Density = 'compact' | 'comfortable';

export interface ThemePrefs {
  palette: Palette;
  mode: Mode;
  density: Density;
}

/** Образец — токен (--swatch-*), а не hex: значения живут только в seidr.css. */
export const PALETTES: readonly { id: Palette; label: string; swatch: string }[] = [
  { id: 'amber-forest', label: 'amber forest', swatch: 'var(--swatch-amber-forest)' },
  { id: 'lichen',       label: 'lichen',       swatch: 'var(--swatch-lichen)' },
  { id: 'slate',        label: 'slate',        swatch: 'var(--swatch-slate)' },
  { id: 'juniper',      label: 'juniper',      swatch: 'var(--swatch-juniper)' },
  { id: 'warm-dark',    label: 'warm dark',    swatch: 'var(--swatch-warm-dark)' },
];

export const MODES: readonly Mode[] = ['dark', 'light'];

/** Первая — умолчание: плотный IDE-подобный UI (base 12). */
export const DENSITIES: readonly Density[] = ['compact', 'comfortable'];

export const DEFAULT_PREFS: ThemePrefs = { palette: 'amber-forest', mode: 'dark', density: 'compact' };

export const STORAGE_KEYS = {
  palette: 'lore-palette',
  mode: 'lore-mode',
  /** Старый общий ключ v1: в нём бывала и палитра (`amber`), и режим. */
  legacy: 'lore-theme',
  density: 'lore-density',
} as const;

export const PREFS_COOKIE = 'seer-prefs';

export interface PrefsSources {
  /** Чтение localStorage (или подмена в тесте). */
  local?: (key: string) => string | null;
  /** Строка document.cookie. */
  cookie?: string;
}

/** Разбор общей cookie платформы; битая cookie = пусто, а не исключение. */
export function readPrefsCookie(cookie: string | undefined): { theme?: string; palette?: string } {
  if (!cookie) return {};
  const m = cookie.match(new RegExp(`(?:^|; )${PREFS_COOKIE}=([^;]*)`));
  if (!m) return {};
  try {
    const v = JSON.parse(decodeURIComponent(m[1])) as unknown;
    return v && typeof v === 'object' ? (v as { theme?: string; palette?: string }) : {};
  } catch {
    return {};
  }
}

/** Прежние значения приложения → имена платформы; неизвестное = null. */
export function normalizePalette(v: string | null | undefined): Palette | null {
  if (!v) return null;
  if (v === 'amber') return 'amber-forest';
  return PALETTES.some(p => p.id === v) ? (v as Palette) : null;
}

export function resolvePrefs(src: PrefsSources): ThemePrefs {
  const local = src.local ?? (() => null);
  const shared = readPrefsCookie(src.cookie);

  const palette = normalizePalette(local(STORAGE_KEYS.palette) ?? local(STORAGE_KEYS.legacy))
    ?? normalizePalette(shared.palette)
    ?? DEFAULT_PREFS.palette;

  const savedMode = local(STORAGE_KEYS.mode) ?? local(STORAGE_KEYS.legacy);
  const mode: Mode = savedMode === 'light' || savedMode === 'dark'
    ? savedMode
    : shared.theme === 'light' ? 'light' : 'dark';

  const savedDensity = local(STORAGE_KEYS.density);
  const density = DENSITIES.find(d => d === savedDensity) ?? DEFAULT_PREFS.density;

  return { palette, mode, density };
}

/**
 * Атрибуты корня под выбор. null = атрибут снять: тёмный режим и компактная
 * плотность — это :root, их отдельные блоки не нужны. data-theme ставится
 * всегда, как в v1.
 */
export function themeAttrs(p: ThemePrefs): Record<'data-theme' | 'data-mode' | 'data-density', string | null> {
  return {
    'data-theme': p.palette,
    'data-mode': p.mode === 'light' ? 'light' : null,
    'data-density': p.density === DEFAULT_PREFS.density ? null : p.density,
  };
}

export interface AttrTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export function applyTheme(el: AttrTarget, p: ThemePrefs): void {
  for (const [k, v] of Object.entries(themeAttrs(p))) {
    if (v === null) el.removeAttribute(k);
    else el.setAttribute(k, v);
  }
}
