// Палитра Ctrl+K и поиск «/» (SPRINT_UXR_S10_SEIDR_KIT/K-07).
// Ctrl+K (⌘K) — записи и команды; «/» — только записи; без запроса — недавние.
// Клавиши — по e.code через matchHotkey (S4-00f, K-06): в русской раскладке
// e.key для K — «л», для «/» — «.», и привязка к символу молча не сработала бы.
//
// ARIA — combobox + listbox с aria-activedescendant: фокус всё время в поле
// ввода, стрелки двигают выбор, Enter открывает, Esc закрывает и возвращает
// фокус открывателю. Честные состояния: «недавних нет», «ничего не найдено по
// …», «ищу только по загруженному N из M», «команда упала» — словами.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { KitCtx, KitRecord } from '../core/contract';
import { GameIcon, SECTION_ICONS } from '../elements/GameIcon';
import { Kbd } from '../elements/Kbd';
import { kitT, useKitLang } from '../i18n';
import { matchHotkey } from '../resilience/hotkeys';
import { isEditableTarget } from '../resilience/editable';
import { itemKey, searchPalette, type PaletteItem, type PaletteMode, type RecentList } from './paletteModel';

// ── горячие клавиши ───────────────────────────────────────────────────────

export const PALETTE_HOTKEY = 'Mod+K';
export const SEARCH_HOTKEY = '/';

// S4-13 (B-08): «/» из абзаца TipTap — набор текста; проверка общая на kit.
const isEditable = isEditableTarget;

export interface KitPaletteState {
  open: boolean;
  mode: PaletteMode;
  openPalette: () => void;
  openSearch: () => void;
  close: () => void;
}

/**
 * Состояние палитры + глобальные клавиши. Ctrl+K работает и из поля ввода
 * (браузерный поиск перехватываем), «/» — только вне полей: там это символ.
 */
export function useKitPalette(opts: { enabled?: boolean } = {}): KitPaletteState {
  const enabled = opts.enabled ?? true;
  const [state, setState] = useState<{ open: boolean; mode: PaletteMode }>({ open: false, mode: 'all' });
  const openPalette = useCallback(() => setState({ open: true, mode: 'all' }), []);
  const openSearch = useCallback(() => setState({ open: true, mode: 'records' }), []);
  const close = useCallback(() => setState(s => ({ ...s, open: false })), []);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (matchHotkey(e, PALETTE_HOTKEY)) {
        e.preventDefault();
        openPalette();
      } else if (matchHotkey(e, SEARCH_HOTKEY) && !isEditable(e.target)) {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, openPalette, openSearch]);

  return { ...state, openPalette, openSearch, close };
}

// ── диалог ────────────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  open: boolean;
  mode: PaletteMode;
  onClose: () => void;
  ctx: KitCtx;
  recent: RecentList;
  /** Открыть запись; по умолчанию — переход по ctx.href(id). */
  onOpenRecord?: (r: KitRecord) => void;
  /** Сколько строк выдачи показывать (по умолчанию 30). */
  limit?: number;
}

export function CommandPalette(props: CommandPaletteProps) {
  if (!props.open) return null;
  // Внутренний компонент монтируется заново на каждое открытие — запрос,
  // выбор и ошибка сбрасываются сами, без эффектов-обнулителей.
  return <PaletteDialog {...props} />;
}

