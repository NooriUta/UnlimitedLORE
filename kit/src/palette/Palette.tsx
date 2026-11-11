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
import {
  actionsFor, hotkeyKeys, itemKey, mergeRemote, normalizeQuery, searchPalette, targetIds,
  type PaletteAction, type PaletteItem, kindFacets, type PaletteMode, type PaletteRemoteSearch, type PaletteTarget, type RecentList,
} from './paletteModel';

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
  /** S4-14: над чем Ctrl+K — открытая запись или выделение списка (S4-10). */
  target?: PaletteTarget | null;
  /** S4-14: действия над целью; показываются только применимые к ней. */
  actions?: readonly PaletteAction[];
  /** S4-14: поиск на сервере (в LORE — слайс search); без него ищем только загруженное. */
  remote?: PaletteRemoteSearch;
  /** Пауза перед серверным запросом, мс (по умолчанию 200): не дёргать сервер на каждую букву. */
  remoteDelayMs?: number;
}

/** Короче — на сервер не ходим: одна буква совпадает почти со всем. */
export const REMOTE_MIN_CHARS = 2;

type RemoteState =
  | { query: string; status: 'ok'; records: KitRecord[]; partial: boolean }
  | { query: string; status: 'error'; reason: string };

export function CommandPalette(props: CommandPaletteProps) {
  if (!props.open) return null;
  // Внутренний компонент монтируется заново на каждое открытие — запрос,
  // выбор и ошибка сбрасываются сами, без эффектов-обнулителей.
  return <PaletteDialog {...props} />;
}

