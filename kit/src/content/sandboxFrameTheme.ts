// Цвета песочницы HTML — из токенов темы хоста (S4-00d; копия v1
// src/components/lore/sandboxFrameTheme.ts, AH-10).
//
// iframe с srcdoc не наследует CSS-переменные родителя: `var(--t1)` внутри него
// пуст. Значения токенов читаются у хоста (getComputedStyle) и передаются
// внутрь уже вычисленными — ни одного прибитого цвета.

export interface FrameTheme {
  text: string;
  link: string;
  codeBg: string;
  border: string;
  fontSize: string;
  font: string;
  /**
   * Схема цвета хоста (`color-scheme`: dark/light). K4-SANDBOX-DARK-CONTRAST:
   * без неё документ srcdoc светлый, хост тёмный — и при несовпадении схем браузер
   * подкладывает под iframe непрозрачный светлый Canvas (CSS Color Adjust §2.2):
   * светлый текст тёмной темы оказывался на белом. Схема едет вместе с цветами —
   * фон и текст всегда из одной темы.
   */
  scheme: string;
}

/** Если токен не задан — системные цвета CSS (подстраиваются под color-scheme), не hex. */
export const FRAME_THEME_FALLBACK: FrameTheme = {
  text: 'CanvasText',
  link: 'LinkText',
  codeBg: 'transparent',
  border: 'GrayText',
  fontSize: 'inherit',
  font: 'system-ui, sans-serif',
  // normal + системные CanvasText/Canvas — пара из одной (браузерной) схемы.
  scheme: 'normal',
};

/** Какой токен хоста за какую роль отвечает. */
const TOKEN_OF: Record<keyof FrameTheme, string> = {
  text: '--t1',
  link: '--acc',
  codeBg: '--bg2',
  border: '--bd',
  fontSize: '--fs-base',
  font: '--font',
  // Не токен, а вычисленное свойство корня хоста: getPropertyValue читает и его.
  scheme: 'color-scheme',
};

/** `read(name)` — значение CSS-переменной (или свойства) хоста (обычно getPropertyValue). */
export function readFrameTheme(read: (name: string) => string): FrameTheme {
  const out = { ...FRAME_THEME_FALLBACK };
  for (const key of Object.keys(TOKEN_OF) as (keyof FrameTheme)[]) {
    const v = (read(TOKEN_OF[key]) ?? '').trim();
    if (v) out[key] = v;
  }
  return out;
}

/**
 * Тема хоста там, где стоит песочница: `at` — сам iframe (токены и color-scheme
 * наследуются им от ближайшего [data-mode]); без него — корень документа. Тема
 * поддерева (витрина /kit, «Светлая» на обёртке) иначе не доходила бы до рамки.
 * Вне браузера — запасные значения.
 */
export function hostFrameTheme(at?: Element | null): FrameTheme {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return { ...FRAME_THEME_FALLBACK };
  const cs = getComputedStyle(at ?? document.documentElement);
  return readFrameTheme(name => cs.getPropertyValue(name));
}

/** CSS, вкладываемый в srcdoc песочницы. Без единого прибитого цвета. */
export function frameThemeCss(th: FrameTheme): string {
  // Схема — только слово (dark/light/normal…): значение уходит внутрь <style>.
  const scheme = /^[a-z\s-]+$/i.test(th.scheme) ? th.scheme : FRAME_THEME_FALLBACK.scheme;
  return (
    `:root{color-scheme:${scheme};}` +
    `body{margin:0;font-family:${th.font};font-size:${th.fontSize};` +
    `color:${th.text};background:transparent;word-break:break-word;}` +
    `a{color:${th.link};}` +
    `pre,code{background:${th.codeBg};border-radius:3px;padding:2px 4px;}` +
    `table{border-collapse:collapse;}td,th{padding:4px 8px;border:1px solid ${th.border};}`
  );
}
