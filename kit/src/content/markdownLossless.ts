// SPRINT_UXR_S5_RECORD_TASKS/S5-07 · слой «Markdown → TipTap → Markdown без потерь».
//
// TipTap хранит документ деревом ProseMirror, tiptap-markdown разбирает MD
// через markdown-it и пишет обратно через prosemirror-markdown. Всё, чего
// схема не знает, на этом круге меняется молча (замер на голом TipTap):
//   - [[ссылка]] → «\[\[ссылка\]\]»: рендер тот же, но ребро-ссылка пропадает;
//   - `\|` в ячейке → «|»: таблица разваливается на лишний столбец;
//   - [текст](lore:…) → «текст»: Link пропускает только http(s)/mailto/…;
//   - перенос строки внутри абзаца → пробел: блоки «:::», многострочные
//     формулы и цитаты склеиваются в одну строку;
//   - формула → удвоенные «\\» и «\_», `\$` → голый «$» (станет формулой);
//   - HTML-комментарий → «&lt;!-- … --&gt;» — видимый текст;
//   - чек-лист → «рыхлый» список (пустые строки между пунктами).
//
// Общее правило: то, что LORE пишет в MD, но схема TipTap не моделирует,
// становится атомом с исходником (mdRaw / mdRawBlock) и выводится обратно
// байт-в-байт; то, что схема моделирует, сериализуется так, чтобы marked
// разобрал его так же. Вид, который не покрыт, ловит тест S5-07
// (markdownRoundTrip.test.tsx): новый вид в телах — новая строка в его CORPUS.
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Markdown } from 'tiptap-markdown';
import { MathBlock, MathInline, MathSafeText, type MathNodeOptions } from './tiptapMath';

// --- минимальные типы markdown-it / prosemirror-markdown, которыми пользуемся ---
interface MdToken { content: string; meta: unknown; map: [number, number] | null }
interface MdInlineState { src: string; pos: number; posMax: number; push(type: string, tag: string, nesting: number): MdToken }
interface MdBlockState {
  src: string; bMarks: number[]; eMarks: number[]; tShift: number[]; sCount: number[];
  blkIndent: number; line: number;
  getLines(begin: number, end: number, indent: number, keepLastLF: boolean): string;
  push(type: string, tag: string, nesting: number): MdToken;
}
interface MarkdownIt {
  inline: { ruler: { before(name: string, rule: string, fn: (s: MdInlineState, silent: boolean) => boolean): void } };
  block: { ruler: { before(name: string, rule: string, fn: (s: MdBlockState, start: number, end: number, silent: boolean) => boolean): void } };
  renderer: { rules: Record<string, (tokens: MdToken[], idx: number) => string> };
}
interface SerializerState {
  out: string;
  inTable?: boolean;
  write(s?: string): void;
  text(s: string, escape?: boolean): void;
  ensureNewLine(): void;
  closeBlock(node: PMNode): void;
  renderInline(node: PMNode): void;
}

/** Виды атомов-исходников: что именно сохранено байт-в-байт. */
export type MdRawKind = 'wikilink' | 'math' | 'escape' | 'directive' | 'comment';

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Правила регистрируются один раз на экземпляр markdown-it: tiptap-markdown
// зовёт setup при КАЖДОМ разборе одного и того же экземпляра.
const patched = new WeakSet<object>();

// [[…]] — все три формы ссылок LORE (с типом, вики, с подписью через «|»).
const WIKILINK = /^\[\[[^[\]\n]+\]\]/;

function rawInlineRule(state: MdInlineState, silent: boolean): boolean {
  const rest = state.src.slice(state.pos, state.posMax);
  let raw: string | null = null;
  let kind: MdRawKind = 'math';
  if (rest.startsWith('\\$')) { raw = '\\$'; kind = 'escape'; }
  else if (rest.startsWith('[[')) { const m = WIKILINK.exec(rest); if (m) { raw = m[0]; kind = 'wikilink'; } }
  else if (rest.startsWith('$')) {
    // Те же правила долларов, что у marked (markdownMath): «$5» — не формула.
    const m = INLINE_DISPLAY.exec(rest) ?? INLINE_MATH.exec(rest);
    if (m) raw = m[0];
  }
  if (raw === null) return false;
  if (!silent) {
    const token = state.push('md_raw', '', 0);
    token.content = raw;
    token.meta = { kind };
  }
  state.pos += raw.length;
  return true;
}

