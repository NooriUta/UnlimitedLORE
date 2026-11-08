// SPRINT_UXR_S5_RECORD_TASKS/S5-13 · формулы LaTeX в поле правки kit (TipTap).
//
// Чтение уже рисует KaTeX (markdownMath.ts → marked, K-04). Здесь — та же
// грамматика долларов для редактора: tiptap-markdown разбирает markdown через
// markdown-it, поэтому правила $…$ / $$…$$ подключаются к нему плагином, а
// формулы живут в документе атомарными узлами и рисуются KaTeX (renderMath —
// общий с чтением, включая честный показ ошибки разбора).
//
// Главное — круг «Markdown → TipTap → Markdown» без потерь (к S5-07):
//  - исходник формулы хранится как есть (атрибут tex) и пишется обратно
//    байт-в-байт: без экранирования `\` и `_`, которое иначе делает
//    сериализатор текста (`\frac` превращался в `\\frac`);
//  - обычный текст, который при повторном разборе стал бы формулой
//    (из исходного `\$x\$`), пишется с экранированными долларами — иначе
//    сохранение молча превращало бы текст в формулу;
//  - цены («$5 и $10») не формулы ни при разборе, ни при записи;
//  - фенс ```math остаётся блоком кода: в редакторе он виден исходником и
//    возвращается как был (в чтении он — формула).
import { Node, mergeAttributes } from '@tiptap/core';
import type { NodeViewRendererProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { renderMath } from './markdownMath';

// Те же правила, что markdownMath.ts (Pandoc): после открывающего `$` не пробел,
// перед закрывающим не пробел, за ним не цифра, строчная — без перевода строки.
const INLINE_MATH = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/;
const INLINE_DISPLAY = /^\$\$((?:\\.|[^\\$])+?)\$\$/;
// Блок: `$$` в начале строки, закрывающий `$$` — в конце строки.
const BLOCK_MATH = /^\$\$((?:\\.|[^\\$])+?)\$\$[ \t]*$/;
const BLOCK_CLOSE = /^\$\$(?:\\.|[^\\$])+?\$\$/;

/** Найти формулу в начале строки так же, как строчный токенайзер чтения. */
export function matchInlineMath(src: string): { raw: string; tex: string; display: boolean } | null {
  const d = INLINE_DISPLAY.exec(src);
  if (d) return { raw: d[0], tex: d[1], display: true };
  const m = INLINE_MATH.exec(src);
  if (m) return { raw: m[0], tex: m[1], display: false };
  return null;
}

/**
 * Доллары обычного текста, которые при повторном разборе образовали бы
 * формулу, — экранировать. Остальные (цены) не трогать: запись остаётся той,
 * что написал автор.
 */
export function escapeMathDollars(text: string, dollar = '\\$'): string {
  if (!text.includes('$')) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '$') {
      const m = matchInlineMath(text.slice(i));
      if (m) {
        out += m.raw.split('$').join(dollar);
        i += m.raw.length;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── markdown-it ─────────────────────────────────────────────────────────────
// Узкие интерфейсы вместо типов markdown-it: kit не зависит от него напрямую
// (его приносит tiptap-markdown).
interface MdToken { content: string; markup: string; block: boolean; map: [number, number] | null; meta: unknown }
interface MdInlineState { src: string; pos: number; posMax: number; push(type: string, tag: string, nesting: number): MdToken }
interface MdBlockState {
  src: string; bMarks: number[]; eMarks: number[]; tShift: number[]; sCount: number[]; blkIndent: number; line: number;
  push(type: string, tag: string, nesting: number): MdToken;
}
interface MdRuler<S> { before(name: string, rule: string, fn: S, opts?: { alt?: string[] }): void }
interface MarkdownItLike {
  inline: { ruler: MdRuler<(state: MdInlineState, silent: boolean) => boolean> };
  block: { ruler: MdRuler<(state: MdBlockState, startLine: number, endLine: number, silent: boolean) => boolean> };
  renderer: { rules: Record<string, (tokens: MdToken[], idx: number) => string> };
}

function mathInlineRule(state: MdInlineState, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) return false;
  const m = matchInlineMath(state.src.slice(state.pos, state.posMax));
  if (!m) return false;
  if (!silent) {
    const t = state.push('math_inline', 'span', 0);
    t.content = m.tex;
    t.markup = m.display ? '$$' : '$';
    t.meta = { display: m.display };
  }
  state.pos += m.raw.length;
  return true;
}

function mathBlockRule(state: MdBlockState, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  if (state.src.charCodeAt(pos) !== 0x24 || state.src.charCodeAt(pos + 1) !== 0x24) return false;
  // Текст собирается построчно от bMarks: внутри цитаты/списка markdown-it уже
  // сдвинул начало строк за `> ` и отступ, и формула не захватит префиксы.
  let text = '';
  let last = startLine;
  let m: RegExpExecArray | null = null;
  for (; last < endLine; last += 1) {
    const from = last === startLine ? pos : state.bMarks[last];
    text += (last === startLine ? '' : '\n') + state.src.slice(from, state.eMarks[last]);
    const close = BLOCK_CLOSE.exec(text);
    if (!close) continue;
    // Закрывающий `$$` не в конце строки — это не блок (строчная выключная).
    m = BLOCK_MATH.exec(text);
    if (!m || m[0].length !== text.length) return false;
    break;
  }
  if (!m) return false;
  if (silent) return true;
  const t = state.push('math_block', 'div', 0);
  t.block = true;
  t.content = m[1];
  t.markup = '$$';
  t.map = [startLine, last + 1];
  state.line = last + 1;
  return true;
}

// Парсер tiptap-markdown зовёт setup на каждом разборе — ставим правила один раз.
const installed = new WeakSet<object>();

export function installMathMarkdownIt(md: MarkdownItLike): void {
  if (installed.has(md)) return;
  installed.add(md);
  // До escape: внутри формулы `\frac` — не экранирование, а TeX.
  md.inline.ruler.before('escape', 'math_inline', mathInlineRule);
  md.block.ruler.before('fence', 'math_block', mathBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.math_inline = (tokens, idx) => {
    const t = tokens[idx];
    const display = (t.meta as { display?: boolean } | null)?.display ? ' data-display="true"' : '';
    return `<span data-type="math-inline" data-tex="${escapeAttr(t.content)}"${display}></span>`;
  };
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div data-type="math-block" data-tex="${escapeAttr(tokens[idx].content)}"></div>\n`;
}

// ── узлы TipTap ─────────────────────────────────────────────────────────────

export interface MathNodeOptions {
  /**
   * Спросить новый исходник формулы (двойной клик по формуле). null — отмена,
   * пустая строка — удалить формулу. Не задан — формулы правятся в режиме md.
   */
  promptTex: ((tex: string) => string | null) | null;
}

interface SerializerState { text(text: string, escape?: boolean): void; closeBlock(node: PMNode): void; out: string; esc(s: string, startOfLine?: boolean): string }

function mathNodeView(block: boolean, options: MathNodeOptions) {
  return ({ node, editor, getPos }: NodeViewRendererProps) => {
    let current = node as PMNode;
    const dom = document.createElement(block ? 'div' : 'span');
    dom.className = block ? 'sk-md__math sk-md__math--block' : 'sk-md__math';
    dom.setAttribute('data-type', block ? 'math-block' : 'math-inline');
    dom.contentEditable = 'false';
    const paint = (n: PMNode) => {
      const tex = String(n.attrs.tex ?? '');
      // renderMath не бросает: при ошибке — исходник + сообщение KaTeX.
      dom.innerHTML = renderMath(tex.trim(), block || Boolean(n.attrs.display));
      dom.title = tex.trim();
    };
    paint(current);
    dom.addEventListener('dblclick', e => {
      if (!options.promptTex || !editor.isEditable || typeof getPos !== 'function') return;
      e.preventDefault();
      const next = options.promptTex(String(current.attrs.tex ?? ''));
      if (next === null) return;
      const pos = getPos();
      if (typeof pos !== 'number') return;
      editor.chain().focus().command(({ tr }) => {
        if (next.trim() === '') tr.delete(pos, pos + current.nodeSize);
        else tr.setNodeMarkup(pos, undefined, { ...current.attrs, tex: next });
        return true;
      }).run();
    });
    return {
      dom,
      update(n: PMNode) {
        if (n.type !== current.type) return false;
        current = n;
        paint(n);
        return true;
      },
      ignoreMutation: () => true,
    };
  };
}

export const MathInline = Node.create<MathNodeOptions>({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { promptTex: null };
  },
  addAttributes() {
    return {
      tex: { default: '', parseHTML: el => el.getAttribute('data-tex') ?? '', renderHTML: a => ({ 'data-tex': a.tex }) },
      display: {
        default: false,
        parseHTML: el => el.getAttribute('data-display') === 'true',
        renderHTML: a => (a.display ? { 'data-display': 'true' } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-type': 'math-inline' }, HTMLAttributes)];
  },
  renderText({ node }) {
    const d = node.attrs.display ? '$$' : '$';
    return `${d}${node.attrs.tex}${d}`;
  },
  addNodeView() {
    return mathNodeView(false, this.options);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          const d = node.attrs.display ? '$$' : '$';
          // escape=false: исходник TeX пишется как есть.
          state.text(`${d}${node.attrs.tex}${d}`, false);
        },
        parse: {
          setup(md: MarkdownItLike) { installMathMarkdownIt(md); },
        },
      },
    };
  },
});

export const MathBlock = Node.create<MathNodeOptions>({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addOptions() {
    return { promptTex: null };
  },
  addAttributes() {
    return {
      tex: { default: '', parseHTML: el => el.getAttribute('data-tex') ?? '', renderHTML: a => ({ 'data-tex': a.tex }) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'math-block' }, HTMLAttributes)];
  },
  renderText({ node }) {
    return `$$${node.attrs.tex}$$`;
  },
  addNodeView() {
    return mathNodeView(true, this.options);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          state.text(`$$${node.attrs.tex}$$`, false);
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownItLike) { installMathMarkdownIt(md); },
        },
      },
    };
  },
});

/**
 * Текстовый узел со своей записью в markdown: штатная (tiptap-markdown) плюс
 * экранирование долларов, которые иначе стали бы формулой. Ставится вместо
 * Text из StarterKit (`StarterKit.configure({ text: false })`).
 */
export const MathSafeText = Node.create({
  name: 'text',
  group: 'inline',
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          const raw = (node.text ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          // Сначала штатное экранирование (оно удваивает `\`), потом доллары —
          // иначе `\$` превратился бы в `\\$`. Доллар-формулу помечаем символом
          // из области частного использования и меняем на `\$` в готовом выводе.
          const MARK = '';
          const marked = escapeMathDollars(raw, MARK);
          const from = state.out.length;
          state.text(marked);
          state.out = state.out.slice(0, from) + state.out.slice(from).split(MARK).join('\\$');
        },
        parse: {},
      },
    };
  },
});
