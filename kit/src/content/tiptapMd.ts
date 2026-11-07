// Markdown-ядро TipTap в kit (SPRINT_UXR_S5_RECORD_TASKS/S5-06, S5-07): один
// набор расширений на поле правки (TipTapField) и на проверку круга
// «Markdown → TipTap → Markdown». Пока набор один, круг, проверенный здесь,
// и есть то, что сделает поле при сохранении, — расхождения «тест зелёный,
// а поле теряет» не бывает по построению.
import { Editor } from '@tiptap/core';
import type { AnyExtension } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { markdownBaseExtensions, markdownSerializerExtension } from './markdownLossless';
import { marked } from './markdown';

/**
 * Картинка — строчный узел, как в markdown (`![a](u)` живёт внутри абзаца).
 * Блочная по умолчанию в TipTap выносила её из абзаца в отдельный блок —
 * другой рендер после сохранения (поймано кругом S5-07).
 */
export const MdImage = Image.configure({ inline: true });

/**
 * Расширения markdown-поля = слой без-потерь S5-07 (markdownLossless:
 * StarterKit с lore:, таблицы с `|`, плотный чек-лист, атомы-исходники)
 * + узел картинки + доп. расширения поля (упоминания) + сериализатор.
 * `image` — поле с загрузчиком подставляет свой (с ручкой размера), без
 * загрузчика — простой, чтобы уже вставленная картинка не выпадала из текста.
 */
export function mdExtensions(image: AnyExtension = MdImage, extra: AnyExtension[] = []): AnyExtension[] {
  return [...markdownBaseExtensions(), image, ...extra, markdownSerializerExtension()];
}

// tiptap-markdown@0.9 не объявляет тип storage для TipTap v3 — узкий каст в одном месте.
export function getMarkdown(editor: Pick<Editor, 'storage' | 'getText'>): string {
  const storage = editor.storage as unknown as { markdown?: { getMarkdown: () => string } };
  return storage.markdown?.getMarkdown() ?? editor.getText();
}

/** Markdown после круга через TipTap — ровно то, что сохранит визуальный режим. */
export function roundTripMd(md: string): string {
  const editor = new Editor({ extensions: mdExtensions(), content: md });
  try {
    return getMarkdown(editor);
  } finally {
    editor.destroy();
  }
}

const norm = (s: string) => s.replace(/\r\n/g, '\n').trim();
const html = (md: string) => (marked.parse(md) as string).replace(/\s+/g, ' ').replace(/> </g, '><').trim();

/**
 * Один и тот же ли смысл у двух markdown: тот же текст или тот же рендер
 * чтения kit (marked из content/markdown.ts — им рисует MartProse). Мягкий
 * перенос строки внутри абзаца TipTap склеивает пробелом — текст другой,
 * а показанное читателю то же; это не потеря.
 */
export function sameMd(a: string, b: string): boolean {
  if (norm(a) === norm(b)) return true;
  return html(a) === html(b);
}

/**
 * Переживёт ли текст визуальный режим без потерь. Нет — визуальный режим для
 * этого текста закрыт (MdInlineEdit), правка только в коде: молча испортить
 * тело записи хуже, чем честно сказать «здесь только код».
 */
export function isLosslessMd(md: string): boolean {
  if (!md.trim()) return true;
  try {
    return sameMd(roundTripMd(md), md);
  } catch {
    return false;
  }
}
