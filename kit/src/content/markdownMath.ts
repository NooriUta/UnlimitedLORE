// Копия v1 src/components/lore/markdownMath.ts (S0-09, PR #857) для kit
// (SPRINT_UXR_S10_SEIDR_KIT/K-04): v1 заморожен (D-2026-UXR-V2-FOLDER-V1-FROZEN),
// поэтому копия, а не импорт. Правила долларов править синхронно в обеих копиях.
import katex from 'katex';
import type { MarkedExtension, Tokens } from 'marked';
import 'katex/dist/katex.min.css';

// SPRINT_UXR_S0_SAFETY/S0-09 · формулы LaTeX в Markdown (KaTeX).
//
// Расширение marked — подключается в общем `markdown.ts`, поэтому формулы
// рисуются во ВСЕХ read-only рендерерах (MartProse, BragiSkinPreview…), а не в
// одном экране. Файл самодостаточен (katex + CSS + правила долларов), чтобы
// kit/v2 (SPRINT_UXR_S5_RECORD_TASKS/S5-13) подключил его как есть:
// `marked.use(markedMath())`.
//
// Синтаксис:
//   $…$       — строчная формула;
//   $$…$$     — выключная (отдельным блоком с начала строки или внутри абзаца);
//   ```math   — выключная формула фенсом.
//
// Правила долларов (как в Pandoc), чтобы цены не становились формулами:
//   - после открывающего `$` нет пробела, перед закрывающим нет пробела;
//   - сразу за закрывающим `$` не идёт цифра;
//   - строчная формула не переходит через перевод строки;
//   - `\$` — экранированный доллар, обычный текст.
// Поэтому «$5» и «$5 и $10» остаются текстом.
//
// Ошибка разбора не превращается в пустоту: рисуется исходник формулы и текст
// ошибки KaTeX (класс `math-error`), чтобы автор видел, что и где сломано.

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** TeX → HTML. Никогда не бросает: при ошибке разбора — исходник + сообщение. */
export function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: true, output: 'htmlAndMathml', strict: 'ignore' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const tag = displayMode ? 'div' : 'span';
    const src = displayMode ? `$$${tex}$$` : `$${tex}$`;
    return `<${tag} class="math-error" role="note" style="color: var(--dng); font-family: var(--mono);">`
      + `<code>${escapeHtml(src)}</code> <span class="math-error-msg">⚠ ${escapeHtml(msg)}</span></${tag}>`;
  }
}

// Строчная `$…$`: не пробел после `$`, не пробел перед `$`, без перевода строки,
// не цифра за закрывающим `$`. `\\.` пропускает экранированные символы (в т.ч. `\$`).
const INLINE_MATH = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/;
// Выключная внутри строки: `$$…$$`.
const INLINE_DISPLAY = /^\$\$((?:\\.|[^\\$])+?)\$\$/;
// Выключная блоком: `$$` с начала строки (до 3 пробелов отступа), закрытие — в конце строки.
const BLOCK_MATH = /^ {0,3}\$\$((?:\\.|[^\\$])+?)\$\$[ \t]*(?:\n+|$)/;

interface MathToken extends Tokens.Generic {
  type: 'math' | 'inlineMath';
  text: string;
  displayMode: boolean;
}

export function markedMath(): MarkedExtension {
  return {
    extensions: [
      {
        name: 'math',
        level: 'block',
        // Только `$$` в начале строки: середина строки — дело строчного токенайзера,
        // иначе абзац резался бы на каждом встреченном `$$`.
        start(src: string) {
          const m = /(?:^|\n) {0,3}\$\$/.exec(src);
          if (!m) return undefined;
          return m.index + (m[0].startsWith('\n') ? 1 : 0);
        },
        tokenizer(src: string): MathToken | undefined {
          const m = BLOCK_MATH.exec(src);
          if (!m) return undefined;
          return { type: 'math', raw: m[0], text: m[1].trim(), displayMode: true };
        },
        renderer(token) {
          return `${renderMath((token as MathToken).text, true)}\n`;
        },
      },
      {
        name: 'inlineMath',
        level: 'inline',
        start(src: string) {
          const i = src.indexOf('$');
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string): MathToken | undefined {
          const d = INLINE_DISPLAY.exec(src);
          if (d) return { type: 'inlineMath', raw: d[0], text: d[1].trim(), displayMode: true };
          const m = INLINE_MATH.exec(src);
          if (m) return { type: 'inlineMath', raw: m[0], text: m[1], displayMode: false };
          return undefined;
        },
        renderer(token) {
          const t = token as MathToken;
          return renderMath(t.text, t.displayMode);
        },
      },
    ],
    renderer: {
      // ```math — выключная формула; прочие фенсы — штатный рендер marked.
      code(token: Tokens.Code) {
        if ((token.lang ?? '').trim().split(/\s+/)[0] === 'math') return `${renderMath(token.text.trim(), true)}\n`;
        return false;
      },
    },
  };
}
