// listView kit (SPRINT_UXR_S10_SEIDR_KIT/K-03, только чтение): Список/Доска,
// «Быстро»-счётчики как фильтр, строка «фильтр / группировка / порядок» с
// описанием, «Показано N из M» из meta (формат K-01), выделение и массовые
// действия через хук. Всё — из конфига (контракт kit/src/core/contract.ts),
// ничего не захардкожено под LORE.
//
// Бюджет строк — правила S9: не больше 50 на группу и «ещё N», при >20
// группах — топ-10 + «Прочие», и тогда все группы свёрнуты (S9-01, S9-02).
// Честность: статус вне словаря виден как «вне словаря», ошибка блока из
// meta.errors — errBlock с причиной, исключение вердикта — ошибка только в
// своей ячейке, проверенный ноль ≠ «фильтр всё отсеял».
//
// Выделение (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-10): долгое нажатие на строку или
// карточку (телефон) либо кнопка «Выбрать» включают режим выбора — чекбоксы,
// касание строки переключает её, Esc/«Готово» выходят. Панель действий встаёт
// на место шапки (на телефоне шапку скрывает CSS). Действие получает только
// показанные выбранные; Promise — панель занята, отказ — причина в role=alert.
// Клавиатура как слой (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11): строки — один
// таб-стоп с курсором (↑/↓, J/K, Home/End), Enter открывает, X выделяет, Esc
// снимает выделение; действия строки и действия над выделением — по своей
// клавише. Клавиши по e.code (русская раскладка), слушатель — на корне списка,
// а не на window: два списка на экране не делят клавиши. У каждой клавиши —
// кнопка с aria-keyshortcuts и подсказкой Kbd; в поле ввода клавиша — текст.
import { ICON_CANON } from '../elements/iconCanon';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { KitConfig, KitCtx, KitData, KitFilter, KitRecord, KitVerdict } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { IconButton } from '../elements/IconButton';
import { Kbd } from '../elements/Kbd';
import { Pill } from '../elements/Pill';
import {
  LIST_RESERVED_KEYS, ariaKeyshortcuts, assertKeymap, findAction, isMacPlatform, kbdKeys,
} from '../keyboard/keymap';
import { matchHotkey } from '../resilience/hotkeys';
import { kitT, useKitLang } from '../i18n';
import type { KitKey, KitLang } from '../i18n';
import { describeError } from '../resilience/errorText';
import { isEditableTarget } from '../resilience/editable';
import { pushUrlState, readUrlState } from '../resilience/urlState';
import type { UrlWindow } from '../resilience/urlState';
import { EmptyState, LoadError } from '../states/StateViews';
import { ProgressCell } from './progress';
import {
  DEFAULT_LIST_STATE, LIST_BUDGET, applyFilters, fieldValue,
  quickCounts, quickIconOf, readListState, shownOf, sortKeysOf, sortRecords, valuesOf, writeListState,
  SHOW_CLOSED_MODES, showClosedOf, splitClosed,
} from './listModel';
import type { FilterOp, ListGroup, ListState, ListViewKind } from './listModel';
import { boardLanes, groupBy, groupingOptions, multiGroupCount, parseGroupKey } from './grouping';
import { fieldValueTitle, groupKeyTitle, groupTitle as groupTitleOf } from './groupLabel';
import { applyFilterSet, describeFieldFilter, facetOf, toFilterSet } from './filterModel';
import type { FieldFilter } from './filterModel';
import { FacetFilter, ValueIconMark } from './FacetFilter';
import type { ValueIcon } from './FacetFilter';
import { selectAllShown, toggleId, visibleSelection } from './listSelection';
import { useLongPress } from './useLongPress';
import { ScreenHead } from './ScreenHead';
import { ViewMenu } from './ViewMenu';
import { GroupMenu } from './GroupMenu';
import { SortMenu } from './SortMenu';

export interface ListBulkAction {
  id: string;
  title: string;
  /**
   * Хук действия: получает id выбранных и ПОКАЗАННЫХ записей (скрытое фильтром
   * не уходит). Сохранение — забота приложения. Promise — панель занята, пока
   * он идёт; отказ виден в панели с причиной, выбор при этом сохраняется.
   */
  run: (ids: string[]) => void | Promise<unknown>;
  /** Клавиша над выделением (S4-11): «Shift+D», «Delete»… Не из занятых слоем списка. */
  hotkey?: string;
}

/**
 * Раскрытие строки (S4-09, составные объекты): под записью — её вложенное
 * содержимое (у спринта — задачи). Рисуется только у раскрытой строки, так что
 * приложение может грузить вложенное лениво, по раскрытию.
 */
export interface ListExpand {
  render: (r: KitRecord) => ReactNode;
  /** Можно ли раскрыть запись; по умолчанию — да. */
  can?: (r: KitRecord) => boolean;
}

/** Действие строки (S4-11): кнопка-иконка в строке и, по желанию, клавиша над строкой под курсором. */
export interface ListRowAction {
  id: string;
  title: string;
  /** Слаг game-icons. */
  icon: string;
  hotkey?: string;
  /** Получает [id строки]. */
  run: (ids: string[]) => void;
}