function lineAt(state: MdBlockState, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}

// Блоки, которых marked не знает, но которые живут в телах LORE: директивы
// «:::имя … :::» и HTML-комментарии-метки. Разбираются как атом до закрытия;
// нет закрытия — не блок (останется абзацем, как и у marked).
function rawBlockRule(state: MdBlockState, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const first = lineAt(state, startLine);
  let kind: MdRawKind;
  let isEnd: (s: string) => boolean;
  if (/^:::[^:\s]/.test(first) || /^::: +\S/.test(first)) { kind = 'directive'; isEnd = s => /^:::\s*$/.test(s); }
  else if (first.startsWith('<!--')) { kind = 'comment'; isEnd = s => s.includes('-->'); }
  else return false;
  let last = startLine;
  const singleLine = kind === 'comment' && first.indexOf('-->', 4) >= 0;
  if (!singleLine) {
    let found = false;
    for (let l = startLine + 1; l < endLine; l++) {
      if (isEnd(lineAt(state, l))) { last = l; found = true; break; }
    }
    if (!found) return false;
  }
  if (silent) return true;
  const token = state.push('md_raw_block', '', 0);
  token.content = state.getLines(startLine, last + 1, state.sCount[startLine], false).replace(/\n$/, '');
  token.meta = { kind };
  token.map = [startLine, last + 1];
  state.line = last + 1;
  return true;
}

function setupMarkdownIt(md: MarkdownIt) {
  if (patched.has(md)) return;
  patched.add(md);
  md.inline.ruler.before('escape', 'md_raw', rawInlineRule);
  md.block.ruler.before('paragraph', 'md_raw_block', rawBlockRule);
  const meta = (t: MdToken) => (t.meta as { kind: MdRawKind }).kind;
  md.renderer.rules.md_raw = (tokens, idx) =>
    `<span data-md-raw="${meta(tokens[idx])}" data-raw="${escAttr(tokens[idx].content)}"></span>`;
  md.renderer.rules.md_raw_block = (tokens, idx) =>
    `<div data-md-raw-block="${meta(tokens[idx])}" data-raw="${escAttr(tokens[idx].content)}"></div>`;
  // Перенос внутри абзаца — свой узел, а не пробел: иначе строки склеиваются.
  md.renderer.rules.softbreak = () => '<br data-md-soft="">';
}

/** Что видно в WYSIWYG вместо атома: исходник (экранированный доллар — сам «$»). */
export function mdRawLabel(kind: string, raw: string): string {
  return kind === 'escape' ? '$' : raw;
}

/** Строчный атом-исходник: [[ссылка]], формула, `\$`. Правится в режиме md. */
export const MdRawInline = Node.create({
  name: 'mdRaw',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { raw: { default: '' }, kind: { default: 'math' } };
  },
  parseHTML() {
    return [{
      tag: 'span[data-md-raw]',
      getAttrs: el => ({ kind: (el as HTMLElement).getAttribute('data-md-raw'), raw: (el as HTMLElement).getAttribute('data-raw') ?? '' }),
    }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const kind = String(node.attrs.kind);
    const raw = String(node.attrs.raw);
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-md-raw': kind, 'data-raw': raw, class: `sk-md__raw sk-md__raw--${kind}`,
    }), mdRawLabel(kind, raw)];
  },
  renderText({ node }) {
    return mdRawLabel(String(node.attrs.kind), String(node.attrs.raw));
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          state.text(String(node.attrs.raw), false);
        },
        parse: { setup: setupMarkdownIt },
      },
    };
  },
});

/** Блочный атом-исходник: директива «:::», HTML-комментарий. */
export const MdRawBlock = Node.create({
  name: 'mdRawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { raw: { default: '' }, kind: { default: 'directive' } };
  },
  parseHTML() {
    return [{
      tag: 'div[data-md-raw-block]',
      getAttrs: el => ({ kind: (el as HTMLElement).getAttribute('data-md-raw-block'), raw: (el as HTMLElement).getAttribute('data-raw') ?? '' }),
    }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const kind = String(node.attrs.kind);
    return ['pre', mergeAttributes(HTMLAttributes, {
      'data-md-raw-block': kind, 'data-raw': String(node.attrs.raw), class: `sk-md__raw-block sk-md__raw-block--${kind}`,
    }), String(node.attrs.raw)];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          state.text(String(node.attrs.raw), false);
          state.closeBlock(node);
        },
        parse: { setup: setupMarkdownIt },
      },
    };
  },
});

