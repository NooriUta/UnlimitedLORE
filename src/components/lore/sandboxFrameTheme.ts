// AH-10: цвета песочницы HTML — из токенов темы хоста.
//
// iframe с srcdoc не наследует CSS-переменные родителя: `var(--t1)` внутри него
// пуст. Поэтому стили рамки раньше были прибиты hex-ами тёмной темы, и в
// светлой теме светло-серый текст на белом не читался. Значения токенов
// читаются у хоста (getComputedStyle) и передаются внутрь уже вычисленными.

export interface FrameTheme {
  text: string;
  link: string;
  codeBg: string;
  border: string;
  fontSize: string;
  font: string;
}

/** Если токен не задан — системные цвета CSS (подстраиваются под color-scheme), не hex. */
export const FRAME_THEME_FALLBACK: FrameTheme = {
  text: 'CanvasText',
  link: 'LinkText',
  codeBg: 'transparent',
  border: 'GrayText',
  fontSize: 'inherit',
  font: 'system-ui, sans-serif',
};

/** Какой токен хоста за какую роль отвечает. */
const TOKEN_OF: Record<keyof FrameTheme, string> = {
  text: '--t1',
  link: '--acc',
  codeBg: '--bg2',
  border: '--bd',
  fontSize: '--fs-base',
  font: '--font',
};

/** `read(name)` — значение CSS-переменной хоста (обычно getPropertyValue). */
export function readFrameTheme(read: (name: string) => string): FrameTheme {
  const out = { ...FRAME_THEME_FALLBACK };
  for (const key of Object.keys(TOKEN_OF) as (keyof FrameTheme)[]) {
    const v = (read(TOKEN_OF[key]) ?? '').trim();
    if (v) out[key] = v;
  }
  return out;
}

/** Тема хоста по документу; вне браузера — запасные значения. */
export function hostFrameTheme(): FrameTheme {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return { ...FRAME_THEME_FALLBACK };
  const cs = getComputedStyle(document.documentElement);
  return readFrameTheme(name => cs.getPropertyValue(name));
}

/** CSS, вкладываемый в srcdoc песочницы. Без единого прибитого цвета. */
export function frameThemeCss(th: FrameTheme): string {
  return (
    `body{margin:0;font-family:${th.font};font-size:${th.fontSize};` +
    `color:${th.text};background:transparent;word-break:break-word;}` +
    `a{color:${th.link};}` +
    `pre,code{background:${th.codeBg};border-radius:3px;padding:2px 4px;}` +
    `table{border-collapse:collapse;}td,th{padding:4px 8px;border:1px solid ${th.border};}`
  );
}