function PaletteDialog({ mode, onClose, ctx, recent, onOpenRecord, limit = 30 }: CommandPaletteProps) {
  const lang = useKitLang();
  const uid = useId();
  const listId = `${uid}-list`;
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);

  const result = useMemo(
    () => searchPalette({ query, data: ctx.data, config: ctx.config, mode, recent: recent.list(), limit }),
    [query, ctx.data, ctx.config, mode, recent, limit],
  );

  // Видимый порядок = порядок навигации стрелками: недавние одной группой,
  // выдача — записи, затем команды.
  const groups = useMemo(() => {
    if (result.section === 'recent') return [{ id: 'recent', label: kitT(lang, 'kit.palette.recent'), items: result.items }];
    const recs = result.items.filter(i => i.type === 'record');
    const cmds = result.items.filter(i => i.type === 'command');
    return [
      { id: 'records', label: kitT(lang, 'kit.palette.records'), items: recs },
      { id: 'commands', label: kitT(lang, 'kit.palette.commands'), items: cmds },
    ].filter(g => g.items.length > 0);
  }, [result, lang]);
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);
  const optionId = (i: number) => `${uid}-opt-${i}`;
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null;
    input.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  function activate(item: PaletteItem) {
    if (item.type === 'command') {
      const cmd = ctx.config.palette?.commands?.find(c => c.id === item.id);
      if (!cmd) return;
      try {
        cmd.run(ctx);
      } catch (e) {
        // Упавшая команда — не молчаливое закрытие: палитра остаётся и говорит.
        setFailure(kitT(lang, 'kit.palette.commandFailed', { title: cmd.title, reason: e instanceof Error ? e.message : String(e) }));
        return;
      }
      recent.push(item);
      onClose();
      return;
    }
    const rec = ctx.data.records.find(r => r.id === item.id);
    if (!rec) return;
    recent.push(item);
    onClose();
    if (onOpenRecord) onOpenRecord(rec);
    else window.location.href = ctx.href(rec.id);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (flat.length) setActive((current + 1) % flat.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (flat.length) setActive((current - 1 + flat.length) % flat.length);
        break;
      case 'Home':
        if (flat.length) { e.preventDefault(); setActive(0); }
        break;
      case 'End':
        if (flat.length) { e.preventDefault(); setActive(flat.length - 1); }
        break;
      case 'Enter':
        e.preventDefault();
        if (flat[current]) activate(flat[current]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      case 'Tab':
        // Единственный фокусируемый элемент — поле; фокус из модалки не уходит.
        e.preventDefault();
        break;
    }
  }

  const title = kitT(lang, mode === 'all' ? 'kit.palette.title' : 'kit.palette.searchTitle');
  const meta = ctx.data.meta;
  const returned = meta.returned ?? ctx.data.records.length;
  const q = query.trim();

  let note: string | null = null;
  if (flat.length === 0) {
    note = q ? kitT(lang, 'kit.palette.notFound', { query: q }) : kitT(lang, 'kit.palette.emptyRecent');
  }

  let index = -1;
  return createPortal(
    <>
      <div className="sk-palette-backdrop" aria-hidden="true" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="sk-palette" data-mode={mode}>
        <div className="sk-palette__head">
          <GameIcon slug={mode === 'all' ? SECTION_ICONS.commands : SECTION_ICONS.search} size={16} />
          <input
            ref={input}
            className="sk-palette__input"
            type="text"
            role="combobox"
            aria-label={title}
            aria-autocomplete="list"
            aria-expanded={flat.length > 0}
            aria-controls={flat.length > 0 ? listId : undefined}
            aria-activedescendant={flat.length > 0 ? optionId(current) : undefined}
            placeholder={kitT(lang, mode === 'all' ? 'kit.palette.placeholderAll' : 'kit.palette.placeholderRecords')}
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={e => { setQuery(e.target.value); setActive(0); setFailure(null); }}
            onKeyDown={onKeyDown}
          />
          <Kbd keys={['Esc']} />
        </div>

        {meta.truncated && (
          <p className="sk-palette__trunc">
            {meta.total != null
              ? kitT(lang, 'kit.palette.truncated', { returned, total: meta.total })
              : kitT(lang, 'kit.palette.truncatedUnknown', { returned })}
          </p>
        )}
        {failure && <div role="alert" className="sk-palette__fail">{failure}</div>}

        {flat.length > 0 ? (
          <div ref={list} id={listId} role="listbox" aria-label={title} className="sk-palette__list">
            {groups.map(g => (
              <div key={g.id} role="group" aria-label={g.label} className="sk-palette__group">
                <div className="sk-palette__grouphead" aria-hidden="true">{g.label}</div>
                {g.items.map(item => {
                  index += 1;
                  const i = index;
                  const selected = i === current;
                  return (
                    <div
                      key={itemKey(item)}
                      id={optionId(i)}
                      role="option"
                      aria-selected={selected}
                      data-id={itemKey(item)}
                      data-index={i}
                      className={['sk-palette__opt', selected && 'sk-palette__opt--active'].filter(Boolean).join(' ')}
                      onMouseDown={e => e.preventDefault()}
                      onMouseMove={() => { if (!selected) setActive(i); }}
                      onClick={() => activate(item)}
                    >
                      <GameIcon slug={item.type === 'record' ? item.icon : SECTION_ICONS.commands} size={15} />
                      <span className="sk-palette__title">{item.title}</span>
                      {item.type === 'record'
                        ? <><span className="sk-palette__kind">{item.kindTitle}</span><span className="sk-palette__id">{item.id}</span></>
                        : <span className="sk-palette__kind">{kitT(lang, 'kit.palette.command')}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div role="status" className="sk-palette__empty">{note}</div>
        )}

        <div className="sk-palette__foot">
          {result.total > result.items.length && (
            <span className="sk-palette__more">{kitT(lang, 'kit.palette.more', { shown: result.items.length, total: result.total })}</span>
          )}
          <span className="sk-palette__hint">{kitT(lang, 'kit.palette.hint')}</span>
        </div>
      </div>
    </>,
    document.body,
  );
}
