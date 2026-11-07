// Markdown-ядро TipTap в kit (SPRINT_UXR_S5_RECORD_TASKS/S5-06, S5-07): один
// набор расширений на поле правки (TipTapField) и на проверку круга
// «Markdown → TipTap → Markdown». Пока набор один, круг, проверенный здесь,
// и есть то, что сделает поле при сохранении, — расхождения «тест зелёный,
// а поле теряет» не бывает по построению.
import { Editor, Extension } from '@tiptap/core';
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from 'tiptap-markdown';
import { marked } from './markdown';

/**
 * Картинка — строчный узел, как в markdown (`![a](u)` живёт внутри абзаца).
 * Блочная по умолчанию в TipTap выносила её из абзаца в отдельный блок —
 * другой рендер после сохранения (поймано кругом S5-07).
 */
export const MdImage = Image.configure({ inline: true });

/**
 * Базовые расширения markdown-поля. `image` — узел картинки: поле с
 * загрузчиком подставляет свой (с ручкой размера), без загрузчика — простой,
 * чтобы уже вставленная картинка не выпадала из текста при сохранении.
 */
export function mdExtensions(image: AnyExtension = MdImage): AnyExtension[] {
  return [
    // lore: — схема ссылок LORE (упоминания `lore:actor/…`, записи): без неё
    // Link отбрасывал href как недопустимый, и при сохранении ссылка
    // превращалась в голый текст (поймано кругом S5-07).
    StarterKit.configure({ link: { protocols: ['lore'], openOnClick: false } }),
    image,
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TaskListTight,
    Markdown.configure({ html: false, tightLists: true }),
  ];
}

/**
 * «Плотность» чек-листа. tiptap-markdown даёт атрибут tight только
 * bullet/ordered-спискам, а чек-лист сериализует тем же renderList — без
 * атрибута он считался «рыхлым», и `- [x] a\n- [ ] b` после круга получал
 * пустые строки между пунктами (другой рендер: пункты в <p>). Правило то же,
 * что у списков в tiptap-markdown: плотный, если в пунктах нет абзацев <p>.
 */
const TaskListTight = Extension.create({
  name: 'skTaskListTight',
  addGlobalAttributes() {
    return [{
      types: ['taskList'],
      attributes: {
        tight: {
          default: true,
          parseHTML: (element: HTMLElement) => element.getAttribute('data-tight') === 'true' || !element.querySelector('p'),
          renderHTML: (attributes: Record<string, unknown>) => (attributes.tight ? { 'data-tight': 'true' } : {}),
        },
      },
    }];
  },
});

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
