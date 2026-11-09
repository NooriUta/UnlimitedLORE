// MdInlineEdit (SPRINT_UXR_S5_RECORD_TASKS/S5-06) — правка markdown-поля на
// месте, встроенная в режим чтения.
//
//  - Чтение — MartProse (тот же рендер, что у всей записи). Правка
//    открывается ТОЛЬКО кнопкой ✎: касание по тексту на телефоне — прокрутка,
//    выделение, переход по ссылке, а не случайный вход в правку.
//  - Внутри — переключатель «код / превью / рядом»: код — исходник markdown,
//    превью — визуальная правка TipTap (TipTapField), рядом — исходник и
//    живой рендер чтения бок о бок.
//  - Страховка — круг S5-07 (tiptapMd.ts): если текст не переживает
//    «Markdown → TipTap → Markdown» без потерь (сырой HTML и т.п.), превью
//    закрыто с видимой причиной, правка идёт в коде. Молча испортить тело
//    записи хуже, чем честно сказать «здесь только код».
//  - Черновик — строка markdown, единственный источник: переключение режимов
//    без правки текст не трогает (TipTap пишет в черновик только на правку).
//  - Сохранение — onSave вызывающего (kit не знает API). Сбой — видимая
//    ошибка, правка и черновик остаются. Esc выходит только без правок.
import { ICON_CANON } from '../elements/iconCanon';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { MartProse } from './MartProse';
import { TipTapField, type MentionItem } from './TipTapField';
import { isLosslessMd, sameMd } from './tiptapMd';
import { IconButton } from '../elements/IconButton';
import { kitT, type KitKey } from '../i18n';
import { useKitLang } from '../i18n/lang';
import { describeError } from '../resilience/errorText';

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
   * (S5-06), подсказка и кнопка «Режим исходника» размножились по числу
   * разделов: у ADR их стало три, и запись из документа превратилась в форму.
   * Подсказка — свойство ЗАПИСИ, а не каждого поля, поэтому её показывает
   * только первый редактор, остальные её гасят. Сама правка на месте
   * (TipTap) у каждого раздела остаётся.
   */
  hint?: boolean;
  /** Загрузчик картинок для превью (TipTapField). */
  onUploadImage?: (file: File) => Promise<{ url: string }>;
  /** Упоминания по «@» в превью. */
  mentionItems?: MentionItem[];
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

const MODE_KEY: Record<MdEditMode, KitKey> = {
  code: 'kit.mdedit.mode.code',
  preview: 'kit.mdedit.mode.preview',
  split: 'kit.mdedit.mode.split',
};

export function MdInlineEdit({
  value, label, onSave, mode: modeProp, onMode, defaultMode = 'preview',
  emptyText, hint = true, onUploadImage, mentionItems, drafts, className,
}: MdInlineEditProps) {
  const lang = useKitLang();
  const t = (k: KitKey, vars?: Record<string, string | number>) => kitT(lang, k, vars);
  const srcId = useId();
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
  const groupRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (editing) groupRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
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
  // «код → превью → код» переписывало бы текст автора (поймано тестом).
  const fromTipTap = (md: string) => {
    setDraft(prev => (sameMd(prev, md) ? prev : md));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); return; }
    // Esc без правок — выход; с правками черновик не выбрасывается молча.
    if (e.key === 'Escape' && !dirty && !saving) { e.preventDefault(); close(); }
  };

  const onGroupKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const avail = MD_EDIT_MODES.filter(m => m !== 'preview' || lossless);
    const i = avail.indexOf(mode);
    const next = avail[(i + (e.key === 'ArrowRight' ? 1 : avail.length - 1)) % avail.length];
    choose(next);
    groupRef.current?.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus();
  };

  const srcLabel = `${label} · ${t('kit.mdedit.source')}`;
  const source = (
    <textarea
      id={srcId}
      className="sk-md__source sk-mdedit__source"
      value={draft}
      aria-label={srcLabel}
      spellCheck
      onChange={e => setDraft(e.target.value)}
    />
  );
  const preview = useMemo(() => <MartProse text={draft} />, [draft]);

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
        {/* S4-CONTENT-V4 (прототип v4): как править — строкой над текстом; «Режим исходника» — сразу в код. */}
        {onSave && hint && (
          <div className="sk-mdedit__hint">
            <span className="sk-mdedit__hint-text">{t('kit.mdedit.hint')}</span>
            <button type="button" className="sk-mdedit__src-btn" onClick={() => { choose('code'); open(); }}>
              {t('kit.mdedit.sourceMode')}
            </button>
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
      className={['sk-mdedit', 'is-editing', className].filter(Boolean).join(' ')}
      data-state="edit"
      aria-label={t('kit.mdedit.editing', { field: label })}
      onKeyDown={onKeyDown}
    >
      {draftBar}
      <div className="sk-mdedit__bar">
        <div
          ref={groupRef}
          className="sk-mdedit__modes"
          role="radiogroup"
          aria-label={t('kit.mdedit.modes')}
          onKeyDown={onGroupKey}
        >
          {MD_EDIT_MODES.map(m => {
            const off = m === 'preview' && !lossless;
            const on = m === mode;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                data-mode={m}
                className={`sk-mdedit__mode${on ? ' is-on' : ''}`}
                aria-checked={on}
                aria-disabled={off || undefined}
                tabIndex={on ? 0 : -1}
                title={off ? t('kit.mdedit.lossy') : undefined}
                onClick={() => choose(m)}
              >{t(MODE_KEY[m])}</button>
            );
          })}
        </div>
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
      {mode === 'code' && source}
      {mode === 'preview' && (
        <TipTapField
          value={draft}
          onChange={fromTipTap}
          ariaLabel={label}
          onUploadImage={onUploadImage}
          mentionItems={mentionItems}
          minHeight={160}
        />
      )}
      {mode === 'split' && (
        <div className="sk-mdedit__split">
          {source}
          <div className="sk-mdedit__live" aria-label={t('kit.mdedit.live')} role="region">{preview}</div>
        </div>
      )}
    </section>
  );
}
