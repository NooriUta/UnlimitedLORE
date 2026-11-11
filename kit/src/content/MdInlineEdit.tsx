// MdInlineEdit (SPRINT_UXR_S5_RECORD_TASKS/S5-06) — правка markdown-поля на
// месте, встроенная в режим чтения.
//
//  - Чтение — MartProse (тот же рендер, что у всей записи). Правка
//    открывается ТОЛЬКО кнопкой ✎: касание по тексту на телефоне — прокрутка,
//    выделение, переход по ссылке, а не случайный вход в правку.
//  - Кнопка правки ОДНА (слова владелицы 10.11.2026: «не надо две кнопки
//    редактирования — исходный текст есть по кнопке md в tiptap, и выбор
//    „показывать вместе“ можно встроить туда же»). Вид правки выбирается
//    внутри редактора, в его же ряду кнопок: `</> md` — исходник markdown,
//    «◫» — исходник и живой рендер чтения рядом. Прежний переключатель
//    «код / превью / рядом» над полем и вторая кнопка «Режим исходника» в
//    строке-подсказке убраны: способ правки выбирают, уже видя редактор.
//  - «Вместе» РАЗДВИГАЕТ поле (та же правка владелицы: «при просмотре рядом
//    сжимается на половину ширина — так быть не должно, раздвигай, у нас есть
//    большой запас»): на секции появляется data-wide="side", и seidr.css
//    снимает с неё и с колонки-предка меру чтения --read-col. Без этого
//    исходник и просмотр делили 680 px пополам — по 340 px на поле.
//  - Страховка — круг S5-07 (tiptapMd.ts): если текст не переживает
//    «Markdown → TipTap → Markdown» без потерь (сырой HTML и т.п.), визуальная
//    правка закрыта с видимой причиной, правка идёт в исходнике. Молча
//    испортить тело записи хуже, чем честно сказать «здесь только код».
//  - Черновик — строка markdown, единственный источник: переключение режимов
//    без правки текст не трогает (TipTap пишет в черновик только на правку).
//  - Сохранение — onSave вызывающего (kit не знает API). Сбой — видимая
//    ошибка, правка и черновик остаются. Esc выходит только без правок.
import { ICON_CANON } from '../elements/iconCanon';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { MartProse } from './MartProse';
import { TipTapField, type MentionItem, type TipTapRefSource } from './TipTapField';
import { isLosslessMd, sameMd } from './tiptapMd';
import { IconButton } from '../elements/IconButton';
import { kitT, type KitKey } from '../i18n';
import { useKitLang } from '../i18n/lang';
import { describeError } from '../resilience/errorText';

/**
 * Вид правки: исходник, визуальная правка, исходник и просмотр рядом.
 * Кнопок-переключателей у поля больше нет — вид живёт в редакторе и может
 * приехать снаружи (например, из URL экрана).
 */
export type MdEditMode = 'code' | 'preview' | 'split';
export const MD_EDIT_MODES: readonly MdEditMode[] = ['code', 'preview', 'split'];

