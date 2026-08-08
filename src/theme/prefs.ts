// Общие настройки внешнего вида платформы (палитра/режим).
//
// Cookie, а не localStorage: страница входа (LoginScreen) рендерится ДО
// авторизации — тот же ориджин и бандл, что и AppShell, но её могут открыть
// и не заходя в приложение вовсе (истёкшая сессия). Cookie ставится с
// `Domain=.<host>`, поэтому видна и Keycloak-теме на другом поддомене.
export type Palette = 'amber-forest' | 'lichen' | 'slate' | 'juniper' | 'warm-dark';
export type Mode    = 'dark' | 'light';

export const PALETTES: { id: Palette; label: string; swatch: string }[] = [
  { id: 'amber-forest', label: 'amber forest', swatch: '#A8B860' },
  { id: 'lichen',       label: 'lichen',       swatch: '#7CB870' },
  { id: 'slate',        label: 'slate',        swatch: '#6aa6ff' },
  { id: 'juniper',      label: 'juniper',      swatch: '#50C090' },
  { id: 'warm-dark',    label: 'warm dark',    swatch: '#D4A830' },
];

const PREFS_COOKIE = 'seer-prefs';

export function readPrefs(): { theme?: string; palette?: string } {
  const m = document.cookie.match(/(?:^|; )seer-prefs=([^;]*)/);
  if (!m) return {};
  try { return JSON.parse(decodeURIComponent(m[1])) as { theme?: string; palette?: string }; }
  catch { return {}; }
}

export function writePrefs(patch: { theme?: string; palette?: string }) {
  const next = { ...readPrefs(), ...patch };
  const h = location.hostname;
  // Домен не ставим для localhost и голых IP — браузер отвергнет такую cookie
  // целиком, и настройка не сохранится вовсе (та же проверка в теме входа).
  const domain = (!h || h === 'localhost' || !h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h))
    ? '' : '; Domain=.' + h.split('.').slice(-3).join('.');
  document.cookie = `${PREFS_COOKIE}=${encodeURIComponent(JSON.stringify(next))}`
    + '; Path=/; Max-Age=31536000; SameSite=Lax' + domain;
}

/** Прежние значения приложения → имена платформы. */
export function normalizePalette(v: string | null | undefined): Palette | null {
  if (!v) return null;
  if (v === 'amber') return 'amber-forest'; // старое имя того же цвета
  return PALETTES.some(p => p.id === v) ? (v as Palette) : null;
}

/** Порядок источников: свой localStorage → общая cookie платформы → умолчание. */
export function resolvePalette(): Palette {
  return normalizePalette(localStorage.getItem('lore-palette') ?? localStorage.getItem('lore-theme'))
    ?? normalizePalette(readPrefs().palette)
    ?? 'amber-forest';
}

export function resolveMode(): Mode {
  const saved = localStorage.getItem('lore-mode') ?? localStorage.getItem('lore-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return readPrefs().theme === 'light' ? 'light' : 'dark';
}

/** Проставляет data-theme/data-mode на <html> по текущим сохранённым настройкам. */
export function applyStoredTheme(): void {
  const el = document.documentElement;
  el.setAttribute('data-theme', resolvePalette());
  if (resolveMode() === 'light') el.setAttribute('data-mode', 'light');
  else                           el.removeAttribute('data-mode');
}