/** Мягкий перенос строки внутри абзаца — пишется обратно «\n», а не пробелом. */
export const MdSoftBreak = Node.create({
  name: 'mdSoftBreak',
  group: 'inline',
  inline: true,
  selectable: false,
  parseHTML() {
    // Выше hardBreak (50): иначе <br> с меткой съест жёсткий перенос.
    return [{ tag: 'br[data-md-soft]', priority: 60 }];
  },
  renderHTML() {
    return ['br', { 'data-md-soft': '' }];
  },
  renderText() {
    return '\n';
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState) {
          state.write('\n');
        },
        parse: { setup: setupMarkdownIt },
      },
    };
  },
});

// Таблица GFM: «|» внутри ячейки обязан выйти экранированным — сериализатор
// tiptap-markdown пишет его голым, и строка получает лишний столбец.
const MdTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: SerializerState, node: PMNode) {
          state.inTable = true;
          node.forEach((row, _p, i) => {
            state.write('| ');
            row.forEach((cell, _p2, j) => {
              if (j) state.write(' | ');
              const para = cell.firstChild;
              // childCount, а не textContent: ячейка из одного атома ([[ссылка]])
              // текста не имеет, но пустой не является.
              if (para && para.childCount > 0) {
                const from = state.out.length;
                state.renderInline(para);
                state.out = state.out.slice(0, from) + state.out.slice(from).replace(/\|/g, '\\|');
              }
            });
            state.write(' |');
            state.ensureNewLine();
            if (!i) {
              state.write(`| ${Array.from({ length: row.childCount }, () => '---').join(' | ')} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {},
      },
    };
  },
});

// tightLists tiptap-markdown знает только bullet/ordered — чек-лист без этого
// атрибута выходит «рыхлым» (пустая строка между пунктами).
const MdTaskListTight = Extension.create({
  name: 'mdTaskListTight',
  addGlobalAttributes() {
    return [{
      types: ['taskList'],
      attributes: {
        tight: {
          default: true,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-tight') === 'true' || !el.querySelector('p'),
          renderHTML: (attrs: Record<string, unknown>) => (attrs.tight ? { 'data-tight': 'true' } : {}),
        },
      },
    }];
  },
});

/** Слой без-потерь поверх StarterKit/таблиц/чек-листов (порядок не важен). */
export function losslessMarkdownLayer(): AnyExtension[] {
  return [MdRawInline, MdRawBlock, MdSoftBreak, MdTaskListTight];
}

/**
 * Базовый набор MD-редактора kit: StarterKit (ссылки lore: разрешены),
 * таблицы, чек-листы и слой без-потерь. Без Markdown — его добавляет
 * вызывающий последним (TipTapField вставляет перед ним картинки и упоминания).
 */
export function markdownBaseExtensions(opts: Partial<MathNodeOptions> = {}): AnyExtension[] {
  const promptTex = opts.promptTex ?? null;
  return [
    // Явный протокол lore: — иначе Link отбрасывает адрес ссылки на актора,
    // спринт, задачу (и упоминание, записанное как [@имя](lore:actor/id)).
    // Text — свой (MathSafeText, S5-13): доллары, которые при повторном
    // разборе стали бы формулой, пишутся экранированными.
    StarterKit.configure({ text: false, link: { protocols: ['lore'], openOnClick: false } }),
    MathSafeText,
    // Формулы $…$ / $…$ — KaTeX прямо в редакторе (S5-13); двойной клик — правка.
    MathInline.configure({ promptTex }),
    MathBlock.configure({ promptTex }),
    TableKit.configure({ table: false }),
    MdTable.configure({ resizable: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ...losslessMarkdownLayer(),
  ];
}

/** Сериализатор MD — один для поля и для теста круга. */
export function markdownSerializerExtension(): AnyExtension {
  return Markdown.configure({ html: false, tightLists: true });
}
