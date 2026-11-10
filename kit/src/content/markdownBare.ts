// Чтение Markdown без сборки (SPRINT_UXR_S10_SEIDR_KIT/K-13).
//
// Страница на голом HTML (kit/demo/seidr-bare.html) должна показывать тело
// записи, не поднимая React и сборщик: marked разбирает, DOMPurify чистит,
// mermaid рисует схемы потом — по узнаваемой обёртке.
//
// Требование владелицы: фолбэк «исходник + ошибка». Если что-то пошло не
// так, человек видит ИСХОДНЫЙ текст и причину, а не пустое место: пустое
// место неотличимо от «в записи ничего не написано», и запись выглядит
// потерянной, хотя она цела.
//
// Правка тела здесь не делается — по решению владелицы это отдельный вопрос.
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { splitDiagramFences } from './diagramFence';

export interface MarkdownBareResult {
  /** Разбор и очистка прошли. */
  ok: boolean;
  /** Готовая разметка либо фолбэк с исходником. */
  html: string;
  /** Сколько блоков схем нашлось — их дорисовывает mermaid. */
  diagrams: number;
  /** Причина, если не ok. */
  error?: string;
}

export interface MarkdownBareOptions {
  /** Подмена разбора (тесты, другая реализация). */
  parse?: (md: string) => string;
  /** Подмена очистки. Очистка обязательна: без неё html не показывается. */
  sanitize?: (html: string) => string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Исходник и причина — вместо пустоты. Исходник экранирован: он текст. */
function fallback(src: string, error: string): MarkdownBareResult {
  return {
    ok: false,
    diagrams: 0,
    error,
    html: `<div class="sk-prose__fallback"><p class="sk-prose__fallback-why">${escapeHtml(error)}</p><pre class="sk-prose__fallback-src">${escapeHtml(src)}</pre></div>`,
  };
}

/**
 * Markdown → безопасная разметка.
 *
 * Схемы вынимаются до разбора и кладутся в обёртку с сохранённым исходником:
 * mermaid дорисует их на странице, а если не сможет — человек увидит текст
 * схемы, а не пустой прямоугольник.
 */
export function renderMarkdownBare(src: string, opts: MarkdownBareOptions = {}): MarkdownBareResult {
  if (!src.trim()) return { ok: true, html: '', diagrams: 0 };

  let diagrams = 0;
  // Что считается схемой — решает splitDiagramFences, то же правило, что в
  // MartProse: упоминание ```mermaid внутри строки прозы схему не открывает.
  const withDiagrams = splitDiagramFences(src, ['mermaid'])
    .map(part => {
      if (part.kind === 'text') return part.text;
      diagrams += 1;
      // Исходник схемы остаётся в разметке: это и данные для mermaid, и то,
      // что увидит человек, если отрисовка не случится.
      return `\n<div class="sk-prose__diagram"><pre class="sk-prose__mermaid">${escapeHtml(part.def)}</pre></div>\n`;
    })
    .join('');

  let raw: string;
  try {
    raw = opts.parse ? opts.parse(withDiagrams) : (marked.parse(withDiagrams, { async: false }) as string);
  } catch (e) {
    return fallback(src, `разбор не удался: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const clean = opts.sanitize ? opts.sanitize(raw) : DOMPurify.sanitize(raw);
    return { ok: true, html: clean, diagrams };
  } catch (e) {
    // Неочищенную разметку не показываем ни при каких обстоятельствах:
    // лучше исходник текстом, чем html, который мы не проверили.
    return fallback(src, `очистка не удалась: ${e instanceof Error ? e.message : String(e)}`);
  }
}
