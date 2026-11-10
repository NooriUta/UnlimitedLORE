// Где принимается решение «этот блок — диаграмма» (один раз на весь kit).
//
// Корень дефекта владелицы 10.11.2026 («проблема с диаграммой mermaid осталась
// в 17.9»): раньше решение принимала регулярка
//   /```(mermaid|bpmn)[^\n]*\r?\n([\s\S]*?)```/g
// — без привязки к началу строки, с любым хвостом в информационной строке и с
// закрывающим фенсом «где угодно». Поэтому УПОМИНАНИЕ ```mermaid в прозе (а в
// записях LORE проза про само правило диаграмм встречается постоянно) открывало
// «диаграмму», а первые же три кавычки дальше по тексту её закрывали: в
// mermaid.render() уезжал обычный текст примечания, и библиотека отвечала
// «No diagram type detected matching given configuration for text: …».
//
// Правило вместо случая: блок объявлен диаграммой ТОЛЬКО по CommonMark —
//   * фенс открывается с начала строки (отступ ≤ 3 пробелов);
//   * фенс — 3+ обратные кавычки или 3+ тильды;
//   * в информационной строке фенса из кавычек самих кавычек быть не может
//     (это признак инлайн-кода внутри строки прозы, а не фенса);
//   * язык — отдельное слово целиком: `mermaidjs` и `mermaid-ish` не диаграммы;
//   * закрывает блок строка из одних кавычек/тильд той же породы и не короче;
//   * незакрытый фенс идёт до конца текста (как в CommonMark).
// Всё остальное — текст, и в рендерер диаграмм он не попадает никогда. Обычные
// блоки кода (```json, ````…) остаются в текстовом потоке как были, поэтому
// ```mermaid внутри внешнего фенса — это код, а не диаграмма.

/** Языки, которые kit рисует как диаграмму. */
export const DIAGRAM_LANGS = ['mermaid', 'bpmn'] as const;
export type DiagramLang = (typeof DIAGRAM_LANGS)[number];

export type FencedPart =
  | { kind: 'text'; text: string }
  | { kind: 'diagram'; lang: string; def: string };

/** Строка фенса: отступ, порода и длина маркера, информационная строка. */
const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** Строка без своего переводa строки — для сопоставления с образцом. */
const bare = (line: string) => line.replace(/\r?\n$/, '');

interface Opening { indent: number; marker: string; lang: string }

function opening(line: string): Opening | null {
  const m = FENCE.exec(line);
  if (!m) return null;
  const marker = m[2];
  const info = m[3].trimEnd();
  // CommonMark: в информационной строке фенса из обратных кавычек их быть не
  // может. Именно этим отличается «строка прозы с инлайн-кодом» от фенса.
  if (marker[0] === '`' && info.includes('`')) return null;
  const lang = (/^[^\s{]*/.exec(info)?.[0] ?? '').toLowerCase();
  return { indent: m[1].length, marker, lang };
}

function closes(line: string, marker: string): boolean {
  const m = FENCE_CLOSE.exec(line);
  return !!m && m[1][0] === marker[0] && m[1].length >= marker.length;
}

/** Снять отступ открывающего фенса (CommonMark снимает его же, не больше). */
function dedent(line: string, indent: number): string {
  let i = 0;
  while (i < indent && line[i] === ' ') i += 1;
  return line.slice(i);
}

/**
 * Разбор текста на текстовые куски и объявленные блоки диаграмм.
 *
 * Склейка всех `text`-кусков обратно даёт исходный текст без потерь — поэтому
 * тем же разбором пользуются и React-рендер (MartProse), и путь без сборки
 * (markdownBare): правило «что считается диаграммой» одно на оба пути.
 */
export function splitDiagramFences(
  text: string,
  langs: readonly string[] = DIAGRAM_LANGS,
): FencedPart[] {
  const parts: FencedPart[] = [];
  // Переводы строк остаются в строках: обратная склейка должна быть точной.
  const lines = text.length ? text.split(/(?<=\n)/) : [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) parts.push({ kind: 'text', text: buf.join('') });
    buf = [];
  };

  let i = 0;
  while (i < lines.length) {
    const open = opening(bare(lines[i]));
    if (!open) { buf.push(lines[i]); i += 1; continue; }

    const body: string[] = [];
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      if (closes(bare(lines[j]), open.marker)) { closed = true; break; }
      body.push(lines[j]);
      j += 1;
    }

    if (langs.includes(open.lang)) {
      flush();
      const def = body.map(l => dedent(bare(l), open.indent)).join('\n').trim();
      parts.push({ kind: 'diagram', lang: open.lang, def });
    } else {
      // Обычный блок кода — часть текста, рендереру диаграмм не отдаётся.
      buf.push(lines[i], ...body);
      if (closed) buf.push(lines[j]);
    }
    i = closed ? j + 1 : j;
  }
  flush();
  return parts;
}
