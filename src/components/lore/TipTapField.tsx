// TipTapField — reusable WYSIWYG Markdown field (bold/italic/lists/headings via
// toolbar, not raw markdown syntax). Backed by TipTap (ProseMirror) + the
// tiptap-markdown extension, which serializes editor content straight to/from
// a Markdown string — matches this app's *_md field convention (main_text_md,
// text_md, context_md, note_md...) without a lossy HTML round-trip.
//
// Researched the whole AIDA monorepo first (2026-07-02) — no existing WYSIWYG
// editor anywhere (UnlimitedLORE, aida-root, verdandi, seidr-site all lack
// one); this is the first, chosen for React 19 support + markdown-native
// serialization. Fresh install: @tiptap/react, @tiptap/starter-kit,
// @tiptap/pm, tiptap-markdown.
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';

// tiptap-markdown@0.9 (built for TipTap v2) doesn't ship v3-compatible Storage
// type augmentation, so `editor.storage.markdown` isn't statically known —
// narrow via a runtime-safe cast at the one call site instead of `any`-ing
// every usage.
function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as { markdown?: { getMarkdown: () => string } };
  return storage.markdown?.getMarkdown() ?? editor.getText();
}

export interface TipTapFieldProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export default function TipTapField({ value, onChange, placeholder, minHeight = 100 }: TipTapFieldProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false, tightLists: true })],
    content: value,
    editorProps: {
      attributes: { style: `min-height:${minHeight}px; outline: none;` },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(getMarkdown(editor));
    },
  });

  // Sync external resets (e.g. form clear) without fighting the editor mid-typing.
  useEffect(() => {
    if (!editor) return;
    const current = getMarkdown(editor);
    if (value !== current && value === '') editor.commands.setContent('');
  }, [value, editor]);

  return (
    <div style={S.wrap}>
      <div style={S.toolbar}>
        {editor && (
          <>
            <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>B</ToolBtn>
            <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>i</i></ToolBtn>
            <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</ToolBtn>
            <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolBtn>
            <ToolBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolBtn>
            <ToolBtn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>{'</>'}</ToolBtn>
          </>
        )}
      </div>
      <div style={S.editorBox}>
        <EditorContent editor={editor} />
        {editor?.isEmpty && placeholder && <div style={S.placeholder}>{placeholder}</div>}
      </div>
    </div>
  );
}

function ToolBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" style={toolBtnStyle(active)} onClick={onClick}>{children}</button>;
}
function toolBtnStyle(active: boolean): React.CSSProperties {
  return {
    height: 22, minWidth: 22, padding: '0 5px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
    background: active ? 'color-mix(in srgb, var(--acc) 18%, transparent)' : 'transparent',
    color: active ? 'var(--acc)' : 'var(--t2)',
    border: active ? '1px solid color-mix(in srgb, var(--acc) 35%, transparent)' : '1px solid transparent',
  };
}

const S: Record<string, React.CSSProperties> = {
  wrap:       { border: '1px solid var(--b3)', borderRadius: 4, overflow: 'hidden' },
  toolbar:    { display: 'flex', gap: 3, padding: '4px 6px', background: 'var(--b2)', borderBottom: '1px solid var(--b3)' },
  editorBox:  { position: 'relative', background: 'var(--b1)', padding: '7px 9px', fontSize: 12, color: 'var(--t1)', lineHeight: 1.55 },
  placeholder:{ position: 'absolute', top: 7, left: 9, color: 'var(--t3)', pointerEvents: 'none', fontSize: 12 },
};
