// WCAG 2.2 — относительная яркость и контраст (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-12).
// Контраст в jsdom axe не считает (нет раскладки и вычисленных цветов), поэтому
// AA проверяется на самих токенах: пара «текст на поверхности» из seidr.css —
// для каждой палитры в обоих режимах (kit/src/styles/contrast.test.ts).

/** Порог AA для обычного текста (1.4.3). */
export const AA_TEXT = 4.5;
/** Порог AA для нетекстовых элементов и крупного текста (1.4.11). */
export const AA_NON_TEXT = 3;

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Относительная яркость цвета в форме `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`relativeLuminance: ожидался цвет #rrggbb, получено «${hex}»`);
  const [r, g, b] = [m[1], m[2], m[3]].map(x => channel(Number.parseInt(x, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Контраст двух цветов (1…21), порядок аргументов не важен. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