export interface MdInlineEditProps {
  /** Текущее значение поля (markdown). */
  value: string;
  /** Имя поля («Описание», «Тело») — для кнопки ✎ и подписей полей ввода. */
  label: string;
  /** Сохранение. Не задано — поле только для чтения, кнопки ✎ нет. */
  onSave?: (markdown: string) => Promise<void> | void;
  /** Вид правки, управляемый (например, из URL экрана). */
  mode?: MdEditMode;
  onMode?: (mode: MdEditMode) => void;
  /** Вид правки по умолчанию для неуправляемого режима. */
  defaultMode?: MdEditMode;
  /** Текст пустого поля; по умолчанию — «Текста нет». */
  emptyText?: string;
  /**
   * Показывать строку-подсказку «как править» над текстом. По умолчанию да.
   *
   * Слова владелицы 09.11.2026: «верни типтап редактирование, вы ухудшили user
   * experience». Когда разделы тела стали править каждый по отдельности
   * (S5-06), подсказка размножилась по числу разделов: у ADR их стало три, и
   * запись из документа превратилась в форму. Подсказка — свойство ЗАПИСИ, а
   * не каждого поля, поэтому её показывает только первый редактор, остальные
   * её гасят. Сама правка на месте (TipTap) у каждого раздела остаётся.
   */
  hint?: boolean;
  /** Загрузчик картинок для превью (TipTapField). */
  onUploadImage?: (file: File) => Promise<{ url: string }>;
  /** Упоминания по «@» в превью. */
  mentionItems?: MentionItem[];
  /** Ссылки на записи в тексте (мини-окно «[[» / «#тип», ADR-LORE-050); не задан — нет окна. */
  refs?: TipTapRefSource;
  /**
   * Черновик поля на сервере (S5-09). kit про API не знает — получает три
   * действия: прочитать, сохранить, снять. Нет слота — поле работает как
   * раньше, без единого вызова.
   */
  drafts?: MdDraftSlot;
  className?: string;
}

/** Черновик поля: что умеет вызывающий (web-next: /lore/me/drafts). */
export interface MdDraftSlot {
  /** Черновик поля или null, если его нет. Бросает — «не прочитали», а не «нет». */
  load: () => Promise<{ text: string; savedAt: string; stale?: boolean } | null>;
  /** Сохранить черновик; зовётся с паузой, а не на каждую букву. */
  save: (text: string) => Promise<void> | void;
  /** Снять черновик: после сохранения записи и по «Отбросить». */
  remove: () => Promise<void> | void;
  /** Пауза перед сохранением, мс (по умолчанию 1500). */
  delayMs?: number;
}

