// SPRINT_VIZ_EMBED/EMB-L2 — встроенный график Völva (статическая встройка
// Metabase, decision:D-2026-VIZ-EMBED-STATIC-GANTT-FIRST). Рецепт сессии Völva
// (task:SPRINT_VIZ_EMBED/VE-5, 06.11.2026):
//  - высоту встройка шлёт сама: postMessage({metabase:{type:"frame",
//    frame:{mode, height}}}, "*") при каждом изменении;
//  - тему принимает ТОЛЬКО через #hash адреса фрейма (theme, bordered, titled,
//    locale) — отдельного сообщения для темы у апстрима нет;
//  - отправитель шлёт с targetOrigin "*", а в адресе фрейма лежит JWT, поэтому
//    сообщению доверяем лишь при origin, равном origin подписанного адреса.

// VE-4 (Völva PR #49, 07.11.2026): статическая встройка принимает палитру AIDA
// и режим в hash — #theme=transparent&palette=<id>&mode=light|dark. Фон
// прозрачный (берётся у LORE), акценты и оси — в палитре страницы.
export const EMBED_PALETTES = ['amber-forest', 'lichen', 'slate', 'juniper', 'warm-dark', 'rosewood'] as const;
export type EmbedPalette = typeof EMBED_PALETTES[number];
export interface EmbedTheme { palette: EmbedPalette; mode: 'light' | 'dark' }

/** Адрес фрейма: подписанный URL (JWT в пути не трогаем) + оформление в hash. */
export function embedSrc(signedUrl: string, theme: EmbedTheme): string {
  const base = signedUrl.split('#')[0];
  const hash = new URLSearchParams({
    theme: 'transparent', palette: theme.palette, mode: theme.mode,
    bordered: 'false', titled: 'false', locale: 'ru',
  });
  return `${base}#${hash.toString()}`;
}

/** Палитра и режим по атрибутам <html> LORE: data-theme (нет → amber-forest), data-mode (нет → dark). */
export function themeFromAttrs(dataTheme: string | null, dataMode: string | null): EmbedTheme {
  const palette = (EMBED_PALETTES as readonly string[]).includes(dataTheme ?? '') ? dataTheme as EmbedPalette : 'amber-forest';
  return { palette, mode: dataMode === 'light' ? 'light' : 'dark' };
}

/** Origin, с которого единственно принимаются сообщения фрейма. */
export function embedOrigin(signedUrl: string): string | null {
  try {
    return new URL(signedUrl).origin;
  } catch {
    return null;
  }
}

/** Высота из сообщения встройки — только с ожидаемого origin и только type:"frame". */
export function frameHeightFromMessage(
  e: { origin: string; data: unknown },
  expectedOrigin: string | null,
): number | null {
  if (!expectedOrigin || e.origin !== expectedOrigin) return null;
  const mb = (e.data as { metabase?: { type?: string; frame?: { height?: unknown } } } | null)?.metabase;
  if (!mb || mb.type !== 'frame') return null;
  const h = mb.frame?.height;
  return typeof h === 'number' && Number.isFinite(h) && h > 0 ? Math.ceil(h) : null;
}

/** Тема встройки по текущей теме LORE. */
export function themeForHost(): EmbedTheme {
  if (typeof document === 'undefined') return themeFromAttrs(null, null);
  const el = document.documentElement;
  return themeFromAttrs(el.getAttribute('data-theme'), el.getAttribute('data-mode'));
}