export interface ListViewProps {
  config: KitConfig;
  data: KitData;
  /** Ссылка на запись (заголовок становится ссылкой). */
  href?: (id: string) => string;
  /**
   * Открыть запись (S4-13, B-09). Без href заголовок становится кнопкой —
   * строка открывается и мышью, и с клавиатуры (Tab → Enter/Space); с href
   * вызывается при переходе по ссылке. Ни href, ни onOpen — заголовок текстом.
   * Enter на строке под курсором (S4-11) — тоже onOpen, без него — ссылка заголовка.
   */
  onOpen?: (id: string) => void;
  /** Части контекста хуков (роль, пользователь, md…); data/config берутся из пропсов. */
  ctx?: Partial<KitCtx>;
  /** Массовые действия с выбранными — через хуки приложения. */
  bulkActions?: ListBulkAction[];
  /** Действия строки — кнопки в колонке «Действия», клавиши над строкой под курсором (S4-11). */
  rowActions?: ListRowAction[];
  onSelectionChange?: (ids: string[]) => void;
  /** Состояние в URL: по умолчанию window, false — только в памяти, объект — свой (тесты, iframe). */
  urlState?: boolean | UrlWindow;
  /** Начальное состояние (URL важнее). */
  initial?: Partial<ListState>;
  /**
   * Управляемое состояние (S4-08, сохранённые виды): задано — список рисует
   * его и не держит своего; правки уходят в onStateChange, URL пишется так же.
   */
  state?: ListState;
  /** Каждая правка фильтра, группировки, порядка или вида — и в управляемом режиме, и в обычном. */
  onStateChange?: (state: ListState) => void;
  budget?: Partial<typeof LIST_BUDGET>;
  /**
   * Свои иконки «Быстро» (id → слаг game-icons). Без них «Быстро» по одному
   * статусу берёт иконку статуса из словаря (S4-04), прочие — без иконки.
   */
  quickIcons?: Record<string, string>;
  /**
   * Иконка значения поля в фасетах и ячейках (S4-05). undefined — по умолчанию
   * (статус и вид — из конфига), null — без иконки. Подпись остаётся всегда.
   */
  valueIcon?: (key: string, value: string) => ValueIcon | null | undefined;
  /** Раскрытие строки с вложенным содержимым (только вид «Список»). */
  expand?: ListExpand;
  /**
   * Шапка экрана (S4-22, S4-23): задана — список сам рисует ScreenHead с
   * заголовком, а виды переезжают в её строку. Нет — виды остаются в полосе фильтров.
   */
  head?: ListHead;
  /** Иконки видов (вид → слаг game-icons). Задаёт приложение: иконки — из канона LORE v1 (S4-25). */
  viewIcons?: Partial<Record<ListViewKind, string>>;
  className?: string;
}

/** Шапка экрана списка: заголовок, его id и иконка, первичное действие. */
export interface ListHead {
  title: ReactNode;
  titleId?: string;
  icon?: string;
  actions?: ReactNode;
}

const VIEWS_RENDERED: ListViewKind[] = ['list', 'board'];
/** Ключ группы «Закрытые N» (S4-27): не значение поля, с ними не столкнётся. */
const CLOSED_KEY = '__closed__';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function resolveWin(urlState: ListViewProps['urlState']): UrlWindow | null {
  if (urlState === false) return null;
  if (urlState && typeof urlState === 'object') return urlState;
  return typeof window === 'undefined' ? null : window;
}

/** Раскрытые строки в URL: lx=id1,id2 (id кодирует URLSearchParams). */
const EXPAND_PARAM = 'lx';
function initialExpanded(win: UrlWindow | null): Set<string> {
  if (!win) return new Set();
  const raw = readUrlState(win).get(EXPAND_PARAM);
  return new Set(raw ? raw.split(',').filter(Boolean) : []);
}

function initialState(win: UrlWindow | null, initial: Partial<ListState> | undefined): ListState {
  const s: ListState = { ...DEFAULT_LIST_STATE, ...initial };
  if (!win) return s;
  const params = readUrlState(win);
  const parsed = readListState(params);
  if (params.has('lv')) s.view = parsed.view;
  if (params.has('lq')) s.quick = parsed.quick;
  if (params.has('lg')) s.group = parsed.group;
  if (params.has('ls')) s.sort = parsed.sort;
  if (params.has('lf')) s.filters = parsed.filters;
  if (params.has('lo')) s.ops = parsed.ops;
  if (params.has('lt')) s.text = parsed.text;
  if (params.has('lc')) s.closed = parsed.closed;
  if (params.has('lg2')) s.group2 = parsed.group2;
  return s;
}

/** Подписи ключей, значений и статусов — из конфига, общие для списка и доски. */
function useLabels(config: KitConfig, lang: KitLang) {
  return useMemo(() => {
    const statuses = new Map(config.statuses.items.map(s => [s.code, s]));
    // Подписи — общие с дорожками доски и таймлайна (groupLabel, S4-06).
    const keyTitle = (key: string): string => groupKeyTitle(config, lang, key);
    const valueTitle = (key: string, v: string): string => fieldValueTitle(config, lang, key, v);
    return { statuses, keyTitle, valueTitle };
  }, [config, lang]);
}

type Labels = ReturnType<typeof useLabels>;

function StatusCell({ code, labels }: { code: string; labels: Labels }) {
  const s = labels.statuses.get(code);
  const style = { '--st-c': s?.color ?? 'var(--t3)' } as CSSProperties;
  return (
    <span className={`sk-list__status${s ? '' : ' is-unknown'}`} style={style} data-status={code}>
      <GameIcon slug={s?.icon ?? 'help'} size={14} />
      <span>{labels.valueTitle('status', code)}</span>
    </span>
  );
}

function VerdictCell({ r, ctx, lang }: { r: KitRecord; ctx: KitCtx; lang: KitLang }) {
  const fn = ctx.config.verdict;
  if (!fn) return <span className="sk-list__verdict" data-verdict="none">—</span>;
  let v: KitVerdict;
  try {
    v = fn(r, ctx);
  } catch (e) {
    return (
      <span className="sk-list__verdict" data-verdict="error" title={e instanceof Error ? e.message : String(e)}>
        {kitT(lang, 'kit.list.verdictError')}
      </span>
    );
  }
  if (!v.max) return <span className="sk-list__verdict" data-verdict="none">—</span>;
  const state = v.failed.length ? 'fail' : 'ok';
  return (
    <span className="sk-list__verdict" data-verdict={state} title={[...v.failed, ...v.hints].join(', ') || undefined}>
      {v.score}/{v.max}
    </span>
  );
}

/** Поле набора текста: там клавиша — буква, а не команда. Одна проверка на
 *  весь kit (S4-13, B-08): чекбокс и радио — не набор, потомок contenteditable — набор. */
const isTypingTarget = isEditableTarget;

type Opener = { href?: (id: string) => string; onOpen?: (id: string) => void };

