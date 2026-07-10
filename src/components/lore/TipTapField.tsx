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
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { sanitizeMd } from './sanitizeHtml';
import { Markdown } from 'tiptap-markdown';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { useEffect, useRef, useState } from 'react';
import type { Editor, NodeViewProps } from '@tiptap/react';
import { uploadBragiAsset } from '../../api/lore';

// Table/TaskList/Link/Strike all have built-in markdown serializers inside
// tiptap-markdown itself (it matches extensions by node name against its own
// bundled spec — confirmed by reading node_modules/tiptap-markdown/dist),
// so installing the *official* @tiptap packages here is enough to get GFM
// tables and `- [ ]` task lists round-tripping through plain markdown for
// free — no custom serializer needed. Underline is deliberately NOT added:
// CommonMark/GFM has no underline syntax, tiptap-markdown has no serializer
// for it either, so it would silently vanish on save instead of just not
// being offered.
const TABLE_EXTENSIONS = [TableKit.configure({ table: { resizable: false } })];
const TASKLIST_EXTENSIONS = [TaskList, TaskItem.configure({ nested: true })];

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
  const { t } = useTranslation();
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
          title={t('lore.tiptap.resize', 'изменить размер')}
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
  style.textContent = `
    .bragi-tiptap .ProseMirror img { max-width: 100%; height: auto; display: block; margin: 8px 0; border-radius: 6px; }
    .bragi-tiptap .ProseMirror table { border-collapse: collapse; margin: 8px 0; width: 100%; table-layout: fixed; }
    .bragi-tiptap .ProseMirror th, .bragi-tiptap .ProseMirror td { border: 1px solid var(--b3); padding: 4px 7px; vertical-align: top; text-align: left; }
    .bragi-tiptap .ProseMirror th { background: var(--b2); font-weight: 600; }
    .bragi-tiptap .ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 4px; }
    .bragi-tiptap .ProseMirror ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 6px; }
    .bragi-tiptap .ProseMirror ul[data-type="taskList"] li > label { flex: none; margin-top: 3px; }
    .bragi-tiptap .ProseMirror ul[data-type="taskList"] li > div { flex: 1; }
    .bragi-tiptap .ProseMirror blockquote { border-left: 3px solid var(--acc); margin: 8px 0; padding: 2px 12px; color: var(--t2); }
    .bragi-tiptap .ProseMirror hr { border: none; border-top: 1px solid var(--b3); margin: 12px 0; }
    .bragi-tiptap .ProseMirror a { color: var(--acc); }
    .bragi-tiptap .ProseMirror pre { background: var(--b2); border: 1px solid var(--b3); border-radius: 6px; padding: 8px 10px; margin: 8px 0; overflow-x: auto; }
    .bragi-tiptap .ProseMirror pre code { background: none; border: none; padding: 0; }
    .bragi-tiptap .ProseMirror code { background: var(--b2); border: 1px solid var(--b3); border-radius: 3px; padding: 0 4px; }
  `;
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
  /** T13: accessible name for the editable region — needed wherever this
   * field has no visually-linked <label> (a <Sec> heading nearby doesn't
   * count for a11y purposes). */
  ariaLabel?: string;
}