export function MdInlineEdit({
  value, label, onSave, mode: modeProp, onMode, defaultMode = 'preview',
  emptyText, hint = true, onUploadImage, mentionItems, refs, drafts, className,
}: MdInlineEditProps) {
  const lang = useKitLang();
  const t = (k: KitKey, vars?: Record<string, string | number>) => kitT(lang, k, vars);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [ownMode, setOwnMode] = useState<MdEditMode>(defaultMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Сохранённое показываем сразу, пока вызывающий не принёс новое value.
  const [saved, setSaved] = useState<{ base: string; md: string } | null>(null);
  // ── черновик на сервере (S5-09) ───────────────────────────────────────
  // Предложение восстановить видно СРАЗУ при открытии записи: иначе про
  // черновик узнаёт только тот, кто и так собрался править.
  const [pending, setPending] = useState<{ text: string; savedAt: string; stale?: boolean } | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const penRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  const wasEditing = useRef(false);

  const shown = saved && saved.base === value ? saved.md : value;
  // Проверка круга — один раз на вход в правку (по исходному тексту), а не на
  // каждую букву: превью не должно «мигать» доступностью посреди набора.
  const [lossless, setLossless] = useState(true);
  const wanted = modeProp ?? ownMode;
  const mode: MdEditMode = wanted === 'preview' && !lossless ? 'code' : wanted;
  const dirty = draft !== shown;

  // Читаем черновик один раз на значение поля: value меняется только когда
  // запись перечитали, и тогда черновик надо сверить заново.
  useEffect(() => {
    const slot = draftsRef.current;
    if (!slot) return;
    let live = true;
    void (async () => {
      try {
        const d = await slot.load();
        if (!live) return;
        setDraftNote(null);
        // Черновик, совпадающий с текстом записи, предлагать нечего.
        setPending(d && d.text !== value ? d : null);
      } catch (e) {
        // «Не прочитали» ≠ «нет»: молчать здесь значит потерять правку.
        if (live) { setPending(null); setDraftNote(t('kit.mdedit.draft.loadFailed', { reason: describeError(e) })); }
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Открыли правку — фокус внутрь поля: в исходник, а при визуальной правке —
  // на первую кнопку редактора (саму область набора не трогаем: ProseMirror
  // ставит каретку сам, а внешний focus() дёргает его прокрутку). Закрыли —
  // фокус возвращается на ✎, иначе он улетает в начало страницы.
  useEffect(() => {
    if (editing) boxRef.current?.querySelector<HTMLElement>('.sk-md__source, .sk-md__btn')?.focus();
    else if (wasEditing.current) penRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  // Автосохранение черновика: с паузой, а не на каждую букву. Текст, равный
  // записи, — не черновик: снимаем, иначе всплывёт поверх сохранённого.
  useEffect(() => {
    const slot = draftsRef.current;
    if (!slot || !editing) return;
    if (draft === shown) {
      const id = setTimeout(() => { void Promise.resolve(slot.remove()).catch(() => {}); }, slot.delayMs ?? 1500);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      void (async () => {
        try {
          await slot.save(draft);
          setDraftNote(null);
        } catch (e) {
          // Текст в поле остаётся: сбой записи черновика не причина его терять.
          setDraftNote(t('kit.mdedit.draft.saveFailed', { reason: describeError(e) }));
        }
      })();
    }, slot.delayMs ?? 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, editing, shown]);

  const open = () => {
    setDraft(shown);
    setLossless(isLosslessMd(shown));
    setError(null);
    setEditing(true);
  };
  const close = () => { setEditing(false); setError(null); };

  const choose = (m: MdEditMode) => {
    if (m === 'preview' && !lossless) return;
    if (modeProp === undefined) setOwnMode(m);
    onMode?.(m);
  };

  const save = async () => {
    if (!onSave || saving) return;
    if (!dirty) { close(); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setSaved({ base: value, md: draft });
      setEditing(false);
      // Запись сохранена — черновик больше не нужен и не должен всплывать
      // поверх сохранённого текста.
      setPending(null);
      try {
        await draftsRef.current?.remove();
      } catch {
        // Снять черновик не удалось — запись всё равно сохранена; об этом
        // скажет следующее чтение черновика, выдумывать тут нечего.
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  // TipTap сообщает своё каноническое написание (мягкие переносы склеены и
  // т.п.) и при служебных транзакциях, не только на правку. Черновик меняем
  // лишь когда изменился СМЫСЛ (рендер чтения): иначе простое переключение
  // «исходник → набор → исходник» переписывало бы текст автора (поймано
  // тестом). Набранное в ИСХОДНИКЕ берём дословно: там каждая буква —
  // решение автора, канонизировать её нельзя.
  const fromTipTap = (md: string, meta?: { source?: boolean }) => {
    if (meta?.source) { setDraft(md); return; }
    setDraft(prev => (sameMd(prev, md) ? prev : md));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); return; }
    // Esc без правок — выход; с правками черновик не выбрасывается молча.
    if (e.key === 'Escape' && !dirty && !saving) { e.preventDefault(); close(); }
  };

  // Живой просмотр для режима «вместе»: тот же рендер, что у чтения. Поле
  // просит его у нас, а не тянет MartProse само — рендер чтения со схемами и
  // BPMN не должен приезжать в каждое поле правки.
  const renderPreview = (md: string) => <MartProse text={md} />;

  const restore = () => {
    if (!pending) return;
    setDraft(pending.text);
    setLossless(isLosslessMd(pending.text));
    setError(null);
    setEditing(true);
    setPending(null);
  };
  const discard = () => {
    setPending(null);
    void Promise.resolve(draftsRef.current?.remove()).catch(() => {});
  };
  // Время сохранения — местное «ЧЧ:ММ»: подпись из слов владелицы
  // «Восстановить черновик от HH:MM».
  const savedTime = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
  const draftBar = (pending || draftNote) && (
    <div className="sk-mdedit__draft" role="status">
      {pending && (
        <>
          <span className="sk-mdedit__draft-text">
            {t('kit.mdedit.draft.restore', { time: savedTime(pending.savedAt) })}
            {/* Запись правили после черновика: слияние по блокам — S5-08, */}
            {/* поэтому молча накладывать старый текст на новый нельзя. */}
            {pending.stale ? ` · ${t('kit.mdedit.draft.stale')}` : ''}
          </span>
          <button type="button" className="sk-btn" onClick={restore}>{t('kit.mdedit.draft.restoreBtn')}</button>
          <button type="button" className="sk-btn" onClick={discard}>{t('kit.mdedit.draft.discard')}</button>
        </>
      )}
      {draftNote && <span className="sk-mdedit__draft-note">{draftNote}</span>}
    </div>
  );

  if (!editing) {
    return (
      <section className={['sk-mdedit', className].filter(Boolean).join(' ')} data-state="read">
        {draftBar}
        {/* S4-CONTENT-V4 (прототип v4): как править — строкой над текстом.
            Кнопки в ней больше нет (владелица 10.11.2026: «не надо две кнопки
            редактирования») — только слова о том, где искать исходник. */}
        {onSave && hint && (
          <div className="sk-mdedit__hint">
            <span className="sk-mdedit__hint-text">{t('kit.mdedit.hint')}</span>
          </div>
        )}
        {onSave && (
          <IconButton
            ref={penRef}
            className="sk-mdedit__pen"
            icon={ICON_CANON.ctlEdit}
            label={t('kit.mdedit.edit', { field: label })}
            onClick={open}
          />
        )}
        {shown.trim()
          ? <MartProse text={shown} />
          : <p className="sk-mdedit__empty">{emptyText ?? t('kit.mdedit.empty')}</p>}
      </section>
    );
  }

  return (
    <section
      ref={boxRef}
      className={['sk-mdedit', 'is-editing', className].filter(Boolean).join(' ')}
      data-state="edit"
      // «Вместе» — поле раздвигается: мера чтения (--read-col) снимается в
      // seidr.css по этому признаку, иначе исходник и просмотр делят её
      // пополам.
      data-wide={mode === 'split' ? 'side' : undefined}
      aria-label={t('kit.mdedit.editing', { field: label })}
      onKeyDown={onKeyDown}
    >
      {draftBar}
      <div className="sk-mdedit__bar">
        <span className="sk-mdedit__actions">
          <button type="button" className="sk-btn" onClick={close} disabled={saving}>{t('kit.mdedit.cancel')}</button>
          <button
            type="button"
            className="sk-btn sk-btn--primary"
            onClick={() => void save()}
            disabled={saving}
            aria-keyshortcuts="Control+Enter"
            aria-busy={saving || undefined}
          >{saving ? t('kit.mdedit.saving') : t('kit.mdedit.save')}</button>
        </span>
      </div>
      {!lossless && <p className="sk-mdedit__note">{t('kit.mdedit.lossy')}</p>}
      {error && <div className="sk-mdedit__err" role="alert">{t('kit.mdedit.saveFailed', { reason: error })}</div>}
      {/* Один редактор на все виды правки: исходник и «вместе» — его же
          кнопки. Вид держим у себя (он может приехать из URL), редактор
          сообщает о переключении назад. */}
      <TipTapField
        value={draft}
        onChange={fromTipTap}
        ariaLabel={label}
        onUploadImage={onUploadImage}
        mentionItems={mentionItems}
        refs={refs}
        minHeight={160}
        mode={mode === 'preview' ? 'wysiwyg' : 'md'}
        onModeChange={m => choose(m === 'wysiwyg' ? 'preview' : 'code')}
        sideBySide={mode === 'split'}
        onSideBySide={on => choose(on ? 'split' : 'code')}
        renderPreview={renderPreview}
        allowWysiwyg={lossless}
        lossyReason={t('kit.mdedit.lossy')}
      />
    </section>
  );
}