// B-09: открываемое мышью открывается и с клавиатуры — ссылка или кнопка,
// а не <span> с обработчиком клика на строке.
function Title({ r, href, onOpen }: { r: KitRecord } & Opener) {
  if (href) return <a className="sk-list__title" href={href(r.id)} onClick={onOpen ? () => onOpen(r.id) : undefined}>{r.title}</a>;
  if (onOpen) return <button type="button" className="sk-list__title sk-list__title--btn" onClick={() => onOpen(r.id)}>{r.title}</button>;
  return <span className="sk-list__title">{r.title}</span>;
}

export function ListView({
  config, data, href, ctx: ctxPart, bulkActions, rowActions, onOpen, onSelectionChange, urlState, initial, budget: budgetPart,
  quickIcons, valueIcon, expand, head, viewIcons, className, state: stateProp, onStateChange,
}: ListViewProps) {
  // Клавиша, которую не нажать однозначно, — ошибка конфигурации, а не тишина.
  assertKeymap([...(rowActions ?? []), ...(bulkActions ?? [])], LIST_RESERVED_KEYS);
  const mac = isMacPlatform();
  const rootRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const lang = useKitLang();
  const t = (k: KitKey, vars?: Record<string, string | number>) => kitT(lang, k, vars);
  const labels = useLabels(config, lang);
  const budget = { ...LIST_BUDGET, ...budgetPart };
  const win = resolveWin(urlState);
  const [ownState, setState] = useState<ListState>(() => initialState(win, initial));
  const state = stateProp ?? ownState;
  // Управляемый режим: состояние пришло снаружи (выбор вида) — URL догоняет.
  const controlledKey = stateProp ? JSON.stringify(writeListState(stateProp)) : null;
  useEffect(() => {
    if (win && stateProp) pushUrlState(writeListState(stateProp), { win, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledKey]);
  const [ui, setUi] = useState<{ by: string | null; view: ListViewKind; open: Record<string, boolean>; more: Record<string, number> }>(
    { by: state.group, view: state.view, open: {}, more: {} },
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(win));
  const toggleExpand = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    if (win) pushUrlState({ [EXPAND_PARAM]: n.size ? [...n].join(',') : null }, { win, replace: true });
    return n;
  });
  // Режим выбора (S4-10): включается долгим нажатием или кнопкой «Выбрать».
  const [mode, setMode] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<{ title: string; reason: string } | null>(null);

  const listCfg = config.list;
  const views = (listCfg?.views ?? ['list']).filter(v => VIEWS_RENDERED.includes(v));
  const view: ListViewKind = views.includes(state.view) ? state.view : (views[0] ?? 'list');
  const quick = listCfg?.quick ?? [];
  const filterKeys = listCfg?.filters ?? [];
  const groupOpts = useMemo(() => groupingOptions(config), [config]);
  const hasGroupings = groupOpts.fields.length + groupOpts.relations.length > 0;
  const baseColumns = listCfg?.columns ?? ['title+id', 'status'];
  // Чекбоксы — колонкой конфига или в режиме выбора (тогда первой колонкой, S4-10);
  // действия строки (S4-11) — последней колонкой.
  const withSelect = mode && !baseColumns.includes('select') ? ['select', ...baseColumns] : baseColumns;
  const columns = rowActions?.length && !withSelect.includes('actions') ? [...withSelect, 'actions'] : withSelect;

  const update = (patch: Partial<ListState>) => {
    if (stateProp) {
      onStateChange?.({ ...stateProp, ...patch });
      return;
    }
    const next = { ...ownState, ...patch };
    if (win) pushUrlState(writeListState(next), { win, replace: true });
    setState(next);
    onStateChange?.(next);
  };

  const ctx: KitCtx = useMemo(() => ({
    data, config, href: href ?? (id => `#${encodeURIComponent(id)}`), esc, md: (s: string) => s, ...ctxPart,
  }), [data, config, href, ctxPart]);

  const records = data.records;
  // S4-05: поля (есть / нет / пусто / не пусто) и текст — одним набором
  const filterSet = useMemo(() => toFilterSet(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(state.filters), JSON.stringify(state.ops), state.text]);
  const activeQuick = quick.find(q => q.id === state.quick) ?? null;
  const quickFilters: KitFilter[] = activeQuick ? [activeQuick.filter] : [];
  const pool = useMemo(() => applyFilterSet(records, filterSet), [records, filterSet]);
  const counts = useMemo(() => quickCounts(pool, quick, []), [pool, quick]);
  const sortedAll = useMemo(() => sortRecords(applyFilters(pool, quickFilters), state.sort, config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, config, JSON.stringify(quickFilters), state.sort]);
  // Закрытые (S4-27): на доске статусы — колонки, поэтому «внизу» там = «все».
  const closedMode = showClosedOf(state, config);
  const split = useMemo(
    () => splitClosed(sortedAll, view === 'board' && closedMode === 'below' ? 'all' : closedMode, config, data.meta.generated_at),
    [sortedAll, view, closedMode, config, data.meta.generated_at],
  );
  const filtered = useMemo(() => [...split.open, ...split.closed], [split]);
  const iconOf = (key: string, v: string): ValueIcon | null | undefined => {
    const own = valueIcon?.(key, v);
    if (own !== undefined) return own;
    if (key === 'status') {
      const s = labels.statuses.get(v);
      return s ? { icon: s.icon, color: s.color } : null;
    }
    if (key === 'kind') {
      const k = config.kinds[v];
      return k ? { icon: k.icon } : null;
    }
    return null;
  };
  const edgeCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data.edges) {
      m.set(e.from, (m.get(e.from) ?? 0) + 1);
      if (e.to !== e.from) m.set(e.to, (m.get(e.to) ?? 0) + 1);
    }
    return m;
  }, [data.edges]);

  // Общая группировка (S4-06): один ключ lg — группы списка и дорожки доски.
  const groupKey = parseGroupKey(state.group).type === 'none' ? null : state.group;
  // Подгруппа (S4-26): только в списке, только при группе и не равная ей.
  const subKey = view === 'list' && groupKey && state.group2 && state.group2 !== groupKey && parseGroupKey(state.group2).type !== 'none' ? state.group2 : null;
  const lanes = view === 'board' ? boardLanes(filtered, groupKey, config, data, budget) : [];
  // «Закрытые N» — одна группа в конце списка, а не внутри статусов или полей.
  const closedGroup: ListGroup | null = view === 'list' && split.closed.length > 0 ? { key: CLOSED_KEY, records: split.closed } : null;
  const laned = view === 'board' && groupKey !== null && groupKey !== 'status';
  const groups: ListGroup[] = view === 'board'
    ? lanes.map(l => l.lane)
    : [...groupBy(split.open, groupKey, config, data, budget), ...(closedGroup ? [closedGroup] : [])];
  const multi = (view === 'list' || laned) && groupKey ? multiGroupCount(groups) : 0;
  const collapsedByDefault = (view === 'list' || laned) && groups.some(g => g.other);
  const cur = ui.by === groupKey && ui.view === view ? ui : { by: groupKey, view, open: {}, more: {} };
  const isOpen = (k: string) => cur.open[k] ?? (k === CLOSED_KEY ? false : !collapsedByDefault);
  const limitOf = (k: string) => cur.more[k] ?? budget.perGroup;
  const toggleGroup = (k: string) => setUi({ ...cur, open: { ...cur.open, [k]: !isOpen(k) } });
  const showMore = (k: string) => setUi({ ...cur, more: { ...cur.more, [k]: limitOf(k) + budget.perGroup } });

  // Выбранное — только среди показанного: фильтр спрятал запись — действие её не тронет.
  // Свёрнутая группа «Закрытые N» (S4-27) тоже не показана: её строки не выбираются «всем списком».
  const pickable = closedGroup && !isOpen(CLOSED_KEY) ? split.open : filtered;
  const selIds = visibleSelection(selected, pickable);
  const selKey = selIds.join('\u0000');
  useEffect(() => { onSelectionChange?.(selKey ? selKey.split('\u0000') : []); }, [selKey, onSelectionChange]);
  const toggleSel = (id: string) => { setBulkError(null); setSelected(prev => toggleId(prev, id)); };
  const allShownSelected = pickable.length > 0 && selIds.length === pickable.length;
  const toggleAll = () => { setBulkError(null); setSelected(prev => selectAllShown(prev, pickable)); };
  const selectable = columns.includes('select');
  const selecting = mode || selIds.length > 0;
  const exitSelection = () => { setMode(false); setSelected(new Set()); setBulkError(null); };
  const longPress = useLongPress(id => {
    setMode(true);
    setBulkError(null);
    setSelected(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  });
  // В режиме выбора касание строки переключает её, а ссылка заголовка не уводит.
  const onRecordClick = (e: ReactMouseEvent, id: string) => {
    if (!selecting) return;
    if ((e.target as Element).closest('input, label, button, select, textarea')) return;
    e.preventDefault();
    toggleSel(id);
  };

  // S4-11: курсор — по видимым строкам в порядке экрана (свёрнутые группы и
  // хвост за «ещё N» не в счёт). Один таб-стоп: курсорная строка 0, прочие −1.
  const visibleIds: string[] = [];
  for (const g of groups) {
    if (view === 'list' && groupKey !== null && !isOpen(g.key)) continue;
    for (const r of g.records.slice(0, limitOf(g.key))) visibleIds.push(r.id);
  }
  const cursorId = cursor !== null && visibleIds.includes(cursor) ? cursor : (visibleIds[0] ?? null);
  const focusRow = (id: string) => {
    setCursor(id);
    const el = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-record-id]') ?? [])]
      .find(n => n.dataset.recordId === id);
    el?.focus();
  };
  const rowProps = (r: KitRecord) => ({
    tabIndex: r.id === cursorId ? 0 : -1,
    'data-cursor': r.id === cursorId ? 'true' : undefined,
    onFocus: () => { if (cursor !== r.id) setCursor(r.id); },
  });
  const keyHint = (spec: string) => <Kbd keys={kbdKeys(spec, { mac })} />;

  const onListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (isTypingTarget(target)) return;
    // Esc — выход из режима выбора (S4-10) и снятие выделения (S4-11).
    if (matchHotkey(e, 'Escape') || e.key === 'Escape') {
      if (!selecting) return;
      e.preventDefault();
      e.stopPropagation();
      exitSelection();
      return;
    }
    const bulk = selIds.length > 0 ? findAction(bulkActions ?? [], e) : undefined;
    if (bulk) {
      e.preventDefault();
      runBulk(bulk);
      return;
    }
    const rowEl = target.closest<HTMLElement>('[data-record-id]');
    const id = rowEl && rootRef.current?.contains(rowEl) ? rowEl.dataset.recordId ?? null : null;
    if (id === null) return;
    const at = visibleIds.indexOf(id);
    const move = (to: number) => {
      e.preventDefault();
      const next = visibleIds[Math.max(0, Math.min(visibleIds.length - 1, to))];
      if (next !== undefined) focusRow(next);
    };
    if (matchHotkey(e, 'ArrowDown') || matchHotkey(e, 'J')) return move(at + 1);
    if (matchHotkey(e, 'ArrowUp') || matchHotkey(e, 'K')) return move(at - 1);
    if (matchHotkey(e, 'Home')) return move(0);
    if (matchHotkey(e, 'End')) return move(visibleIds.length - 1);
    if (matchHotkey(e, 'Enter')) {
      // Enter на ссылке/кнопке внутри строки — их собственное действие.
      if (target !== rowEl) return;
      e.preventDefault();
      if (onOpen) onOpen(id);
      else rowEl.querySelector<HTMLElement>('a.sk-list__title')?.click();
      return;
    }
    if (matchHotkey(e, 'X')) {
      if (!selectable) return;
      e.preventDefault();
      toggleSel(id);
      return;
    }
    const act = findAction(rowActions ?? [], e);
    if (act) {
      e.preventDefault();
      act.run([id]);
    }
  };

  const rowActionsCell = (r: KitRecord) => (
    <span className="sk-list__actions">
      {rowActions?.map(a => (
        <span key={a.id} className="sk-list__action">
          <IconButton
            icon={a.icon}
            label={a.title}
            shortcut={a.hotkey ? ariaKeyshortcuts(a.hotkey) : undefined}
            onClick={() => a.run([r.id])}
          />
          {a.hotkey && keyHint(a.hotkey)}
        </span>
      ))}
    </span>
  );

  const runBulk = (a: ListBulkAction) => {
    if (busy !== null || selIds.length === 0) return;
    setBulkError(null);
    const fail = (err: unknown) => setBulkError({ title: a.title, reason: describeError(err) });
    let res: void | Promise<unknown>;
    try {
      res = a.run([...selIds]);
    } catch (err) {
      fail(err);
      return;
    }
    if (res && typeof res.then === 'function') {
      setBusy(a.id);
      res.then(() => setBusy(null), (err: unknown) => { setBusy(null); fail(err); });
    }
  };

  const groupTitle = (g: ListGroup): string => (g.key === CLOSED_KEY ? t('kit.list.closed.group') : groupTitleOf(config, lang, groupKey, g));

  const errors = (data.meta.errors ?? []).filter(e => e.block === 'records' || e.block === 'list');
  const shown = shownOf(data.meta, records.length, filtered.length);
  const shownText = shown.kind === 'complete'
    ? t('kit.list.shown', { shown: shown.shown, total: shown.total })
    : shown.kind === 'truncated'
      ? t('kit.list.shownTruncated', { shown: shown.shown, total: shown.total, loaded: shown.loaded })
      : t('kit.list.shownUnknown', { shown: shown.shown, loaded: shown.loaded });

  const hasFilter = Object.keys(filterSet.fields).length > 0 || !!filterSet.text || activeQuick !== null;
  const opTitles = Object.fromEntries((['any', 'not', 'empty', 'nonempty'] as FilterOp[])
    .map(op => [op, t(`kit.list.op.${op}` as KitKey)])) as Record<FilterOp, string>;
  // Строка-описание (S4-04): каждое условие — свой снимаемый чип, а не сплошной
  // текст: «что сейчас отсеивает записи» видно и снимается по одному. Условие
  // поля — с оператором (есть / нет / пусто / не пусто) и текстом (S4-05).
  const chips: { id: string; text: string; remove: () => void }[] = [];
  for (const [k, fl] of Object.entries(filterSet.fields)) {
    chips.push({
      id: `f:${k}`,
      text: `${labels.keyTitle(k)}: ${describeFieldFilter(fl, opTitles, v => labels.valueTitle(k, v))}`,
      remove: () => {
        const filters = { ...state.filters };
        const ops = { ...state.ops };
        delete filters[k];
        delete ops[k];
        update({ filters, ops });
      },
    });
  }
  if (filterSet.text) {
    chips.push({ id: 't', text: `${t('kit.list.desc.text')}: «${filterSet.text}»`, remove: () => update({ text: '' }) });
  }
  if (activeQuick) {
    chips.push({ id: 'q', text: `${t('kit.list.quick')}: ${activeQuick.title}`, remove: () => update({ quick: null }) });
  }
  const resetFilters = () => update({ filters: {}, ops: {}, text: '', quick: null });
  // «Вид ⌄» (S4-27): режим закрытых — часть состояния списка и сохранённого вида.
  const viewMenu = (
    <ViewMenu
      closed={closedMode}
      modes={SHOW_CLOSED_MODES}
      onClosed={c => update({ closed: c })}
    />
  );
  // Виды (S4-22/S4-23): в строке заголовка, если есть шапка, иначе — первыми в полосе фильтров.
  const viewsSwitch = views.length > 1 ? (
    <div role="radiogroup" aria-label={t('kit.list.views')} className="sk-list__views">
      {views.map(v => {
        const icon = viewIcons?.[v];
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={view === v}
            className={`sk-list__view${view === v ? ' is-on' : ''}`}
            onClick={() => update({ view: v })}
          >
            {icon && <GameIcon slug={icon} size={14} />}
            <span>{t(`kit.list.view.${v}` as KitKey)}</span>
          </button>
        );
      })}
    </div>
  ) : null;
  const filterCount = Object.keys(filterSet.fields).length + (filterSet.text ? 1 : 0);
  const segCount = (n: number) => (n > 0
    ? <span className="sk-list__segcount" data-testid="kit-list-segcount" title={t('kit.list.segActive', { n })}>{n}</span>
    : null);
  const sortKeys = sortKeysOf(config);
  if (state.sort && !sortKeys.includes(state.sort.key)) sortKeys.push(state.sort.key);

  const statusOrder = new Map(config.statuses.items.map((s, i) => [s.code, i]));
  const statusCompare = (a: string, b: string) => (statusOrder.get(a) ?? Infinity) - (statusOrder.get(b) ?? Infinity) || a.localeCompare(b);
  const fieldFilterOf = (k: string): FieldFilter => ({ op: state.ops[k] ?? 'any', values: state.filters[k] ?? [] });
  const setFieldFilter = (k: string, f: FieldFilter) => {
    const filters = { ...state.filters };
    const ops = { ...state.ops };
    if (f.values.length) filters[k] = f.values; else delete filters[k];
    if (f.op !== 'any') ops[k] = f.op; else delete ops[k];
    update({ filters, ops });
  };
  const valueCell = (key: string, r: KitRecord): ReactNode => {
    const vs = valuesOf(r, key);
    if (!vs.length) return '—';
    return (
      <span className="sk-list__vals">
        {vs.map(v => (
          <span key={v} className="sk-list__val"><ValueIconMark icon={iconOf(key, v)} />{labels.valueTitle(key, v)}</span>
        ))}
      </span>
    );
  };

  const checkbox = (r: KitRecord) => (
    <label className="sk-list__check">
      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} aria-label={t('kit.list.select', { title: r.title })} aria-keyshortcuts="X" />
    </label>
  );

  const cell = (col: string, r: KitRecord): ReactNode => {
    switch (col) {
      case 'select': return checkbox(r);
      case 'title+id': return <><Title r={r} href={href} onOpen={onOpen} /> <Pill variant="id">{r.id}</Pill></>;
      case 'title': return <Title r={r} href={href} onOpen={onOpen} />;
      case 'id': return <Pill variant="id">{r.id}</Pill>;
      case 'status': return <StatusCell code={r.status} labels={labels} />;
      case 'kind': return labels.valueTitle('kind', r.kind);
      case 'verdict': return <VerdictCell r={r} ctx={ctx} lang={lang} />;
      case 'updated_at': return r.updated_at ? <span className="sk-list__mono">{r.updated_at.slice(0, 10)}</span> : '—';
      case 'edges_count': return <span className="sk-list__mono">{edgeCount.get(r.id) ?? 0}</span>;
      case 'actions': return rowActionsCell(r);
      default:
        if (col.startsWith('progress:')) return <ProgressCell value={fieldValue(r, col.slice(9))} />;
        return valueCell(col, r);
    }
  };
  const colTitle = (col: string): ReactNode => {
    switch (col) {
      case 'select': return (
        <label className="sk-list__check">
          <input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label={t('kit.list.selectAll', { n: pickable.length })} />
        </label>
      );
      case 'title+id': return t('kit.list.col.title');
      case 'verdict': return t('kit.list.col.verdict');
      case 'edges_count': return t('kit.list.col.edges');
      case 'actions': return t('kit.list.col.actions');
      default: return labels.keyTitle(col.startsWith('progress:') ? col.slice(9) : col);
    }
  };

  const moreButton = (g: ListGroup, limit: number, key: string = g.key) => {
    const rest = g.records.length - limit;
    return rest > 0
      ? <button type="button" className="sk-btn" onClick={() => showMore(key)}>{t('kit.list.more', { n: rest })}</button>
      : null;
  };

  let body: ReactNode;
  if (records.length === 0 && shown.kind === 'complete') {
    body = <EmptyState />;
  } else if (filtered.length === 0 && records.length > 0) {
    body = (
      <EmptyState
        title={t('kit.list.emptyFiltered')}
        hint={t('kit.list.emptyFilteredHint')}
        action={hasFilter ? <button type="button" className="sk-btn" onClick={resetFilters}>{t('kit.list.reset')}</button> : undefined}
      />
    );
  } else if (view === 'board') {
    // В дорожке имя колонки несёт имя дорожки — иначе «готово: 1» в каждой
    // дорожке даёт одинаковые landmark-и (axe landmark-unique).
    const columnsOf = (cols: ListGroup[], lane: ListGroup | null, heading: 'h3' | 'h4') => (
      <div className="sk-board">
        {cols.map(g => {
          const mk = lane === null ? g.key : `${lane.key}\u0001${g.key}`;
          const limit = limitOf(mk);
          const Head = heading;
          const s = labels.statuses.get(g.key);
          const title = labels.valueTitle('status', g.key);
          const name = lane === null ? title : `${groupTitle(lane)} · ${title}`;
          return (
            <section
              key={g.key}
              className={`sk-board__col${g.unknown ? ' is-unknown' : ''}`}
              aria-label={t('kit.list.column', { title: name, n: g.records.length })}
              data-status={g.key}
              style={{ '--st-c': s?.color ?? 'var(--t3)' } as CSSProperties}
            >
              <Head className="sk-board__head">
                <GameIcon slug={s?.icon ?? 'help'} size={14} />
                <span className="sk-board__title">{title}</span>
                <span className="sk-board__count">{g.records.length}</span>
              </Head>
              <ul className="sk-board__cards">
                {g.records.slice(0, limit).map(r => (
                  <li key={r.id} className={`sk-board__card${selected.has(r.id) ? ' is-selected' : ''}`} data-record-id={r.id} {...rowProps(r)} onClick={e => onRecordClick(e, r.id)}>
                    {selectable && checkbox(r)}
                    <span className="sk-board__body">
                      <Title r={r} href={href} onOpen={onOpen} />
                      <Pill variant="id">{r.id}</Pill>
                      {columns.includes('verdict') && <VerdictCell r={r} ctx={ctx} lang={lang} />}
                    </span>
                    {rowActions?.length ? rowActionsCell(r) : null}
                  </li>
                ))}
              </ul>
              {moreButton(g, limit, mk)}
            </section>
          );
        })}
      </div>
    );
    body = laned
      ? (
        <div className="sk-board__lanes">
          {lanes.map(({ lane, columns: cols }) => {
            const open = isOpen(lane.key);
            const title = groupTitle(lane);
            return (
              <section
                key={lane.key}
                className="sk-board__lane"
                data-lane-key={lane.key}
                data-other={lane.other ? 'true' : undefined}
                aria-label={t('kit.list.lane', { title, n: lane.records.length })}
              >
                <h3 className="sk-board__lanehead">
                  <button type="button" className="sk-list__gbtn" aria-expanded={open} onClick={() => toggleGroup(lane.key)}>
                    <span className="sk-list__chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                    <span className={lane.missing || lane.none ? 'sk-list__gtitle is-unknown' : 'sk-list__gtitle'}>{title}</span>
                    <span className="sk-list__gcount">{lane.records.length}</span>
                  </button>
                </h3>
                {open && columnsOf(cols, lane, 'h4')}
              </section>
            );
          })}
        </div>
      )
      : columnsOf(lanes[0]?.columns ?? [], null, 'h3');
  } else {
    const grouped = groupKey !== null;
    const span = columns.length + (expand ? 1 : 0);
    const xid = (id: string) => `sk-lx-${id.replace(/[^\w-]/g, '_')}`;
    const expandCell = (r: KitRecord) => {
      if (!expand) return null;
      if (expand.can && !expand.can(r)) return <td className="sk-list__td sk-list__xcell" />;
      const open = expanded.has(r.id);
      return (
        <td className="sk-list__td sk-list__xcell">
          <button
            type="button"
            className="sk-list__xbtn"
            aria-expanded={open}
            aria-controls={open ? xid(r.id) : undefined}
            aria-label={t(open ? 'kit.list.collapse' : 'kit.list.expand', { title: r.title })}
            onClick={() => toggleExpand(r.id)}
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
        </td>
      );
    };
    const expandRow = (r: KitRecord) => {
      if (!expand || !expanded.has(r.id) || (expand.can && !expand.can(r))) return null;
      return (
        <tr className="sk-list__xrow" data-expand-of={r.id}>
          <td colSpan={span} id={xid(r.id)} className="sk-list__xbody">{expand.render(r)}</td>
        </tr>
      );
    };
    const rowsOf = (rs: KitRecord[]) => rs.map(r => (
      <Fragment key={r.id}>
                    <tr
                      className={`sk-list__row${selected.has(r.id) ? ' is-selected' : ''}`}
                      data-record-id={r.id}
                      aria-selected={selectable ? selected.has(r.id) : undefined}
                      {...rowProps(r)}
                      onClick={e => onRecordClick(e, r.id)}
                    >
                      {expandCell(r)}
                      {columns.map(c => <td key={c} className={`sk-list__td sk-list__c-${c.replace(/[^a-z0-9]+/g, '-')}`}>{cell(c, r)}</td>)}
                    </tr>
                    {expandRow(r)}
                  </Fragment>
    ));
    body = (
      <div className="sk-list__scroll">
        <table className="sk-list__table">
          <thead>
            <tr>{expand && <th scope="col" className="sk-list__th sk-list__xcell"><span className="sk-sr">{t('kit.list.col.expand')}</span></th>}{columns.map(c => <th key={c} scope="col" className={`sk-list__th sk-list__c-${c.replace(/[^a-z0-9]+/g, '-')}`}>{colTitle(c)}</th>)}</tr>
          </thead>
          {groups.map(g => {
            const headed = grouped || g.key === CLOSED_KEY;
            const open = !headed || isOpen(g.key);
            const limit = limitOf(g.key);
            return (
              <tbody key={g.key}>
                {headed && (
                  <tr className="sk-list__ghead" data-group-key={g.key} data-other={g.other ? 'true' : undefined}>
                    <th colSpan={span} scope="rowgroup">
                      <button type="button" className="sk-list__gbtn" aria-expanded={open} onClick={() => toggleGroup(g.key)}>
                        <span className="sk-list__chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                        <span className={g.unknown || g.missing || g.none ? 'sk-list__gtitle is-unknown' : 'sk-list__gtitle'}>{groupTitle(g)}</span>
                        <span className="sk-list__gcount">{g.records.length}</span>
                      </button>
                    </th>
                  </tr>
                )}
                {open && (subKey && g.key !== CLOSED_KEY
                  // Подгруппа (S4-26): вторая ступень внутри группы — своя строка-заголовок со счётчиком.
                  ? groupBy(g.records, subKey, config, data, budget).map(sg => {
                    const k = g.key + '' + sg.key;
                    const sOpen = isOpen(k);
                    const sLimit = limitOf(k);
                    return (
                      <Fragment key={k}>
                        <tr className="sk-list__ghead sk-list__ghead--sub" data-subgroup-key={sg.key}>
                          <th colSpan={span} scope="rowgroup">
                            <button type="button" className="sk-list__gbtn" aria-expanded={sOpen} onClick={() => toggleGroup(k)}>
                              <span className="sk-list__chev" aria-hidden="true">{sOpen ? '▾' : '▸'}</span>
                              <span className={sg.unknown || sg.missing || sg.none ? 'sk-list__gtitle is-unknown' : 'sk-list__gtitle'}>{groupTitleOf(config, lang, subKey, sg)}</span>
                              <span className="sk-list__gcount">{sg.records.length}</span>
                            </button>
                          </th>
                        </tr>
                        {sOpen && rowsOf(sg.records.slice(0, sLimit))}
                        {sOpen && sg.records.length > sLimit && (
                          <tr className="sk-list__morerow"><td colSpan={span}>{moreButton(sg, sLimit, k)}</td></tr>
                        )}
                      </Fragment>
                    );
                  })
                  : (
                    <>
                      {rowsOf(g.records.slice(0, limit))}
                      {g.records.length > limit && (
                        <tr className="sk-list__morerow"><td colSpan={span}>{moreButton(g, limit)}</td></tr>
                      )}
                    </>
                  ))}
              </tbody>
            );
          })}
        </table>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={['sk-list', className].filter(Boolean).join(' ')}
      data-view={view}
      data-selecting={selecting ? 'true' : undefined}
      onKeyDown={onListKeyDown}
      {...longPress}
    >
      {/* Панель действий — на месте шапки: первой, на телефоне шапку заменяет (CSS, S4-10). */}
      {selecting && (
        <div className="sk-list__selbar" data-testid="kit-list-selbar" role="group" aria-label={t('kit.list.bulk')} aria-busy={busy !== null}>
          <span className="sk-list__selcount">{t('kit.list.selected', { n: selIds.length })}</span>
          <button type="button" className="sk-btn" onClick={toggleAll} disabled={pickable.length === 0}>
            {allShownSelected ? t('kit.list.clearSelection') : t('kit.list.selectAll', { n: pickable.length })}
          </button>
          {bulkActions?.map(a => (
            <button
              key={a.id}
              type="button"
              className="sk-btn"
              disabled={busy !== null || selIds.length === 0}
              aria-keyshortcuts={a.hotkey ? ariaKeyshortcuts(a.hotkey) : undefined}
              onClick={() => runBulk(a)}
            >
              {a.title}{a.hotkey && keyHint(a.hotkey)}
            </button>
          ))}
          {busy !== null && <span className="sk-list__selbusy">{t('kit.list.bulkRunning')}</span>}
          <button type="button" className="sk-btn sk-list__seldone" aria-keyshortcuts="Escape" onClick={exitSelection}>{t('kit.list.done')}{keyHint('Escape')}</button>
          {bulkError && (
            <p className="sk-list__selerr" role="alert">{t('kit.list.bulkFailed', { title: bulkError.title, reason: bulkError.reason })}</p>
          )}
        </div>
      )}

      {errors.map(e => (
        <LoadError key={e.block} compact title={t('kit.list.blockError', { block: e.block })} hint={e.reason} />
      ))}

      {head && <ScreenHead title={head.title} titleId={head.titleId} icon={head.icon} views={<>{viewsSwitch}{viewMenu}</>} actions={head.actions} />}

      {/* Одна полоса управления (S4-21/S4-23, правило S7A-12): [виды, если нет шапки]
          [Фильтр][Группировка][Порядок] · «Быстро» · «Показано N из M». Сегменты —
          fieldset+legend: имя сегмента не спорит с подписью внутри. В сегменте
          фильтра — поиск по тексту и фасеты полей (S4-05). */}
      <div role="group" aria-label={t('kit.list.filters')} className="sk-list__controls" data-testid="kit-list-controls">
        {!head && viewsSwitch}
        {!head && viewMenu}
        <fieldset className="sk-list__seg" data-seg="filter">
          <legend className="sk-list__seglabel">{t('kit.list.desc.filter')}</legend>
          <GameIcon slug={ICON_CANON.segFilter} size={14} className="sk-list__segicon" />
          {segCount(filterCount)}
          <input
            type="search"
            className="sk-list__search"
            aria-label={t('kit.list.text')}
            placeholder={t('kit.list.textPlaceholder')}
            value={state.text}
            onChange={e => update({ text: e.target.value })}
          />
          {filterKeys.map(k => (
            <FacetFilter
              key={k}
              title={labels.keyTitle(k)}
              filter={fieldFilterOf(k)}
              facet={facetOf(records, filterSet, k)}
              valueTitle={v => labels.valueTitle(k, v)}
              valueIcon={v => iconOf(k, v)}
              compare={k === 'status' ? statusCompare : undefined}
              onChange={fl => setFieldFilter(k, fl)}
              lang={lang}
            />
          ))}
        </fieldset>
        {(view === 'list' || view === 'board') && hasGroupings && (
          <fieldset className="sk-list__seg" data-seg="group">
          <legend className="sk-list__seglabel">{t('kit.list.group')}</legend>
          <GameIcon slug={ICON_CANON.segGroup} size={14} className="sk-list__segicon" />
          {segCount(groupKey ? 1 : 0)}
          <GroupMenu
            group={groupKey}
            sub={subKey}
            options={groupOpts}
            withSub={view === 'list'}
            keyTitle={labels.keyTitle}
            onGroup={g => update({ group: g, ...(g === null || g === state.group2 ? { group2: null } : {}) })}
            onSub={g => update({ group2: g })}
            bare
          />
          </fieldset>
        )}
        <fieldset className="sk-list__seg" data-seg="sort">
          <legend className="sk-list__seglabel">{t('kit.list.sort')}</legend>
          <GameIcon slug={ICON_CANON.segSort} size={14} className="sk-list__segicon" />
          {segCount(state.sort ? 1 : 0)}
          <SortMenu
            value={state.sort?.key ?? null}
            keys={sortKeys}
            keyTitle={labels.keyTitle}
            onChange={k => update({ sort: k ? { key: k, dir: state.sort?.dir ?? 'asc' } : null })}
          />
          <button
            type="button"
            className="sk-list__dir"
            aria-pressed={state.sort?.dir === 'desc'}
            disabled={!state.sort}
            onClick={() => state.sort && update({ sort: { ...state.sort, dir: state.sort.dir === 'desc' ? 'asc' : 'desc' } })}
          >
            {t('kit.list.sortDesc')}
          </button>
        </fieldset>
        {quick.length > 0 && (
          <div role="group" aria-label={t('kit.list.quick')} className="sk-list__quick">
            <span className="sk-list__label" aria-hidden="true">{t('kit.list.quick')}</span>
            {quick.map(q => {
              const icon = quickIcons?.[q.id] ?? quickIconOf(q, config);
              return (
                <Pill
                  key={q.id}
                  variant="filter"
                  pressed={state.quick === q.id}
                  onToggle={on => update({ quick: on ? q.id : null })}
                >
                  {icon && <span className="sk-list__qicon" data-quick-icon={icon}><GameIcon slug={icon} size={12} /></span>}
                  <span>{q.title}</span><span className="sk-list__qcount">{counts[q.id] ?? 0}</span>
                </Pill>
              );
            })}
          </div>
        )}
        {!selecting && (bulkActions?.length ?? 0) > 0 && (
          <button type="button" className="sk-list__dir sk-list__selmode" onClick={() => { setMode(true); setBulkError(null); }}>
            {t('kit.list.selectMode')}
          </button>
        )}
        <p className="sk-list__shown" data-testid="kit-list-shown" data-kind={shown.kind} role="status">{shownText}</p>
        {/* Скрытое — числом (S4-27): сколько закрытых убрал режим «скрыть» или «за 30 дней». */}
        {split.hidden > 0 && (
          <span className="sk-list__closedhidden" data-testid="kit-list-closed-hidden">{t('kit.list.closed.hidden', { n: split.hidden })}</span>
        )}
      </div>

      {/* Эхо условий — только когда есть что снять: каждое условие — снимаемый чип.
          Группировка и порядок видны в своих контролах и текстом не дублируются. */}
      {chips.length > 0 && (
      <div className="sk-list__desc" data-testid="kit-list-desc">
        <span className="sk-list__desclabel">{t('kit.list.desc.filter')}:</span>
        {chips.map(c => (
          <Pill
            key={c.id}
            variant="filter"
            pressed
            onToggle={on => { if (!on) c.remove(); }}
            onRemove={c.remove}
            removeLabel={t('kit.list.removeChip', { what: c.text })}
          >
            {c.text}
          </Pill>
        ))}
        <button type="button" className="sk-btn" onClick={resetFilters}>{t('kit.list.reset')}</button>
      </div>
      )}
      {multi > 0 && <p className="sk-list__multi" data-testid="kit-list-multi">{t('kit.list.multi', { n: multi })}</p>}

      {body}
    </div>
  );
}
