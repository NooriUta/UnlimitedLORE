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
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { useEffect, useRef, useState } from 'react';
import type { Editor, NodeViewProps } from '@tiptap/react';
import { uploadBragiAsset } from '../../api/lore';

// Resizable image: the stock Image node has no size handle at all — once
// inserted, a picture is stuck at whatever pixel size it came in at, full
// stop. Drag-resize needs somewhere to persist the chosen width that
// survives the markdown round-trip (tiptap-markdown serializes only
// src/alt/title for an image, nothing custom), so width rides in the
// existing `title` attribute as "w:NN" (NN = percent of the editor's own
// width) — valid CommonMark `![alt](src "w:50")`, degrades harmlessly to a
// literal tooltip anywhere else it's pasted, and round-trips for free
// through tiptap-markdown/marked without a custom serializer.
function parseWidthPercent(title: string | null | undefined): number {
  const m = /^w:(\d{1,3})$/.exec(title || '');
  if (!m) return 100;
  return Math.max(5, Math.min(100, parseInt(m[1], 10)));
}

function ResizableImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const wrapRef = useRef<HTMLElement | null>(null);
  const widthPct = parseWidthPercent(node.attrs.title as string | null);

  const onHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const container = wrap.closest('.ProseMirror') as HTMLElement | null;
    const containerWidthPx = container?.clientWidth || wrap.parentElement?.clientWidth || wrap.clientWidth;
    const startX = e.clientX;
    const startWidthPx = wrap.getBoundingClientRect().width;
    const onMove = (ev: MouseEvent) => {
      const newWidthPx = Math.max(40, startWidthPx + (ev.clientX - startX));
      const pct = Math.max(5, Math.min(100, Math.round((newWidthPx / containerWidthPx) * 100)));
      updateAttributes({ title: `w:${pct}` });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <NodeViewWrapper
      as="span" ref={wrapRef as React.RefObject<HTMLElement>}
      style={{ display: 'inline-block', position: 'relative', width: `${widthPct}%`, maxWidth: '100%', lineHeight: 0, verticalAlign: 'top' }}
      data-drag-handle
    >
      <img
        src={node.attrs.src as string} alt={(node.attrs.alt as string) || ''}
        style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6 }}
        draggable={false}
      />
      {editor.isEditable && selected && (
        <span
          onMouseDown={onHandleMouseDown}
          title="изменить размер"
          style={{
            position: 'absolute', right: -5, bottom: -5, width: 13, height: 13,
            background: 'var(--acc)', border: '2px solid var(--bg0)', borderRadius: '50%',
            cursor: 'nwse-resize',
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

const ResizableImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

// The Image node renders a bare <img> straight into the ProseMirror doc (it's
// a block-level node here, not wrapped in a <p> we control), so there's no
// React-styleable element to cap its size. Without this, an inserted image
// renders at its native pixel width — routinely wider than the editor column
// — and silently overflows past S.wrap's `overflow: hidden`, i.e. gets
// clipped on the right rather than scaled to fit. One-time global rule,
// same injectCssOnce pattern as BragiSkinPreview's SKIN_CSS.
let tiptapCssInjected = false;
function injectTiptapCssOnce(): void {
  if (tiptapCssInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.dataset.bragiTiptap = '1';
  style.textContent = '.bragi-tiptap .ProseMirror img { max-width: 100%; height: auto; display: block; margin: 8px 0; border-radius: 6px; }';
  document.head.appendChild(style);
  tiptapCssInjected = true;
}

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
  /** PUB-VIEW-01: view-only mode for published content — no toolbar, no typing, no upload. */
  editable?: boolean;
  /** Image insertion + resize — on by default (Bragi's marketing/publication
   * content), off for the plainer prose fields (ADR/sprint/milestone bodies)
   * that don't need it yet. */
  enableImages?: boolean;
  /** Raw-HTML source view (`</> html`) — on by default for Bragi, off
   * elsewhere: outside marketing content there's no reason to hand-author
   * HTML into a markdown field, and it's one less button to explain. */
  enableHtmlMode?: boolean;
}

export default function TipTapField({
  value, onChange, placeholder, minHeight = 100, editable = true,
  enableImages = true, enableHtmlMode = true,
}: TipTapFieldProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<'wysiwyg' | 'md' | 'html'>('wysiwyg');   // TT-01: raw-source view toggle
  const [draft, setDraft] = useState(value);

  const editor = useEditor({
    extensions: [
      StarterKit,
      ...(enableImages ? [ResizableImage] : []),
      Markdown.configure({ html: false, tightLists: true }),
    ],
    content: value,
    editable,
    editorProps: {
      attributes: { style: `min-height:${minHeight}px; outline: none;` },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(getMarkdown(editor));
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => { injectTiptapCssOnce(); }, []);

  // Sync external resets (e.g. form clear) without fighting the editor mid-typing.
  useEffect(() => {
    if (!editor) return;
    const current = getMarkdown(editor);
    if (value !== current && value === '') editor.commands.setContent('');
  }, [value, editor]);

  const pickImage = () => fileInputRef.current?.click();

  const onImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    setUploading(true);
    try {
      const { file_url } = await uploadBragiAsset(file);
      editor.chain().focus().setImage({ src: file_url, alt: file.name }).run();
    } catch {
      // upload failure — nothing inserted, toolbar just stops spinning
    } finally {
      setUploading(false);
    }
  };

  // Applies whatever is currently in `draft` back into the editor doc, leaving
  // raw mode. The two raw modes need genuinely different parsers, not just
  // different displays:
  //  - md:   editor.commands.setContent — tiptap-markdown overrides this to
  //          parse the string as Markdown.
  //  - html: tiptap-markdown ALSO overrides insertContent/insertContentAt
  //          (insertContent calls insertContentAt internally) to parse as
  //          Markdown too — there's no "give me real HTML parsing" command
  //          left once the extension is loaded. So HTML bypasses TipTap's
  //          content commands entirely and goes straight through
  //          ProseMirror's own DOMParser + a raw transaction, which is the
  //          only path that treats the string as actual HTML.
  const applyDraftBack = () => {
    if (!editor) return;
    if (mode === 'md') {
      editor.commands.setContent(draft);
    } else if (mode === 'html') {
      const dom = document.createElement('div');
      dom.innerHTML = draft;
      const doc = PMDOMParser.fromSchema(editor.schema).parse(dom);
      const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
      editor.view.dispatch(tr);
    }
    onChangeRef.current(getMarkdown(editor));
  };

  const toggleMode = (target: 'md' | 'html') => {
    if (!editor) return;
    if (mode === target) {
      applyDraftBack();
      setMode('wysiwyg');
      return;
    }
    if (mode !== 'wysiwyg') applyDraftBack();
    setDraft(target === 'md' ? getMarkdown(editor) : editor.getHTML());
    setMode(target);
  };

  return (
    <div style={S.wrap} className="bragi-tiptap">
      {editable && (
        <div style={S.toolbar}>
          {editor && (
            <>
              <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>B</ToolBtn>
              <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>i</i></ToolBtn>
              <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>•</ToolBtn>
              <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolBtn>
              <ToolBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolBtn>
              <ToolBtn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>{'</>'}</ToolBtn>
              {enableImages && <ToolBtn active={uploading} onClick={pickImage}>{uploading ? '…' : '🖼'}</ToolBtn>}
              <ToolBtn active={mode === 'md'} onClick={() => toggleMode('md')}>{'</> md'}</ToolBtn>
              {enableHtmlMode && <ToolBtn active={mode === 'html'} onClick={() => toggleMode('html')}>{'</> html'}</ToolBtn>}
            </>
          )}
          {enableImages && <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onImageSelected} />}
        </div>
      )}
      {mode !== 'wysiwyg' ? (
        <textarea
          style={{ ...S.sourceBox, minHeight }}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <div style={S.editorBox}>
          <EditorContent editor={editor} />
          {editor?.isEmpty && placeholder && <div style={S.placeholder}>{placeholder}</div>}
        </div>
      )}
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
  sourceBox:  { width: '100%', minHeight: 100, background: 'var(--b1)', color: 'var(--t1)', fontFamily: 'var(--mono)',
                fontSize: 12, lineHeight: 1.55, padding: '7px 9px', border: 'none', outline: 'none', resize: 'vertical',
                boxSizing: 'border-box' },
  placeholder:{ position: 'absolute', top: 7, left: 9, color: 'var(--t3)', pointerEvents: 'none', fontSize: 12 },
};
