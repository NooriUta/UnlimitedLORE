// TipTapField (S4-00d) — правка MD-полей в kit: WYSIWYG поверх TipTap
// (ProseMirror) + tiptap-markdown, значение — markdown-строка (*_md-поля LORE).
// Копия v1 src/components/lore/TipTapField.tsx (v1 заморожен,
// D-2026-UXR-V2-FOLDER-V1-FROZEN). Отличия — только то, чего требует kit:
//  - загрузка картинок — проп onUploadImage, а не uploadBragiAsset из API v1:
//    kit не знает бэкенда. Нет загрузчика — нет кнопки картинки, drop/paste
//    файлов не перехватываются (поле не «съедает» файл, который некуда деть);
//  - подписи — локали kit (kit.md.*), а не react-i18next v1;
//  - стиль — классы sk-md* в seidr.css (токены v2), а не инлайн и не CSS из JS.
// Одна кнопка правки (слова владелицы 10.11.2026: «не надо две кнопки
// редактирования — исходный текст есть по кнопке md в tiptap, и выбор
// „показывать вместе“ можно встроить туда же»): вид правки выбирается ВНУТРИ
// поля, в том же ряду кнопок — исходник markdown (`</> md`) и «вместе»
// (исходник и просмотр рядом, рендер чтения даёт вызывающий).
// Поведение — как в v1: таблицы, чек-листы, режимы источника md/html,
// упоминания по «@», изменение размера картинки, внешнее значение применяется,
// когда разошлось с содержимым и поле не в фокусе.
// S5-07: набор расширений — общий с тестом «MD → TipTap → MD без потерь»
// (markdownLossless.ts): [[ссылки]], формулы, «:::», комментарии, `\|` в
// ячейках, ссылки lore: и переносы строк переживают сохранение.
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import Image from '@tiptap/extension-image';
import Mention from '@tiptap/extension-mention';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { getMarkdown, mdExtensions, MdImage } from './tiptapMd';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import type { Editor, NodeViewProps } from '@tiptap/react';
import { sanitizeMd } from './sanitizeHtml';
import { detectRefTrigger, type RefTrigger } from './refTrigger';
import { RefPicker, type RefItem, type RefPickerHandle, type RefPickerProps, type RefSearch } from './RefPicker';
import { kitT, type KitKey } from '../i18n';
import { useKitLang } from '../i18n/lang';

/** Элемент списка упоминаний: id сущности (им создаётся ребро) и подпись. */
export interface MentionItem {
  id: string;
  label: string;
}

interface MentionState {
  items: MentionItem[];
  index: number;
  rect: { left: number; top: number } | null;
  command: ((item: { id: string; label: string }) => void) | null;
}

// Источник упоминаний — геттером: список приезжает асинхронно, а расширения
// фиксируются при создании редактора (v1 PL-41).
function buildMention(
  getItems: () => MentionItem[],
  setState: (s: MentionState | null) => void,
  getState: () => MentionState | null,
) {
  // Своя сериализация: tiptap-markdown пишет для незнакомого узла заглушку
  // `[mention]`, и выбранный актор терялся бы при сохранении.
  const MentionMd = Mention.extend({
    addStorage() {
      return {
        markdown: {
          serialize(state: { write: (s: string) => void }, node: { attrs: Record<string, unknown> }) {
            state.write(`[@${node.attrs.label ?? node.attrs.id}](lore:actor/${node.attrs.id})`);
          },
          parse: {},
        },
      };
    },
  });

  const at = (props: { clientRect?: (() => DOMRect | null) | null }) => {
    const r = props.clientRect?.();
    return r ? { left: r.left, top: r.bottom } : null;
  };

  return MentionMd.configure({
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    suggestion: {
      char: '@',
      items: ({ query }) => {
        const q = query.trim().toLowerCase();
        const all = getItems();
        return (q ? all.filter(i => i.label.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)) : all).slice(0, 8);
      },
      render: () => ({
        onStart: props => setState({ items: props.items as MentionItem[], index: 0, rect: at(props), command: props.command }),
        onUpdate: props => setState({ items: props.items as MentionItem[], index: 0, rect: at(props), command: props.command }),
        // Клавиатура обязательна: подсказка появляется посреди набора.
        onKeyDown: props => {
          const st = getState();
          if (props.event.key === 'Escape') { setState(null); return true; }
          if (!st || st.items.length === 0) return false;
          if (props.event.key === 'ArrowDown') { setState({ ...st, index: (st.index + 1) % st.items.length }); return true; }
          if (props.event.key === 'ArrowUp') { setState({ ...st, index: (st.index - 1 + st.items.length) % st.items.length }); return true; }
          if (props.event.key === 'Enter' || props.event.key === 'Tab') {
            const item = st.items[st.index];
            if (item) { st.command?.({ id: item.id, label: item.label }); return true; }
          }
          return false;
        },
        onExit: () => setState(null),
      }),
    },
  });
}