export default function TipTapField({
  value, onChange, placeholder, minHeight = 100, editable = true,
  enableImages = true, enableHtmlMode = true, ariaLabel,
}: TipTapFieldProps) {
  const { t } = useTranslation();
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
      ...TABLE_EXTENSIONS,
      ...TASKLIST_EXTENSIONS,
      Markdown.configure({ html: false, tightLists: true }),
    ],
    content: value,
    editable,
    editorProps: {
      attributes: {
        style: `min-height:${minHeight}px; outline: none;`,
        ...(ariaLabel ? { 'aria-label': ariaLabel, role: 'textbox' } : {}),
      },
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

  const toggleLink = () => {
    if (!editor) return;
    if (editor.isActive('link')) { editor.chain().focus().unsetLink().run(); return; }
    const url = window.prompt('URL ссылки:', 'https://');
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

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
      dom.innerHTML = sanitizeMd(draft);
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
              <ToolBtn active={false} onClick={() => editor.chain().focus().undo().run()} title={t('lore.tiptap.undo', 'отменить (Ctrl+Z)')}>↺</ToolBtn>
              <ToolBtn active={false} onClick={() => editor.chain().focus().redo().run()} title={t('lore.tiptap.redo', 'повторить (Ctrl+Y)')}>↻</ToolBtn>
              <Sep />
              <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title={t('lore.tiptap.bold', 'жирный (Ctrl+B)')}>B</ToolBtn>
              <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title={t('lore.tiptap.italic', 'курсив (Ctrl+I)')}><i>i</i></ToolBtn>
              <ToolBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title={t('lore.tiptap.strike', 'зачёркнутый')}><s>S</s></ToolBtn>
              <ToolBtn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title={t('lore.tiptap.code', 'код')}>{'</>'}</ToolBtn>
              <ToolBtn active={editor.isActive('link')} onClick={toggleLink} title={t('lore.tiptap.link', 'ссылка')}>🔗</ToolBtn>
              <Sep />
              <ToolBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title={t('lore.tiptap.h1', 'заголовок 1 уровня')}>H1</ToolBtn>
              <ToolBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title={t('lore.tiptap.h2', 'заголовок 2 уровня')}>H2</ToolBtn>
              <ToolBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title={t('lore.tiptap.h3', 'заголовок 3 уровня')}>H3</ToolBtn>
              <Sep />
              <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t('lore.tiptap.bulletList', 'маркированный список')}>•</ToolBtn>
              <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t('lore.tiptap.orderedList', 'нумерованный список')}>1.</ToolBtn>
              <ToolBtn active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} title={t('lore.tiptap.taskList', 'чек-лист')}>☑</ToolBtn>
              <ToolBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={t('lore.tiptap.blockquote', 'цитата')}>❝</ToolBtn>
              <ToolBtn active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()} title={t('lore.tiptap.hr', 'разделитель')}>—</ToolBtn>
              <Sep />
              {editor.isActive('table')
                ? <>
                    <ToolBtn active={false} onClick={() => editor.chain().focus().addColumnAfter().run()} title={t('lore.tiptap.addColumn', '+ столбец')}>+▏</ToolBtn>
                    <ToolBtn active={false} onClick={() => editor.chain().focus().addRowAfter().run()} title={t('lore.tiptap.addRow', '+ строка')}>+▁</ToolBtn>
                    <ToolBtn active={false} onClick={() => editor.chain().focus().deleteTable().run()} title={t('lore.tiptap.deleteTable', 'удалить таблицу')}>⊞×</ToolBtn>
                  </>
                : <ToolBtn active={false} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title={t('lore.tiptap.insertTable', 'вставить таблицу')}>⊞</ToolBtn>}
              {enableImages && <ToolBtn active={uploading} onClick={pickImage} title={t('lore.tiptap.insertImage', 'вставить изображение')}>{uploading ? '…' : '🖼'}</ToolBtn>}
              <Sep />
              <ToolBtn active={mode === 'md'} onClick={() => toggleMode('md')} title={t('lore.tiptap.modeMd', 'режим markdown-источника')}>{'</> md'}</ToolBtn>
              {enableHtmlMode && <ToolBtn active={mode === 'html'} onClick={() => toggleMode('html')} title={t('lore.tiptap.modeHtml', 'режим HTML-источника')}>{'</> html'}</ToolBtn>}
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

function ToolBtn({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  // T13: title alone isn't an accessible name once the button has visible
  // text/emoji content (e.g. "B", "🔗") — the browser prefers that content
  // over title for the a11y-tree name, so screen readers announced the raw
  // glyph instead of what the button does. Mirror title into aria-label.
  return <button type="button" style={toolBtnStyle(active)} onClick={onClick} title={title} aria-label={title}>{children}</button>;
}
function Sep() {
  return <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--b3)', margin: '2px 1px' }} />;
}
function toolBtnStyle(active: boolean): React.CSSProperties {
  return {
    height: 22, minWidth: 22, padding: '0 5px', borderRadius: 3, fontSize: 'var(--fs-sm)', cursor: 'pointer',
    background: active ? 'color-mix(in srgb, var(--acc) 18%, transparent)' : 'transparent',
    color: active ? 'var(--acc)' : 'var(--t2)',
    border: active ? '1px solid color-mix(in srgb, var(--acc) 35%, transparent)' : '1px solid transparent',
  };
}

const S: Record<string, React.CSSProperties> = {
  wrap:       { border: '1px solid var(--b3)', borderRadius: 4, overflow: 'hidden' },
  toolbar:    { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, padding: '4px 6px', background: 'var(--b2)', borderBottom: '1px solid var(--b3)' },
  editorBox:  { position: 'relative', background: 'var(--b1)', padding: '7px 9px', fontSize: 'var(--fs-base)', color: 'var(--t1)', lineHeight: 1.55 },
  sourceBox:  { width: '100%', minHeight: 100, background: 'var(--b1)', color: 'var(--t1)', fontFamily: 'var(--mono)',
                fontSize: 'var(--fs-base)', lineHeight: 1.55, padding: '7px 9px', border: 'none', outline: 'none', resize: 'vertical',
                boxSizing: 'border-box' },
  placeholder:{ position: 'absolute', top: 7, left: 9, color: 'var(--t3)', pointerEvents: 'none', fontSize: 'var(--fs-base)' },
};