function PaletteDialog({ mode, onClose, ctx, recent, onOpenRecord, limit = 30, target, actions, remote, remoteDelayMs = 200 }: CommandPaletteProps) {
  const lang = useKitLang();
  const uid = useId();
  const listId = `${uid}-list`;
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remoteState, setRemoteState] = useState<RemoteState | null>(null);
  // S4-14: фильтр по типам — свёрнут по умолчанию (слово владелицы 11.11.2026).
  const [kindsOpen, setKindsOpen] = useState(false);
  const [kindsOn, setKindsOn] = useState<ReadonlySet<string>>(() => new Set());

  const applicable = useMemo(() => actionsFor(target, actions ?? []), [target, actions]);
  const result = useMemo(
    () => searchPalette({ query, data: ctx.data, config: ctx.config, mode, recent: recent.list(), limit, actions: applicable }),
    [query, ctx.data, ctx.config, mode, recent, limit, applicable],
  );

  // Esc закрывает палитру, где бы ни был фокус — находка P0 аудита навигации
  // 08.11.2026: «диалог остаётся видимым и при Esc на document, и при Esc в
  // поле». Клавиша была привязана к полю ввода, а фокус в нём держится не
  // всегда: щелчок по строке выдачи, по заголовку или по подложке уводит его,
  // и Esc проваливался в страницу. Обработчик поля остаётся (он гасит событие,
  // чтобы Esc не уехал в док под палитрой) — этот отвечает за остальные случаи.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.code !== 'Escape') return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Серверный поиск: ключ — нормализованный запрос. «Ищу» выводится из того,
  // что ответа на ЭТОТ запрос ещё нет, — без синхронного setState в эффекте.
  const remoteQuery = remote ? normalizeQuery(query) : '';
  const wantRemote = remoteQuery.length >= REMOTE_MIN_CHARS;
  useEffect(() => {
    if (!remote || !wantRemote) return;
    const ac = new AbortController();
    const timer = setTimeout(() => {
      remote(remoteQuery, ac.signal).then(
        r => { if (!ac.signal.aborted) setRemoteState({ query: remoteQuery, status: 'ok', records: r.records, partial: !!r.partial }); },
        (e: unknown) => {
          if (ac.signal.aborted) return;
          setRemoteState({ query: remoteQuery, status: 'error', reason: e instanceof Error ? e.message : String(e) });
        },
      );
    }, remoteDelayMs);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [remote, remoteQuery, wantRemote, remoteDelayMs]);
  const remoteNow = wantRemote && remoteState?.query === remoteQuery ? remoteState : null;
  const remoteLoading = wantRemote && !remoteNow;
  const remoteRecords = useMemo(() => (remoteNow?.status === 'ok' ? remoteNow.records : []), [remoteNow]);
  const remoteItems = useMemo(
    () => (result.section === 'results' ? mergeRemote(result.items, remoteRecords, ctx.config) : []),
    [result, remoteRecords, ctx.config],
  );

  const ids = targetIds(target);
  const targetLabel = !target || ids.length === 0 ? null
    : target.type === 'record'
      ? kitT(lang, 'kit.palette.targetRecord', { id: target.record.id })
      : kitT(lang, 'kit.palette.targetSelection', { n: ids.length });
  const actionsLabel = target?.type === 'record'
    ? kitT(lang, 'kit.palette.actionsRecord', { id: ids[0] ?? '' })
    : kitT(lang, 'kit.palette.actionsSelection', { n: ids.length });

  // Видимый порядок = порядок навигации стрелками: недавние одной группой,
  // выдача — записи, затем команды.
  const groups = useMemo(() => {
    const acts = result.items.filter(i => i.type === 'action');
    const actionsGroup = { id: 'actions', label: actionsLabel, items: acts };
    if (result.section === 'recent') {
      // Команды — отдельной группой под недавними: открытая палитра без
      // истории обязана что-то предлагать (находка P1 аудита 08.11).
      return [
        actionsGroup,
        { id: 'recent', label: kitT(lang, 'kit.palette.recent'), items: result.items.filter(i => i.type !== 'action') },
        { id: 'commands', label: kitT(lang, 'kit.palette.commands'), items: result.commands ?? [] },
      ].filter(g => g.items.length > 0);
    }
    const pass = (i: PaletteItem) => kindsOn.size === 0 || (i.type === 'record' && kindsOn.has(i.kind));
    const recs = result.items.filter(i => i.type === 'record' && pass(i));
    // Фильтр по типам скрывает команды: выбран тип — человек ищет записи.
    const cmds = kindsOn.size ? [] : result.items.filter(i => i.type === 'command');
    const server: PaletteItem[] = remoteItems.filter(pass);
    return [
      actionsGroup,
      { id: 'records', label: kitT(lang, 'kit.palette.records'), items: recs },
      { id: 'server', label: kitT(lang, 'kit.palette.server'), items: server },
      { id: 'commands', label: kitT(lang, 'kit.palette.commands'), items: cmds },
    ].filter(g => g.items.length > 0);
  }, [result, lang, actionsLabel, remoteItems, kindsOn]);
  // Пилюли считаются по всей выдаче, а не по отфильтрованной: иначе выбранный
  // тип стирал бы остальные пилюли, и снять фильтр «соседом» было бы нельзя.
  const facets = useMemo(
    () => (result.section === 'results' ? kindFacets([...result.items, ...remoteItems]) : []),
    [result, remoteItems],
  );
  const toggleKind = (k: string) => {
    setKindsOn(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    setActive(0);
  };
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

  async function runAction(id: string) {
    const act = applicable.find(a => a.id === id);
    if (!act || busy) return;
    setFailure(null);
    try {
      const pending = act.run(targetIds(target), ctx) as Promise<void> | undefined;
      if (pending && typeof pending.then === 'function') {
        setBusy(true);
        await pending;
      }
    } catch (e) {
      // Отказ — палитра остаётся открытой и говорит причину; цель не трогаем.
      setBusy(false);
      setFailure(kitT(lang, 'kit.palette.actionFailed', { title: act.title, reason: e instanceof Error ? e.message : String(e) }));
      return;
    }
    setBusy(false);
    onClose();
  }

  function activate(item: PaletteItem) {
    if (item.type === 'action') {
      // Действие зависит от цели — в «недавние» не пишется.
      void runAction(item.id);
      return;
    }
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
    const rec = ctx.data.records.find(r => r.id === item.id) ?? remoteRecords.find(r => r.id === item.id);
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
  // «Недавних пока нет» говорится и тогда, когда команды есть: это два разных
  // сообщения. Команды — что палитра умеет; пустая история — что в ней пока
  // ничего. Если прятать подсказку за наличием команд, человек не отличит
  // «ещё ничего не открывал» от «историю не запоминаем» (находка P1 аудита
  // 08.11 добавила команды — подсказку она не отменяет).
  const noRecent = !q && result.items.filter(i => i.type !== 'action').length === 0;
  if (flat.length === 0 || noRecent) {
    note = !q ? kitT(lang, 'kit.palette.emptyRecent')
      : remoteNow?.status === 'ok' ? kitT(lang, 'kit.palette.notFoundAnywhere', { query: q })
        : kitT(lang, 'kit.palette.notFound', { query: q });
  }

  let index = -1;
  return createPortal(
    <>
      <div className="sk-palette-backdrop" aria-hidden="true" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} aria-busy={busy} className="sk-palette" data-mode={mode}>
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
        {targetLabel && mode === 'all' && (
          <p className="sk-palette__target" data-testid="kit-palette-target">
            <span className="sk-palette__targetchip">{targetLabel}</span>
          </p>
        )}

        {meta.truncated && (
          <p className="sk-palette__trunc">
            {meta.total != null
              ? kitT(lang, 'kit.palette.truncated', { returned, total: meta.total })
              : kitT(lang, 'kit.palette.truncatedUnknown', { returned })}
          </p>
        )}
        {(facets.length > 1 || kindsOn.size > 0) && (
          <div className="sk-palette__kinds">
            {/* Мышью: фокус остаётся в поле ввода (ловушка Tab палитры). */}
            <button type="button" className="sk-palette__kindsbtn" aria-expanded={kindsOpen}
              onMouseDown={e => e.preventDefault()} onClick={() => setKindsOpen(o => !o)}>
              {kindsOn.size ? kitT(lang, 'kit.palette.kindsOn', { n: kindsOn.size }) : kitT(lang, 'kit.palette.kinds')}
            </button>
            {kindsOpen && facets.map(f => (
              <button key={f.kind} type="button" className="sk-pill sk-pill--filter" aria-pressed={kindsOn.has(f.kind)}
                onMouseDown={e => e.preventDefault()} onClick={() => toggleKind(f.kind)}>
                {f.title} <span className="sk-palette__kindn">{f.n}</span>
              </button>
            ))}
          </div>
        )}
        {failure && <div role="alert" className="sk-palette__fail">{failure}</div>}
        {remoteNow?.status === 'error' && (
          <div role="alert" className="sk-palette__fail">{kitT(lang, 'kit.palette.remoteFailed', { reason: remoteNow.reason })}</div>
        )}
        {(remoteLoading || (remoteNow?.status === 'ok' && remoteNow.partial)) && (
          <p className="sk-palette__remote" data-testid="kit-palette-remote" aria-live="polite">
            {kitT(lang, remoteLoading ? 'kit.palette.remoteLoading' : 'kit.palette.remotePartial')}
          </p>
        )}

        {/* Подсказка и список — не «или-или»: «недавних пока нет» остаётся
            верным, даже когда ниже перечислены команды (находка P1 аудита
            08.11 добавила команды, но пустую историю это не отменяет). */}
        {note && <div role="status" className="sk-palette__empty">{note}</div>}
        {flat.length > 0 && (
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
                      {item.type === 'record' && <><span className="sk-palette__kind">{item.kindTitle}</span><span className="sk-palette__id">{item.id}</span></>}
                      {item.type === 'command' && <span className="sk-palette__kind">{kitT(lang, 'kit.palette.command')}</span>}
                      {item.type === 'action' && <>
                        <span className="sk-palette__kind">{kitT(lang, 'kit.palette.action')}</span>
                        {item.hotkey && <Kbd keys={hotkeyKeys(item.hotkey)} />}
                      </>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
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