// Ширина картинки живёт в title как "w:NN" (% ширины поля) — валидный
// CommonMark, переживает markdown-круг без своего сериализатора (v1).
export function parseWidthPercent(title: string | null | undefined): number {
  const m = /^w:(\d{1,3})$/.exec(title || '');
  if (!m) return 100;
  return Math.max(5, Math.min(100, parseInt(m[1], 10)));
}

function ResizableImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const lang = useKitLang();
  const wrapRef = useRef<HTMLElement | null>(null);
  const widthPct = parseWidthPercent(node.attrs.title as string | null);

  const onHandleMouseDown = (e: ReactMouseEvent) => {
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
    <NodeViewWrapper as="span" ref={wrapRef as RefObject<HTMLElement>} className="sk-md__img" style={{ width: `${widthPct}%` }} data-drag-handle>
      <img src={node.attrs.src as string} alt={(node.attrs.alt as string) || ''} draggable={false} />
      {editor.isEditable && selected && (
        <span className="sk-md__img-handle" onMouseDown={onHandleMouseDown} title={kitT(lang, 'kit.md.resize')} />
      )}
    </NodeViewWrapper>
  );
}

// Строчная, как MdImage (tiptapMd.ts): `![a](u)` остаётся внутри абзаца.
const ResizableImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
}).configure({ inline: true });

