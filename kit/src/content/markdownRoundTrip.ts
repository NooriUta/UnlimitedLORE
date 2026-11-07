// SPRINT_UXR_S5_RECORD_TASKS/S5-07 · круг Markdown → TipTap → Markdown.
// Тот же набор расширений, что у TipTapField (markdownBaseExtensions +
// markdownSerializerExtension), но без React: редактор без представления,
// разобрать MD, отдать MD, уничтожить. Нужен тесту без-потерь и S5-06/S5-08
// (правка на месте и слияние по блокам сравнивают источник после круга).
import { Editor } from '@tiptap/core';
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { mdExtensions } from './tiptapMd';

/** Набор MD-редактора kit — ровно как в TipTapField (tiptapMd.mdExtensions, S5-06). */
export function markdownExtensions(): AnyExtension[] {
  return mdExtensions();
}

/**
 * «Голый» TipTap — набор TipTapField до S5-07, без слоя без-потерь. Только
 * для теста: доказать, что сравнение ловит настоящие потери.
 */
export function plainMarkdownExtensions(): AnyExtension[] {
  return [
    StarterKit,
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown.configure({ html: false, tightLists: true }),
  ];
}

/** MD → документ TipTap → MD. Нужен DOM (браузер или jsdom). */
export function markdownRoundTrip(md: string, extensions: AnyExtension[] = markdownExtensions()): string {
  const editor = new Editor({ extensions, content: md });
  try {
    const storage = editor.storage as unknown as { markdown: { getMarkdown: () => string } };
    return storage.markdown.getMarkdown();
  } finally {
    editor.destroy();
  }
}

/**
 * Сравнимая форма MD: схлопнуты подряд идущие пустые строки, сняты хвостовые
 * пробелы и пустые строки в конце — всё ВНЕ фенсов (```/~~~). Внутри фенса
 * строки не трогаются: там пустая строка — данные (код, mermaid, lore-запрос).
 */
export function normalizeMarkdown(md: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null) {
      if (m) fence = m[1];
      const blank = line.trim() === '';
      if (blank && (out.length === 0 || out[out.length - 1] === '')) continue;
      out.push(blank ? '' : line.replace(/[ \t]+$/, ''));
    } else {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
      out.push(line);
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
