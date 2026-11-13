// @vitest-environment jsdom
// Необработанная ошибка «target.getClientRects is not a function» (prosemirror-view
// coordsAtPos ← scrollToSelection ← tiptap scrollIntoView) уронила web/kit CI #1315
// при 3255/3255 зелёных тестах: jsdom не реализует getClientRects/getBoundingClientRect
// у Range и Text, а focus() редактора прокручивает к каретке. Заглушка жила копиями
// в двух файлах (tiptapMath, tiptapRefs); файл без копии (tiptapNarrow) падал, если
// отложенная прокрутка успевала случиться — под нагрузкой CI, не локально.
// Правило: заглушка раскладки одна, в общем setup.ts, для всех jsdom-тестов kit.
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

describe('раскладка в jsdom — общая заглушка (setup.ts)', () => {
  it('Range и Text отвечают на getClientRects/getBoundingClientRect без исключения', () => {
    const r = document.createRange();
    expect(typeof r.getClientRects).toBe('function');
    expect(r.getClientRects().length).toBe(0);
    expect(typeof r.getBoundingClientRect).toBe('function');
    const t = document.createTextNode('x') as unknown as { getClientRects?: unknown };
    expect(typeof t.getClientRects).toBe('function');
  });

  it('прокрутка редактора к каретке (scrollIntoView) не бросает', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({ element: el, extensions: [StarterKit], content: '<p>abc</p>' });
    try {
      expect(() => editor.chain().focus('end').scrollIntoView().run()).not.toThrow();
    } finally {
      editor.destroy();
      el.remove();
    }
  });
});