/** Файлы-картинки из drop/paste: items (скриншот из буфера) и files, без дублей и не-картинок. */
export function imageFilesFrom(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const out: File[] = [];
  const seen = new Set<string>();
  const push = (f: File | null | undefined) => {
    if (!f || !f.type.startsWith('image/')) return;
    const key = `${f.name}:${f.size}:${f.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file') push(item.getAsFile());
  }
  for (const f of Array.from(data.files ?? [])) push(f);
  return out;
}

/**
 * Источник ссылок для мини-окна (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW, ADR-LORE-050): «[[», «#тип»,
 * «@» (кроме случая, когда «@» уже занят упоминаниями людей — mentionItems). Kit не знает
 * предметных имён: словарь типов, подписи, поиск и создание даёт приложение.
 */
export interface TipTapRefSource {
  /** слово после «#» / префикс «[[тип:» (нижний регистр) → тип записи */
  types: Record<string, string>;
  typeLabels: Record<string, string>;
  /** поиск; отказ (throw) — окно скажет «не смогли загрузить» с причиной */
  search: (query: string, type: string | null) => Promise<RefItem[]>;
  createSpec?: RefPickerProps['createSpec'];
  onCreate?: RefPickerProps['onCreate'];
  /** с какой длины запроса искать (по умолчанию 1); короче — «введите слова поиска», поиск не зовётся */
  minQuery?: number;
}

interface RefOpen { trigger: RefTrigger; from: number; to: number; rect: { left: number; top: number } }

/** Вид правки внутри поля: набор, исходник markdown, исходник HTML. */
export type TipTapMode = 'wysiwyg' | 'md' | 'html';

export interface TipTapFieldProps {
  value: string;
  /**
   * Новое значение (markdown). `meta.source` — текст набран в ИСХОДНИКЕ
   * (кнопка md), то есть пришёл дословно, а не через круг «TipTap → markdown».
   * Вызывающему это нужно, чтобы не канонизировать то, что человек написал
   * руками (MdInlineEdit гасит дрейф только для второго случая).
   */
  onChange: (markdown: string, meta?: { source?: boolean }) => void;
  placeholder?: string;
  minHeight?: number;
  /** Только просмотр: без панели, без набора, без загрузки. */
  editable?: boolean;
  /** Загрузчик картинки (вызывающий знает своё API). Не задан — картинок нет. */
  onUploadImage?: (file: File) => Promise<{ url: string }>;
  /** Режим HTML-источника (`</> html`) — по умолчанию выключен. */
  enableHtmlMode?: boolean;
  /** Доступное имя поля — обязательно там, где нет связанного <label>. */
  ariaLabel?: string;
  /** Источник упоминаний по «@». Не задан — «@» обычный символ. */
  mentionItems?: MentionItem[];
  /** Вид правки, управляемый (пара с onModeChange); не задан — свой. */
  mode?: TipTapMode;
  /** Вид правки при открытии поля. */
  defaultMode?: TipTapMode;
  onModeChange?: (mode: TipTapMode) => void;
  /**
   * Просмотр рядом с исходником («показывать вместе»): рендер чтения даёт
   * вызывающий — kit не навязывает полю ни MartProse, ни mermaid/bpmn за ним.
   * Не задан — кнопки «вместе» нет.
   */
  renderPreview?: (markdown: string) => ReactNode;
  /** «Вместе» включено, управляемо (внешнему это нужно, чтобы раздвинуть поле). */
  sideBySide?: boolean;
  onSideBySide?: (on: boolean) => void;
  /**
   * Визуальная правка разрешена. false — круг «MD → TipTap → MD» на этом
   * тексте не сходится (сырой HTML и т.п.): поле живёт только исходником,
   * кнопка md закрыта с причиной (lossyReason), кнопок форматирования нет.
   * Молча испортить текст хуже, чем честно сказать «здесь только код».
   */
  allowWysiwyg?: boolean;
  /** Причина, по которой визуальная правка закрыта — подсказкой у кнопки md. */
  lossyReason?: string;
  /** Ссылки на записи прямо в тексте (мини-окно). Не задан — «[[» и «#» обычные символы. */
  refs?: TipTapRefSource;
}

export function TipTapField({
  value, onChange, placeholder, minHeight = 100, editable = true,
  onUploadImage, enableHtmlMode = false, ariaLabel, mentionItems,
  mode: modeProp, defaultMode = 'wysiwyg', onModeChange,
  renderPreview, sideBySide, onSideBySide, allowWysiwyg = true, lossyReason, refs,
}: TipTapFieldProps) {
  const lang = useKitLang();
  const t = (k: KitKey) => kitT(lang, k);
  const enableImages = Boolean(onUploadImage);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  // drop/paste-обработчики фиксируются при создании редактора — актуальная
  // функция загрузки живёт в ref (v1 PL-24).
  const uploadAndInsertRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const [mentionState, setMentionState] = useState<MentionState | null>(null);
  const mentionStateRef = useRef<MentionState | null>(null);
  mentionStateRef.current = mentionState;
  const mentionItemsRef = useRef<MentionItem[]>([]);
  mentionItemsRef.current = mentionItems ?? [];
  // Мини-окно ссылки: расширения фиксируются при создании редактора, поэтому всё живое — в ref.
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const [refOpen, setRefOpen] = useState<RefOpen | null>(null);
  const refOpenRef = useRef<RefOpen | null>(null);
  refOpenRef.current = refOpen;
  const pickerRef = useRef<RefPickerHandle>(null);
  // Закрытое Esc/щелчком вне не открывается снова, пока вызов на том же месте.
  const refDismissed = useRef<number | null>(null);
  const [refSearch, setRefSearch] = useState<RefSearch>({ state: 'loading' });
  const [refRetry, setRefRetry] = useState(0);
  const scanRefs = (ed: Editor) => {
    const src = refsRef.current;
    const sel = ed.state.selection;
    const closeRef = () => { refDismissed.current = null; if (refOpenRef.current) setRefOpen(null); };
    if (!src || !sel.empty || !ed.isEditable) return closeRef();
    const $from = sel.$from;
    // Внутри кода окна нет никогда: и в блоке кода, и под строчной меткой кода.
    if ($from.parent.type.spec.code || ed.isActive('code')) return closeRef();
    const blockStart = $from.start();
    const before = ed.state.doc.textBetween(blockStart, sel.from, '\n', '￼');
    const tr = detectRefTrigger(before, { types: src.types });
    // «@» занят упоминаниями людей — его не перехватываем (развилка «@» ждёт решения владелицы).
    // Упоминание подключено, когда проп mentionItems задан (даже пустым списком).
    if (!tr || (tr.trigger === 'at' && mentionItems !== undefined)) return closeRef();
    const from = blockStart + tr.start;
    if (refDismissed.current === from) return;
    refDismissed.current = null;
    let rect = { left: 0, top: 0 };
    try { const c = ed.view.coordsAtPos(sel.from); rect = { left: c.left, top: c.bottom }; } catch { /* нет раскладки (jsdom) */ }
    setRefOpen({ trigger: tr, from, to: sel.from, rect });
  };
  const scanRefsRef = useRef(scanRefs);
  scanRefsRef.current = scanRefs;
  const [ownMode, setOwnMode] = useState<TipTapMode>(defaultMode);
  const [ownSide, setOwnSide] = useState(false);
  const wanted = modeProp ?? ownMode;
  // Визуальная правка закрыта — набор недоступен, остаётся исходник.
  const mode: TipTapMode = allowWysiwyg || wanted === 'html' ? wanted : 'md';
  const side = sideBySide ?? ownSide;
  const splitOn = side && mode === 'md' && Boolean(renderPreview);
  const [draft, setDraft] = useState(value);
  // Что мы сами отдали наружу: внешнее значение, которое мы НЕ отдавали,
  // — это правка со стороны (восстановленный черновик), её надо подхватить;
  // своё эхо подхватывать нельзя, иначе оно переписывало бы набор.
  const lastEmit = useRef<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  // Подпись берётся в момент вызова: расширения фиксируются при создании редактора.
  const langRef = useRef(lang);
  langRef.current = lang;
  const promptTex = (tex: string) => window.prompt(kitT(langRef.current, 'kit.md.mathPrompt'), tex);

  const editor = useEditor({
    extensions: [
      // Набор и сериализатор — общие с тестом S5-07 «MD → TipTap → MD без
      // потерь» (markdownLossless через tiptapMd.mdExtensions): поле не может
      // разойтись с тем, что проверено. Картинка — узлом всегда (S5-06);
      // формулы — KaTeX-узлы S5-13, двойной клик — правка через promptTex.
      ...mdExtensions(
        enableImages ? ResizableImage : MdImage,
        mentionItems ? [buildMention(() => mentionItemsRef.current, setMentionState, () => mentionStateRef.current)] : [],
        { promptTex },
      ),
    ],
    content: value,
    editable,
    editorProps: {
      attributes: {
        class: 'sk-md__doc',
        // Скроллится само поле, а не диалог: кнопки сохранения остаются на виду.
        style: `min-height:${minHeight}px; max-height:${Math.max(minHeight, 260)}px;`,
        ...(ariaLabel ? { 'aria-label': ariaLabel, role: 'textbox', 'aria-multiline': 'true' } : {}),
      },
      // true — только когда картинки действительно есть: иначе отняли бы
      // обычную вставку текста и перетаскивание внутри документа.
      handleDrop: (_view, event) => {
        if (!enableImages) return false;
        const files = imageFilesFrom((event as DragEvent).dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        void uploadAndInsertRef.current(files);
        return true;
      },
      // Окно ссылки открыто — стрелки, Enter, Tab и Esc идут ему (фокус остаётся в тексте).
      handleKeyDown: (_view, event) => {
        if (!refOpenRef.current || !pickerRef.current) return false;
        if (!pickerRef.current.handleKey(event.key)) return false;
        event.preventDefault();
        return true;
      },
      handlePaste: (_view, event) => {
        if (!enableImages) return false;
        const files = imageFilesFrom((event as ClipboardEvent).clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        void uploadAndInsertRef.current(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(getMarkdown(editor));
      scanRefsRef.current(editor);
    },
    onSelectionUpdate: ({ editor }) => { scanRefsRef.current(editor); },
  });

  // Поиск для окна ссылки: по запросу и типу; ответ устаревшего запроса не перетирает свежий.
  const refQuery = refOpen && !refOpen.trigger.unknownType ? `${refOpen.trigger.type ?? ''}\u0000${refOpen.trigger.query}` : null;
  useEffect(() => {
    const src = refsRef.current;
    const open = refOpenRef.current;
    if (refQuery === null || !src || !open) return;
    if (open.trigger.query.trim().length < (src.minQuery ?? 1)) { setRefSearch({ state: 'idle' }); return; }
    let live = true;
    setRefSearch({ state: 'loading' });
    src.search(open.trigger.query, open.trigger.type).then(
      found => { if (live) setRefSearch({ state: 'ok', items: found }); },
      (e: unknown) => { if (live) setRefSearch({ state: 'error', reason: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { live = false; };
  }, [refQuery, refRetry]);

  const pickRef = (item: RefItem) => {
    const open = refOpenRef.current;
    if (!editor || editor.isDestroyed || !open) return;
    // Атомом mdRaw/wikilink — как круг «MD → TipTap → MD»: текстом сериализатор экранировал бы «[[».
    editor.chain().focus().deleteRange({ from: open.from, to: open.to }).insertContent([
      { type: 'mdRaw', attrs: { raw: `[[${item.type}:${item.id}]]`, kind: 'wikilink' } },
      { type: 'text', text: ' ' },
    ]).run();
    refDismissed.current = null;
    setRefOpen(null);
  };
  const closeRefPicker = () => {
    refDismissed.current = refOpenRef.current?.from ?? null;
    setRefOpen(null);
  };

  // isDestroyed: при повторном подключении эффектов (Suspense, StrictMode)
  // React зовёт их со ссылкой на редактор, который useEditor уже уничтожил, —
  // у него нет схемы, и getText() падает «reading 'nodes'» (S4-00e).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  // Внешнее значение применяется, когда разошлось с содержимым; в фокусе не
  // вмешиваемся (дралось бы с кареткой). emitUpdate:false — не эхо родителю.
  // В исходнике текст ведёт textarea: синхронизировать редактор на каждую
  // букву незачем, и setContent посреди набора стоил бы дорого.
  useEffect(() => {
    if (!editor || editor.isDestroyed || mode !== 'wysiwyg') return;
    const current = getMarkdown(editor);
    if (value === current) return;
    if (value === '' || !editor.isFocused) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor, mode]);

  // Правка со стороны, пока открыт исходник (восстановленный черновик S5-09):
  // своё эхо (lastEmit) не трогаем, чужое — показываем.
  useEffect(() => {
    if (mode !== 'md' || value === lastEmit.current) return;
    setDraft(prev => (prev === value ? prev : value));
  }, [value, mode]);

  const toggleLink = () => {
    if (!editor) return;
    if (editor.isActive('link')) { editor.chain().focus().unsetLink().run(); return; }
    const url = window.prompt(t('kit.md.linkPrompt'), 'https://');
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  // Единственный путь загрузки — кнопка, перетаскивание и вставка из буфера.
  const uploadAndInsert = async (files: File[]) => {
    if (!editor || files.length === 0 || !onUploadImage) return;
    setUploading(true);
    setUploadFailed(false);
    try {
      // Последовательно: параллельная вставка перемешала бы порядок картинок.
      for (const file of files) {
        const { url } = await onUploadImage(file);
        editor.chain().focus().setImage({ src: url, alt: file.name }).run();
      }
    } catch {
      // Честно: сбой загрузки виден, а не «кнопка просто перестала крутиться».
      setUploadFailed(true);
    } finally {
      setUploading(false);
    }
  };
  uploadAndInsertRef.current = uploadAndInsert;

  const onImageSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await uploadAndInsert([file]);
  };

  // md — setContent (tiptap-markdown разбирает как markdown); html — мимо
  // команд TipTap, через DOMParser ProseMirror (единственный путь «как HTML»).
  const applyDraftBack = (from: TipTapMode) => {
    if (!editor || editor.isDestroyed) return;
    if (from === 'md') {
      editor.commands.setContent(draft);
    } else if (from === 'html') {
      const dom = document.createElement('div');
      dom.innerHTML = sanitizeMd(draft);
      const doc = PMDOMParser.fromSchema(editor.schema).parse(dom);
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content));
    } else {
      return;
    }
    const md = getMarkdown(editor);
    lastEmit.current = md;
    onChangeRef.current(md);
  };

  // Перенос текста между видами правки — в эффекте, а не в обработчике кнопки:
  // вид может приехать и снаружи (управляемый mode), и тогда клика нет.
  // В исходник берём ВНЕШНЕЕ значение, а не getMarkdown(editor): вызывающий
  // гасит дрейф канонизации, и исходник должен показывать текст автора.
  const prevMode = useRef<TipTapMode>(mode);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const was = prevMode.current;
    if (was === mode) return;
    prevMode.current = mode;
    if (was !== 'wysiwyg') applyDraftBack(was);
    if (mode !== 'wysiwyg') setDraft(mode === 'md' ? valueRef.current : editor.getHTML());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editor]);

  const goMode = (m: TipTapMode) => {
    if (modeProp === undefined) setOwnMode(m);
    onModeChange?.(m);
  };

  const toggleMode = (target: 'md' | 'html') => {
    if (!editor) return;
    if (mode !== target) { goMode(target); return; }
    // Назад в набор — только если он открыт; «вместе» без исходника не бывает.
    if (!allowWysiwyg) return;
    goMode('wysiwyg');
    if (sideBySide === undefined) setOwnSide(false);
  };

  const toggleTogether = () => {
    if (side) {
      if (sideBySide === undefined) setOwnSide(false);
      onSideBySide?.(false);
      return;
    }
    if (mode !== 'md') goMode('md');
    if (sideBySide === undefined) setOwnSide(true);
    onSideBySide?.(true);
  };

  const run = (fn: (e: Editor) => void) => () => { if (editor) fn(editor); };

  // Вставка строчной формулы: исходник TeX спрашиваем, как URL ссылки.
  const insertMath = () => {
    if (!editor) return;
    const tex = window.prompt(t('kit.md.mathPrompt'), '');
    if (tex && tex.trim()) editor.chain().focus().insertContent({ type: 'mathInline', attrs: { tex: tex.trim() } }).run();
  };

  // Исходник. Набранное в md уходит вызывающему СРАЗУ и дословно: иначе
  // «написал в исходнике и сохранил, не возвращаясь в набор» теряло бы текст.
  const source = (
    <textarea
      className="sk-md__source"
      style={{ minHeight }}
      value={draft}
      aria-label={[ariaLabel, mode === 'md' ? t('kit.md.sourceMd') : t('kit.md.sourceHtml')].filter(Boolean).join(' · ')}
      spellCheck
      onChange={e => {
        const next = e.target.value;
        setDraft(next);
        if (mode !== 'md') return;
        lastEmit.current = next;
        onChangeRef.current(next, { source: true });
      }}
      placeholder={placeholder}
    />
  );

  // Кнопки видов правки — конец ряда и единственное, что остаётся, когда
  // визуальная правка закрыта: форматирование гнало бы текст через TipTap,
  // которому этот текст нельзя доверить.
  const modeBtns = (
    <>
      <ToolBtn
        label={t('kit.md.modeMd')}
        active={mode === 'md'}
        off={!allowWysiwyg}
        hint={allowWysiwyg ? undefined : lossyReason}
        onClick={() => toggleMode('md')}
      >{'</> md'}</ToolBtn>
      {enableHtmlMode && <ToolBtn label={t('kit.md.modeHtml')} active={mode === 'html'} onClick={() => toggleMode('html')}>{'</> html'}</ToolBtn>}
      {/* «Показывать вместе» (владелица 10.11.2026) — здесь же, в ряду правки:
          отдельного переключателя над полем больше нет. */}
      {renderPreview && (
        <ToolBtn label={t('kit.md.together')} active={splitOn} onClick={toggleTogether}>◫</ToolBtn>
      )}
    </>
  );

  return (
    <div className="sk-md">
      {editable && editor && !allowWysiwyg && (
        <div className="sk-md__toolbar" role="toolbar" aria-label={t('kit.md.toolbar')}>
          {modeBtns}
        </div>
      )}
      {editable && editor && allowWysiwyg && (
        <div className="sk-md__toolbar" role="toolbar" aria-label={t('kit.md.toolbar')}>
          <ToolBtn label={t('kit.md.undo')} onClick={run(e => e.chain().focus().undo().run())}>↺</ToolBtn>
          <ToolBtn label={t('kit.md.redo')} onClick={run(e => e.chain().focus().redo().run())}>↻</ToolBtn>
          <Sep />
          <ToolBtn label={t('kit.md.bold')} active={editor.isActive('bold')} onClick={run(e => e.chain().focus().toggleBold().run())}><b>B</b></ToolBtn>
          <ToolBtn label={t('kit.md.italic')} active={editor.isActive('italic')} onClick={run(e => e.chain().focus().toggleItalic().run())}><i>i</i></ToolBtn>
          <ToolBtn label={t('kit.md.strike')} active={editor.isActive('strike')} onClick={run(e => e.chain().focus().toggleStrike().run())}><s>S</s></ToolBtn>
          <ToolBtn label={t('kit.md.code')} active={editor.isActive('code')} onClick={run(e => e.chain().focus().toggleCode().run())}>{'</>'}</ToolBtn>
          <ToolBtn label={t('kit.md.link')} active={editor.isActive('link')} onClick={toggleLink}>🔗</ToolBtn>
          <Sep />
          <ToolBtn label={t('kit.md.h1')} active={editor.isActive('heading', { level: 1 })} onClick={run(e => e.chain().focus().toggleHeading({ level: 1 }).run())}>H1</ToolBtn>
          <ToolBtn label={t('kit.md.h2')} active={editor.isActive('heading', { level: 2 })} onClick={run(e => e.chain().focus().toggleHeading({ level: 2 }).run())}>H2</ToolBtn>
          <ToolBtn label={t('kit.md.h3')} active={editor.isActive('heading', { level: 3 })} onClick={run(e => e.chain().focus().toggleHeading({ level: 3 }).run())}>H3</ToolBtn>
          <Sep />
          <ToolBtn label={t('kit.md.bulletList')} active={editor.isActive('bulletList')} onClick={run(e => e.chain().focus().toggleBulletList().run())}>•</ToolBtn>
          <ToolBtn label={t('kit.md.orderedList')} active={editor.isActive('orderedList')} onClick={run(e => e.chain().focus().toggleOrderedList().run())}>1.</ToolBtn>
          <ToolBtn label={t('kit.md.taskList')} active={editor.isActive('taskList')} onClick={run(e => e.chain().focus().toggleTaskList().run())}>☑</ToolBtn>
          <ToolBtn label={t('kit.md.blockquote')} active={editor.isActive('blockquote')} onClick={run(e => e.chain().focus().toggleBlockquote().run())}>❝</ToolBtn>
          <ToolBtn label={t('kit.md.hr')} onClick={run(e => e.chain().focus().setHorizontalRule().run())}>—</ToolBtn>
          <ToolBtn label={t('kit.md.math')} onClick={insertMath}>∑</ToolBtn>
          <Sep />
          {editor.isActive('table') ? (
            <>
              <ToolBtn label={t('kit.md.addColumn')} onClick={run(e => e.chain().focus().addColumnAfter().run())}>+▏</ToolBtn>
              <ToolBtn label={t('kit.md.addRow')} onClick={run(e => e.chain().focus().addRowAfter().run())}>+▁</ToolBtn>
              <ToolBtn label={t('kit.md.deleteTable')} onClick={run(e => e.chain().focus().deleteTable().run())}>⊞×</ToolBtn>
            </>
          ) : (
            <ToolBtn label={t('kit.md.insertTable')} onClick={run(e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>⊞</ToolBtn>
          )}
          {enableImages && (
            <ToolBtn label={t('kit.md.insertImage')} active={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? '…' : '🖼'}</ToolBtn>
          )}
          <Sep />
          {modeBtns}
          {enableImages && (
            <input ref={fileInputRef} type="file" accept="image/*" hidden tabIndex={-1} aria-hidden onChange={onImageSelected} />
          )}
        </div>
      )}
      {uploadFailed && <div className="sk-md__err" role="alert">{t('kit.md.uploadFailed')}</div>}
      {mode !== 'wysiwyg' ? (
        splitOn ? (
          <div className="sk-md__split">
            {source}
            <div className="sk-md__live" role="region" aria-label={t('kit.md.live')}>{renderPreview?.(draft)}</div>
          </div>
        ) : source
      ) : (
        <div className="sk-md__box">
          <EditorContent editor={editor} />
          {editor?.isEmpty && placeholder && <div className="sk-md__placeholder" aria-hidden>{placeholder}</div>}
          {refOpen && refs && (
            // Якорь у каретки (координаты окна); поповер встаёт под ним и прижимается к краю экрана.
            <div className="sk-md__refanchor" style={{ left: refOpen.rect.left, top: refOpen.rect.top }}>
              <RefPicker
                ref={pickerRef}
                trigger={refOpen.trigger}
                typeLabels={refs.typeLabels}
                search={refSearch}
                onPick={pickRef}
                onClose={closeRefPicker}
                onRetry={() => setRefRetry(n => n + 1)}
                createSpec={refs.createSpec}
                onCreate={refs.onCreate}
              />
            </div>
          )}
          {/* position: fixed — координаты каретки приходят в координатах окна. */}
          {mentionState && mentionState.rect && (
            <div
              role="listbox"
              aria-label={t('kit.md.mentions')}
              className="sk-md__mentions"
              style={{ left: mentionState.rect.left, top: mentionState.rect.top + 4 }}
            >
              {mentionState.items.length === 0 ? (
                <div className="sk-md__mention-empty">{t('kit.md.mentionEmpty')}</div>
              ) : mentionState.items.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={i === mentionState.index}
                  className={`sk-md__mention${i === mentionState.index ? ' is-on' : ''}`}
                  // mousedown, а не click: к click suggestion уже закрыт.
                  onMouseDown={e => { e.preventDefault(); mentionState.command?.({ id: item.id, label: item.label }); }}
                >
                  {item.label}<span className="sk-md__mention-id">{item.id}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolBtn({ label, active, off, hint, onClick, children }: {
  label: string; active?: boolean;
  /** Кнопка закрыта: видна и названа, но не действует (причина — в hint). */
  off?: boolean;
  hint?: string;
  onClick: () => void; children: ReactNode;
}) {
  // aria-label = title: у кнопки с глифом («B», «🔗») иначе прочтётся глиф.
  // aria-disabled, а не disabled: закрытая кнопка остаётся в обходе с клавиш
  // и читает причину, иначе «почему нельзя» нигде не услышать.
  return (
    <button
      type="button"
      className={`sk-md__btn${active ? ' is-on' : ''}`}
      onClick={off ? undefined : onClick}
      title={hint ?? label}
      aria-label={label}
      aria-disabled={off || undefined}
      aria-pressed={active === undefined ? undefined : active}
    >{children}</button>
  );
}

function Sep() {
  return <span className="sk-md__sep" aria-hidden />;
}
