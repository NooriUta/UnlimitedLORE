// Рамка встроенного графика — чистые функции (SPRINT_VIZ_EMBED/EMB-L2, VE-4).
// Перенос v1 src/components/lore/volvaEmbed.ts в kit для v2. Kit не знает,
// откуда берётся подписанный адрес: его выдаёт приложение (K-14).
//
// Рецепт апстрима статической встройки (VE-5, 06.11.2026):
//  - высоту встройка шлёт сама: postMessage({metabase:{type:"frame",
//    frame:{mode, height}}}, "*") при каждом изменении;
//  - тему принимает ТОЛЬКО через #hash адреса фрейма (theme, palette, mode,
//    bordered, titled, locale) — отдельного сообщения для темы нет;
//  - отправитель шлёт с targetOrigin "*", а в адресе фрейма лежит JWT, поэтому
//    сообщению доверяем лишь при origin, равном origin подписанного адреса.
//
// VE-4 (PR #49 встройки, 07.11.2026): #theme=transparent&palette=<id>&mode=light|dark —
// фон прозрачный (берётся у страницы), акценты и оси — в палитре страницы.

/** Палитры, которые знает встройка. Палитра страницы вне списка — откат к первой. */
export const EMBED_PALETTES = ['amber-forest', 'lichen', 'slate', 'juniper', 'warm-dark', 'rosewood'] as const;
export type EmbedPalette = typeof EMBED_PALETTES[number];
export interface EmbedTheme { palette: EmbedPalette; mode: 'light' | 'dark' }

export interface EmbedSrcOptions {
  /** Язык встройки (locale в hash); по умолчанию ru. */
  locale?: string;
  /**
   * Открытый (не запертый) параметр карточки — сужает картинку, граница прав
   * в токене. undefined — параметр не трогаем; [] — «все», без ?product.
   */
  products?: string[];
}

/** Адрес фрейма: подписанный URL (JWT в пути не трогаем) + оформление в hash. */
export function embedSrc(signedUrl: string, theme: EmbedTheme, opts: EmbedSrcOptions = {}): string {
  const url = new URL(signedUrl.split('#')[0]);
  const { products } = opts;
  (products ?? []).filter(Boolean).forEach(p => url.searchParams.append('product', p));
  const hash = new URLSearchParams({
    theme: 'transparent', palette: theme.palette, mode: theme.mode,
    bordered: 'false', titled: 'false', locale: opts.locale ?? 'ru',
  });
  if (products !== undefined) hash.set('hide_parameters', 'product');
  return `${url.toString()}#${hash.toString()}`;
}

/** Палитра и режим по атрибутам корня: data-theme (нет/чужая → amber-forest), data-mode (нет → dark). */
export function embedThemeFromAttrs(dataTheme: string | null, dataMode: string | null): EmbedTheme {
  const palette = (EMBED_PALETTES as readonly string[]).includes(dataTheme ?? '') ? dataTheme as EmbedPalette : 'amber-forest';
  return { palette, mode: dataMode === 'light' ? 'light' : 'dark' };
}

/** Тема встройки по текущим атрибутам <html>. */
export function embedThemeOfDocument(): EmbedTheme {
  if (typeof document === 'undefined') return embedThemeFromAttrs(null, null);
  const el = document.documentElement;
  return embedThemeFromAttrs(el.getAttribute('data-theme'), el.getAttribute('data-mode'));
}

/**
 * Origin подписанного адреса — единственный, с которого принимаются сообщения
 * фрейма и на который (если понадобится) шлются сообщения ему. Не http(s) —
 * null: такой адрес в рамку не идёт вовсе.
 */
export function embedOrigin(signedUrl: string): string | null {
  try {
    const u = new URL(signedUrl);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
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
  const data = e.data;
  if (!data || typeof data !== 'object') return null;
  const mb = (data as { metabase?: { type?: string; frame?: { height?: unknown } } }).metabase;
  if (!mb || mb.type !== 'frame') return null;
  const h = mb.frame?.height;
  return typeof h === 'number' && Number.isFinite(h) && h > 0 ? Math.ceil(h) : null;
}
