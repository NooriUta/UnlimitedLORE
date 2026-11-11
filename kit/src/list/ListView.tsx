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
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { KitConfig, KitCtx, KitData, KitFilter, KitRecord, KitVerdict } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { IconButton } from '../elements/IconButton';
import { Kbd } from '../elements/Kbd';
import { Pill } from '../elements/Pill';
import {
  LIST_RESERVED_KEYS, ariaKeyshortcuts, assertKeymap, findAction, isMacPlatform, kbdKeys,
} from '../keyboard/keymap';
import { matchHotkey } from '../resilience/hotkeys';
import { kitPlural, kitT, useKitLang } from '../i18n';
import type { KitKey, KitLang } from '../i18n';
import { describeError } from '../resilience/errorText';
import { isEditableTarget } from '../resilience/editable';
import { pushUrlState, readUrlState } from '../resilience/urlState';
import { chipLabel, isChipList, toChips } from '../core/chipValue';
import { foldBody, type FeedBody } from './feedBody';
import { foldUnder, type FeedUnder, type FeedUnderFold } from './feedUnder';
import { GluedBlock } from '../record/GluedBlock';
import type { UrlWindow } from '../resilience/urlState';
import { EmptyState, LoadError } from '../states/StateViews';
// Узкий экран — один порог на весь kit (core, а не оболочка: список не должен
// тянуть за собой меню ради одного хука).
import { useNarrow } from '../core/narrow';
import { ProgressCell } from './progress';
import { SumCell, colKey } from './sum';
import {
  CHIPS_INLINE, CHIPS_INLINE_NARROW, DEFAULT_LIST_STATE, LIST_BUDGET, applyFilters, fieldValue,
  quickCounts, quickIconOf, quickColorOf, readListState, shownOf, sortKeysOf, sortRecords, valueKey, valuesOf, writeListState,
  SHOW_CLOSED_MODES, showClosedOf, splitClosed,
} from './listModel';
import type { FilterOp, ListGroup, ListState, ListViewKind, QuickItem } from './listModel';
import { boardLanes, capGroups, groupBy, groupingOptions, multiGroupCount, parseGroupKey } from './grouping';
import { FIND_FROM as GROUP_FIND_FROM } from './FacetFilter';
import { fieldValueTitle, groupKeyTitle, groupTitle as groupTitleOf } from './groupLabel';
import { applyFilterSet, describeFieldFilter, facetOf, toFilterSet } from './filterModel';
import type { FieldFilter } from './filterModel';
// Счётчики по всей выдаче (S9-01): правила, когда верить числам источника.
import { axisSource, countsNotes, facetFromAxis, quickSource } from './listCounts';
import type { ListCounts } from './listCounts';
import { FacetFilter, ValueIconMark } from './FacetFilter';
import type { ValueIcon } from './FacetFilter';
import { selectAllShown, toggleId, visibleSelection } from './listSelection';
import { useLongPress } from './useLongPress';
import { ScreenHead } from './ScreenHead';
import { ViewMenu } from './ViewMenu';
import { GroupMenu } from './GroupMenu';
import { SortMenu } from './SortMenu';
import { TimelineLanes } from '../views/timeline';
import { TreeView } from '../views/tree';
import type { RecordPlacement } from '../record/RecordDock';
import { MIN_COL_W, clampWidth, readWidths, widthsFor, writeWidths, type ColumnWidths, type WidthStore } from './columnWidths';
import { columnsFromUrl, columnsToUrlValue } from './columnsUrl';
import { kitDay, kitMinute } from '../core/fmtValue';
// Лента — ВИД того же источника (K2-FEED-VIEW): ведра времени, порядок и
// провалы источника строками. Фильтрация и группировка по полю здесь не
// повторяются — лента берёт то же `filtered` и ту же `groupBy`.
import {
  FEED_GAPS, FEED_UNDATED, FEED_UNREAD, feedByGroups, feedByTime, feedGaps, feedOrder, feedTime,
} from './feedModel';
import type { FeedGroup, FeedRow } from './feedModel';

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
  /**
   * Где открывается паспорт записи (владелица 08.11): настройка использования, живёт в «Вид»
   * списка, а не полосой над паспортом. Без неё раздела в «Вид» нет — место задаёт приложение.
   */
  recordPlace?: { value: RecordPlacement; onChange: (p: RecordPlacement) => void };
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
  /**
   * Бюджет показа (строк в группе, групп в списке, групп в топе) — числами.
   *
   * Было `Partial<typeof LIST_BUDGET>`, а LIST_BUDGET объявлен `as const`: тип
   * допускал ровно 50/20/10, то есть настройка принимала только своё же
   * умолчание и ничего не настраивала. Поймано тестом выбора в группах, где
   * понадобился маленький бюджет, чтобы хвост «ещё N» вообще появился.
   */
  budget?: Partial<Record<keyof typeof LIST_BUDGET, number>>;
  /**
   * Свои иконки «Быстро» (id → слаг game-icons). Без них «Быстро» по одному
   * статусу берёт иконку статуса из словаря (S4-04), прочие — без иконки.
   */
  quickIcons?: Record<string, string>;
  /**
   * Счётчики, посчитанные ИСТОЧНИКОМ по всей выдаче (S9-01) — данными, как и
   * записи: в сеть список не ходит (K-14), числа ему передаёт приложение.
   *
   * Без них счётчики считаются по `data.records`, то есть по загруженной
   * странице, и рядом с «Показано 1000 из 4000» это читается как число по всей
   * выдаче. С ними каждое число подписано, откуда оно, а «не посчитали»
   * остаётся «не посчитали» — не нулём.
   */
  counts?: ListCounts;
  /**
   * Иконка значения поля в фасетах и ячейках (S4-05). undefined — по умолчанию
   * (статус и вид — из конфига), null — без иконки. Подпись остаётся всегда.
   */
  valueIcon?: (key: string, value: string) => ValueIcon | null | undefined;
  /**
   * Значения оси, которые приложение держит под рукой (S9-03): они встают в
   * фасете отдельным блоком «Закреплённые» сразу под выбранными.
   *
   * Функция, а не список: у каждой оси набор свой, и ЧЕМ он определяется —
   * знание приложения, а не kit (K-14). Не задана — блока нет, поведение
   * прежнее: показывать пустой блок «Закреплённые» было бы обещанием без
   * содержания.
   */
  facetPinned?: (key: string) => readonly string[];
  /**
   * Тело записи для ленты (K2-FEED-BODY-MORE): начало, остаток и его состояние —
   * НАЗЫВАЕТ приложение. Решение владелицы 10.11.2026: «грузить первые 3 абзаца
   * остально при расеррытии», то есть остаток не спрятан, а запрашивается.
   *
   * Не задано — лента остаётся строкой: тело выдумывать не из чего. Вернуло
   * null у записи — у этой записи тела нет, и блока тела нет тоже (пустая
   * рамка обещала бы текст).
   */
  feedBody?: (r: KitRecord) => FeedBody | null;
  /**
   * Запросить остаток тела. Нет обработчика — «Ещё» при НЕзагруженном остатке
   * не предлагается вовсе: кнопка, обещающая действие, которого нет, хуже её
   * отсутствия (то же правило, что у применения в DiffPreview).
   */
  onFeedBody?: (id: string) => void;
  /**
   * Нижний уровень двухуровневой ленты (K2-FEED-TWO-LEVEL): состояние —
   * НАЗЫВАЕТ приложение (`feedUnder.ts`, пять исходов).
   *
   * Вернуло null — запись не верхнего уровня, полосы с числами и раскрытия у
   * неё нет. Не задано — двух уровней нет вовсе: раскрывать нечего, а кнопка,
   * обещающая действие, которого нет, хуже её отсутствия.
   *
   * ЧТО такое верхний и нижний уровень, kit не знает (K-14): верхний — тот, у
   * кого приложение вернуло состояние, подпись нижнего — `list.feed.under.title`.
   */
  feedUnder?: (r: KitRecord) => FeedUnder | null;
  /**
   * Запросить нижний уровень. Решение владелицы 10.11.2026 — грузить ПРИ
   * РАСКРЫТИИ: сразу это по запросу на каждую полосу экрана. Нет обработчика —
   * «Ещё» при незагруженном нижнем уровне не предлагается.
   */
  onFeedUnder?: (id: string) => void;
  /** Раскрытие строки с вложенным содержимым (только вид «Список»). */
  expand?: ListExpand;
  /**
   * Шапка экрана (S4-22, S4-23): задана — список сам рисует ScreenHead с
   * заголовком, а виды переезжают в её строку. Нет — виды остаются в полосе фильтров.
   */
  head?: ListHead;
  /** Иконки видов (вид → слаг game-icons). Задаёт приложение: иконки — из канона LORE v1 (S4-25). */
  viewIcons?: Partial<Record<ListViewKind, string>>;
  /**
   * Личная ширина колонок (S4-35, «ширина личная, набор командный»). Задано —
   * у заголовков появляются ручки, ширина живёт в личном хранилище и НЕ идёт в
   * адрес: ссылкой делятся, а ширина своя. Не задано — ручек нет: показывать
   * то, чем нельзя управлять, незачем.
   */
  widths?: {
    /** Ключ раздела в хранилище: у списка задач и списка ADR ширины свои. */
    screen: string;
    /** Хранилище; нет — ширина живёт до перезагрузки (приватный режим). */
    store?: WidthStore;
    /** Телефон: ширины не применяются вовсе — там карточки. */
    narrow?: boolean;
  };
  /**
   * Узкий экран (телефон). Не задан — спрашивается сам, одним порогом kit
   * (`useNarrow`, ≤720px).
   *
   * Нужен не для вида, а для ПОРОГОВ, которые иначе врут: строка условий на
   * 393 px держала три чипа и уезжала за край вместе с «+N» (S9-12, находка
   * прода 09.11.2026). Задаётся прямо — для тестов и встройки, где matchMedia
   * нет или где ширину решает хозяин.
   */
  narrow?: boolean;
  className?: string;
}

/** Шапка экрана списка: заголовок, его id и иконка, первичное действие. */
export interface ListHead {
  title: ReactNode;
  titleId?: string;
  icon?: string;
  actions?: ReactNode;
}

/** Колонка, которую нельзя снять: список без названия записи нечитаем (S4-35). */
const COLS_LOCKED = 'title+id';

/**
 * Уровень строки ленты (K2-FEED-TWO-LEVEL). `flat` — обычная запись, `top` —
 * верхний уровень (у него полоса чисел и раскрытие), `under` — то, что в нём
 * двигалось. Признак, а не своя вёрстка: форма строки на обоих уровнях ОДНА.
 */
type FeedLevel = 'flat' | 'top' | 'under';

const VIEWS_RENDERED: ListViewKind[] = ['list', 'cards', 'board', 'tree', 'feed', 'timeline'];
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

/**
 * День в клетке списка. Пусто — «—»; отметку не разобрали — показываем КАК
 * ПРИСЛАЛИ и говорим об этом подсказкой. «Не разобрали» ≠ «пусто», и прятать
 * непонятное значение нельзя: именно по нему и находят кривые данные.
 */
function DayCell({ iso, badTitle }: { iso?: string | null; badTitle?: string }) {
  const d = kitDay(iso);
  if (!d) return <>—</>;
  return (
    <time className="sk-list__mono" dateTime={d.ok ? d.title : undefined} data-date={d.ok ? 'day' : 'raw'}
      title={d.ok || !badTitle ? d.title : `${d.title} — ${badTitle}`}>
      {d.text}
    </time>
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

/**
 * Минимальная ширина отдельных колонок (S4-35): «Запись» уже 220 px читается
 * хуже, чем вовсе без неё — название переносится в кашу. Остальным хватает
 * общего MIN_COL_W.
 */
const LIST_COL_MIN: Readonly<Record<string, number>> = { 'title+id': 220, title: 220 };

export function ListView({
  config, data, href, ctx: ctxPart, bulkActions, rowActions, onOpen, recordPlace, onSelectionChange, urlState, initial, budget: budgetPart,
  quickIcons, valueIcon, facetPinned, feedBody, onFeedBody, feedUnder, onFeedUnder, expand, head, viewIcons, widths, narrow: narrowProp, className, state: stateProp, onStateChange,
  counts: serverCounts,
}: ListViewProps) {
  // Узкий экран — для порогов, а не для вида: один порог kit (useNarrow).
  const narrow = useNarrow(narrowProp);
  // Сколько условий остаётся в строке: на телефоне меньше — три чипа «Поле:
  // значение» на 393 px не влезают ни при каком шрифте (S9-12).
  const chipsInline = narrow ? CHIPS_INLINE_NARROW : CHIPS_INLINE;
  // Клавиша, которую не нажать однозначно, — ошибка конфигурации, а не тишина.
  assertKeymap([...(rowActions ?? []), ...(bulkActions ?? [])], LIST_RESERVED_KEYS);
  const mac = isMacPlatform();
  const rootRef = useRef<HTMLDivElement>(null);
  // Ширины колонок (S4-35). Читаются один раз: хранилище личное, и чужие
  // правки в нём по ходу жизни экрана нас не касаются.
  const [colW, setColW] = useState<ColumnWidths>(
    () => (widths?.store ? readWidths(widths.store, widths.screen) : {}),
  );
  // Телефон: личные ширины не применяются вовсе — там карточки. Флаг зоны
  // остаётся как перебивка, но по умолчанию список спрашивает ширину экрана
  // САМ: web-next его не передавал ни разу, и правило «на телефоне ширины не
  // применяются» существовало только в комментарии (S4-35, S9-12).
  const appliedW = widths ? widthsFor(colW, LIST_COL_MIN, widths.narrow ?? narrow) : {};
  /** Потянуть ширину: считаем от текущей ширины заголовка, а не от нуля. */
  const onGrip = (col: string) => (e: ReactPointerEvent<HTMLElement>) => {
    const th = (e.currentTarget as HTMLElement).closest('th');
    if (!th) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = appliedW[col] ?? th.getBoundingClientRect().width ?? MIN_COL_W;
    let last = startW;
    const move = (ev: PointerEvent) => {
      const next = clampWidth(col, startW + (ev.clientX - startX), LIST_COL_MIN);
      if (next === undefined) return;
      last = next;
      setColW(w => ({ ...w, [col]: next }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Пишем один раз по отпусканию, а не на каждое движение: хранилище —
      // не журнал перетаскивания.
      if (widths?.store) writeWidths(widths.store, widths.screen, { ...colW, [col]: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
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
  /**
   * Поиск по группам (S9-02) — состояние местное, не в адресе.
   *
   * Это средство найти нужную группу глазами, а не вид списка: им не делятся
   * ссылкой, и в адрес оно не идёт — там живёт то, что команда должна увидеть
   * так же. Так же сделан поиск по значениям внутри фасета.
   */
  const [groupFind, setGroupFind] = useState('');
  /** Раскрыта ли свёртка «+N» в строке условий (S9-12). Местное, не в адресе. */
  const [chipsOpen, setChipsOpen] = useState(false);
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
  /**
   * Поля ленты, НАЗВАННЫЕ приложением (K2-FEED-VIEW §2): по какому полю время,
   * какие поля несут суть, какие связи объясняют повод.
   */
  const feedCfg = listCfg?.feed;
  const views = (listCfg?.views ?? ['list'])
    .filter(v => VIEWS_RENDERED.includes(v))
    /*
      Допущение, принятое владелицей: лента — вид ВЕЗДЕ, где приложение назвало
      поле времени, и только там. Раздел без такого поля ленту не предлагает —
      иначе kit начал бы угадывать, какое поле записи главное (водораздел
      K-14), а в ленте такая догадка особенно дорога: порядок строк и есть её
      смысл.
    */
    .filter(v => v !== 'feed' || !!feedCfg?.timeField);
  const view: ListViewKind = views.includes(state.view) ? state.view : (views[0] ?? 'list');
  const quick = listCfg?.quick ?? [];
  const filterKeys = listCfg?.filters ?? [];
  const groupOpts = useMemo(() => groupingOptions(config), [config]);
  const hasGroupings = groupOpts.fields.length + groupOpts.relations.length > 0;
  /**
   * Имя колонки ТЕКСТОМ — для выбора колонок и подписей: у «выбрать все»
   * заголовок это галочка, и в список выбора такое не положишь.
   */
  const columnTitleText = (col: string): string => {
    if (col === 'title+id') return t('kit.list.col.title');
    if (col === 'verdict') return t('kit.list.col.verdict');
    if (col === 'edges_count') return t('kit.list.col.edges');
    if (col === 'actions') return t('kit.list.col.actions');
    return labels.keyTitle(colKey(col));
  };
  const configColumns = listCfg?.columns ?? ['title+id', 'status'];
  // Набор колонок — командный: живёт в адресе, им делятся ссылкой (S4-35,
  // решение владелицы 08.11). Незнакомый ключ из адреса отбрасывается, «Запись»
  // возвращается на место: список без названия записи нечитаем.
  const colsFromUrl = win ? columnsFromUrl(win.location.search, configColumns, COLS_LOCKED) : undefined;
  const [colsOwn, setColsOwn] = useState<string[] | undefined>(colsFromUrl);
  const chosenColumns = colsOwn ?? configColumns;
  const baseColumns = chosenColumns;
  const setColumns = (next: string[]) => {
    setColsOwn(next);
    if (win) pushUrlState({ cols: columnsToUrlValue(next) }, { replace: true, win: win });
  };
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
  const pageCounts = useMemo(() => quickCounts(pool, quick, []), [pool, quick]);
  /**
   * Чем выдача сужена СЕЙЧАС (S9-01). Источник считает ось по выдаче без
   * фильтра своей оси, но прочих условий мы ему не отправляли — значит его
   * числа годятся только пока выдачу не сузило что-то другое.
   */
  const narrowing = useMemo(
    () => ({ keys: Object.keys(filterSet.fields), text: (filterSet.text ?? '') !== '' }),
    [filterSet],
  );
  /**
   * Выдача не обрезана — «по загруженным строкам» и «по всей выдаче» это одно и
   * то же множество, и оговорка была бы ложной тревогой. Считается по meta, а
   * не по фильтру: фильтр сужает показанное, а не выдачу.
   */
  const wholeLoaded = shownOf(data.meta, records.length, records.length).kind === 'complete';
  /** Число «Быстро»: у источника — по всей выдаче, иначе по загруженной странице. */
  const quickCount = (q: QuickItem): { n: number | null; from: 'all' | 'page'; why?: string } => {
    const s = quickSource(serverCounts, q.filter, narrowing);
    if (s.from === 'all') return { n: s.count, from: 'all' };
    if (s.from === 'unknown') return { n: null, from: 'all', ...(s.reason === undefined ? {} : { why: s.reason }) };
    return { n: pageCounts[q.id] ?? 0, from: wholeLoaded ? 'all' : 'page' };
  };
  // «Быстро» с нулём не рисуем (аудит 10.11): «Без версии 0» — шум. Виден
  // ненулевой счётчик или включённый фильтр (его надо видеть, чтобы снять).
  // Непосчитанное (null) прячется НЕ: «не знаем» — не ноль, и чип без числа
  // человек всё равно должен видеть, чтобы им воспользоваться (S9-01).
  const visibleQuick = useMemo(
    () => quick.filter(q => {
      const c = quickCount(q);
      return c.n === null || c.n > 0 || state.quick === q.id;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quick, pageCounts, serverCounts, narrowing, state.quick],
  );
  /** Оговорки о полноте счёта — словами (S9-01). */
  const countsWords = useMemo(() => countsNotes(serverCounts).map(n => {
    switch (n.kind) {
      case 'unsupported': return t('kit.list.counts.unsupported');
      case 'forbidden': return t('kit.list.counts.forbidden');
      case 'failed': return n.reason ? t('kit.list.counts.failed', { reason: n.reason }) : t('kit.list.counts.failedNoReason');
      case 'cap': return t('kit.list.counts.cap', { limit: n.limit, parts: n.parts.join(', ') });
      case 'partial': return t('kit.list.counts.partial');
      case 'unknown': return t('kit.list.counts.unknown');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [serverCounts, lang]);
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
  // Поиск по группам (S9-02). Ищем по ВСЕМ группам, а не по показанным: нужный
  // релиз с большой долей вероятности лежит в «Прочих», и поиск по десяти
  // видимым был бы обманом. Поэтому при поиске бюджет снимается, найденное
  // фильтруется по названию и режется тем же правилом (`capGroups`).
  const find = groupFind.trim().toLocaleLowerCase();
  const rawGroups: ListGroup[] = view === 'board'
    ? lanes.map(l => l.lane)
    : groupBy(split.open, groupKey, config, data, find ? { ...budget, maxGroups: Number.MAX_SAFE_INTEGER } : budget);
  const matched = find
    ? rawGroups.filter(g => groupTitleOf(config, lang, groupKey, g).toLocaleLowerCase().includes(find))
    : rawGroups;
  const foundGroups = find ? capGroups(matched, budget) : rawGroups;
  const groups: ListGroup[] = view === 'board'
    ? foundGroups
    : [...foundGroups, ...(closedGroup ? [closedGroup] : [])];
  const multi = (view === 'list' || laned) && groupKey ? multiGroupCount(groups) : 0;
  /**
   * Из чего выбран топ (S9-02). «10 групп и „Прочие“» не говорят, сколько групп
   * было всего, а это и есть мера того, насколько список урезан. Число берётся
   * у самой выдачи, а не из данных: показанные группы плюс спрятанные в
   * «Прочих». При поиске это ровно число НАЙДЕННЫХ групп — топ там выбран из
   * них, и называть полное число было бы не про то, что на экране.
   */
  const otherGroup = foundGroups.find(g => g.other) ?? null;
  const shownGroups = foundGroups.length - (otherGroup ? 1 : 0);
  const groupTotal = shownGroups + (otherGroup?.groupCount ?? 0);
  /**
   * Свёрнуты ли группы при первом показе.
   *
   * Было: свёрнуто только когда появилась группа «Прочие». Пятнадцать релизов
   * порога не достигают, «Прочих» нет — и все пятнадцать стояли раскрытыми, то
   * есть та же стена строк, из которой S9-02 и выросла, только ниже.
   *
   * Теперь группировку можно назвать свёрнутой по умолчанию
   * (`list.collapsedGroupings`) — у LORE это релиз и спринт, где групп всегда
   * много. Имена живут в конфиге приложения, а не в kit: какие разрезы
   * «широкие», знает приложение.
   */
  const collapsedGroupings = listCfg?.collapsedGroupings ?? [];
  const collapsedByDefault = (view === 'list' || laned)
    && (groups.some(g => g.other) || (groupKey !== null && collapsedGroupings.includes(groupKey)));
  const cur = ui.by === groupKey && ui.view === view ? ui : { by: groupKey, view, open: {}, more: {} };
  const isOpen = (k: string) => cur.open[k] ?? (k === CLOSED_KEY ? false : !collapsedByDefault);
  const limitOf = (k: string) => cur.more[k] ?? budget.perGroup;
  const toggleGroup = (k: string) => setUi({ ...cur, open: { ...cur.open, [k]: !isOpen(k) } });
  const showMore = (k: string) => setUi({ ...cur, more: { ...cur.more, [k]: limitOf(k) + budget.perGroup } });

  /**
   * Провалы источника, которые лента показывает строками (§6). Считаются
   * всегда, когда вид — лента: от них зависит, можно ли вообще говорить
   * «пусто». Лента читается как поток событий, и пропуск в ней читается как
   * «ничего не было» — поэтому упавший блок обязан быть виден СТРОКОЙ, а не
   * только плашкой над лентой.
   */
  const gaps = view === 'feed' && feedCfg ? feedGaps(data.meta) : [];
  /**
   * Группы ленты.
   *
   * Источник тот же `filtered`, что у таблицы, — отсюда и берётся «без второй
   * реализации»: один и тот же фильтр обязан давать один и тот же НАБОР
   * записей в обоих видах. Группировка полем — та же общая `groupBy`; своей у
   * ленты нет. Умолчание — ведра времени, и только оно принадлежит ленте.
   *
   * Порядок: выбранный в строке управления главнее. Не выбран — свежие сверху
   * по названному полю времени, записи без отметки в конце.
   */
  const feedGroupsList: FeedGroup[] | null = view === 'feed' && feedCfg
    ? (groupKey !== null
      ? feedByGroups(groupBy(filtered, groupKey, config, data, budget), gaps, feedCfg.timeField)
      : feedByTime(
        state.sort ? filtered : feedOrder(filtered, feedCfg.timeField),
        gaps, feedCfg.timeField, data.meta.generated_at,
      ))
    : null;

  /*
    Двухуровневая лента (K2-FEED-TWO-LEVEL, просьба владелицы 09.11.2026:
    «раздели еще одну идею … дерево будет двух уровневая лента»).

    Включена, когда СОШЛИСЬ две вещи от приложения: подпись нижнего уровня в
    конфиге и его состояние пропсом. Одного мало по разным причинам: без
    подписи kit нарисовал бы «Ещё 7» неизвестно чего (водораздел K-14), без
    состояния кнопка обещала бы раскрытие, которому нечего показать.
  */
  const underCfg = feedCfg?.under;
  const twoLevel = !!feedGroupsList && !!underCfg && !!feedUnder;
  /**
   * Числа полосы верхнего уровня — ТЕ ЖЕ колонки `progress:`/`sum:`, что у
   * таблицы, и рисует их тот же `cell`. Не «так же», а ТЕМ ЖЕ путём: второй
   * счёт дал бы две правды о числах, и разошлись бы они первой же правкой.
   *
   * Колонок таких нет — полосы чисел нет: пустая полоса обещала бы числа,
   * которых приложение не назвало.
   */
  const stripCols = twoLevel ? columns.filter(c => c.startsWith('progress:') || c.startsWith('sum:')) : [];
  /**
   * Состояние нижнего уровня у записи. Вне двухуровневой ленты — нет вовсе, и
   * у строки нижнего уровня своего нижнего не бывает: уровней ровно два.
   */
  const underOf = (r: KitRecord, level: FeedLevel): FeedUnder | null =>
    (twoLevel && level !== 'under' ? feedUnder!(r) ?? null : null);
  /*
    Пришли по ссылке в РАСКРЫТУЮ запись, а нижний уровень ещё в источнике —
    просим его сами, один раз на запись.

    Без этого «раскрытие переживает перезагрузку» было бы неправдой: адрес
    говорит «раскрыто», а под полосой снова кнопка «Ещё». Отметку о запросе
    держим своей, а не выводим из состояния, нарочно: источник может ответить
    тем же «не загружено» (ещё едет, уже отказал), и по состоянию мы просили бы
    вечно.
  */
  const askedUnder = useRef<Set<string>>(new Set());
  const askUnder = useRef(onFeedUnder);
  askUnder.current = onFeedUnder;
  const underState = useRef(feedUnder);
  underState.current = feedUnder;
  useEffect(() => {
    if (!twoLevel || !askUnder.current) return;
    for (const id of expanded) {
      if (askedUnder.current.has(id)) continue;
      const r = records.find(x => x.id === id);
      if (!r) continue;
      const u = underState.current?.(r) ?? null;
      // Просим только то, чего ещё не присылали. Пришедшее, едущее, отказанное
      // и проверенный ноль запроса не требуют.
      if (!u || u.kind !== 'rest' || foldUnder(u, true).action.kind !== 'load') continue;
      askedUnder.current.add(id);
      askUnder.current(id);
    }
  }, [twoLevel, expanded, records]);

  /**
   * Что РЕАЛЬНО стоит на экране — то и есть набор, над которым действуют.
   *
   * Было: показанным считалось всё, что прошло фильтр (кроме свёрнутых
   * «Закрытых»). В группированном списке это неправда — свёрнутая группа и
   * хвост за «ещё N» на экране не стоят, а массовое действие их молча
   * забирало: отметил группу, свернул её, нажал действие — и оно тронуло то,
   * чего не видно. Теперь набор строится теми же правилами, которыми идёт
   * отрисовка, а отмеченное за пределами показанного называется числом
   * (kit.list.selHidden), а не теряется тихо.
   */
  const onScreenOf = (g: ListGroup): KitRecord[] => {
    // Заголовок (а значит, и сворачивание) есть в списке при группировке и у «Закрытых».
    const headed = view === 'list' && (groupKey !== null || g.key === CLOSED_KEY);
    if (headed && !isOpen(g.key)) return [];
    if (view === 'list' && subKey && g.key !== CLOSED_KEY) {
      // Вторая ступень (S4-26) сворачивается своим ключом — иначе строки
      // свёрнутой подгруппы считались бы показанными.
      const out: KitRecord[] = [];
      for (const sg of groupBy(g.records, subKey, config, data, budget)) {
        const k = g.key + '' + sg.key;
        if (!isOpen(k)) continue;
        out.push(...sg.records.slice(0, limitOf(k)));
      }
      return out;
    }
    return g.records.slice(0, limitOf(g.key));
  };
  const pickable: KitRecord[] = [];
  {
    // Запись, попавшая в несколько групп (разрезы по связям), на экране одна —
    // и в действие обязана уйти один раз, иначе «Выбрано: 2» про одну строку.
    const seen = new Set<string>();
    const put = (rs: readonly KitRecord[]) => {
      for (const r of rs) if (!seen.has(r.id)) { seen.add(r.id); pickable.push(r); }
    };
    if (feedGroupsList) {
      for (const g of feedGroupsList) {
        for (const row of g.rows.slice(0, limitOf(g.key))) if (row.kind === 'record') put([row.record]);
      }
    } else if (view === 'board') {
      for (const { lane, columns: cols } of lanes) {
        if (laned && !isOpen(lane.key)) continue;
        for (const c of cols) put(c.records.slice(0, limitOf(laned ? lane.key + '' + c.key : c.key)));
      }
    } else if (view === 'list') {
      for (const g of groups) put(onScreenOf(g));
    } else {
      // Карточки, дерево и таймлайн рисуют весь отфильтрованный набор.
      put(filtered);
    }
  }
  const selIds = visibleSelection(selected, pickable);
  const selKey = selIds.join('\u0000');
  useEffect(() => { onSelectionChange?.(selKey ? selKey.split('\u0000') : []); }, [selKey, onSelectionChange]);
  /**
   * Отмеченное за пределами показанного. Считаем по самим отметкам, а не по
   * причинам: спрятал фильтр, свёрнутая группа или хвост «ещё N» — человеку
   * важно одно, что часть его выбора в действие НЕ уйдёт.
   */
  const shownSel = new Set(selIds);
  const selHidden = [...selected].filter(id => !shownSel.has(id)).length;
  const toggleSel = (id: string) => { setBulkError(null); setSelected(prev => toggleId(prev, id)); };
  /**
   * Сколько отмечено в группе — по ВСЕМ её записям, включая скрытые. Если
   * считать только показанные, свёрнутая группа выглядела бы как «ничего не
   * выбрано», хотя выбор в ней есть и он помешает действию.
   */
  const groupSelCount = (g: ListGroup) => g.records.reduce((n, r) => (selected.has(r.id) ? n + 1 : n), 0);
  /** Отметить/снять всю группу одним движением. */
  const toggleGroupSel = (g: ListGroup) => {
    setBulkError(null);
    setSelected(prev => {
      const n = new Set(prev);
      const all = g.records.length > 0 && g.records.every(r => n.has(r.id));
      for (const r of g.records) { if (all) n.delete(r.id); else n.add(r.id); }
      return n;
    });
  };
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
  if (feedGroupsList) {
    // В ленте порядок экрана — её собственный, и курсор обязан идти по нему, а
    // не по группам таблицы: иначе ↑/↓ прыгали бы мимо строк.
    for (const g of feedGroupsList) {
      for (const row of g.rows.slice(0, limitOf(g.key))) if (row.kind === 'record') visibleIds.push(row.record.id);
    }
  } else {
    for (const g of groups) {
      if (view === 'list' && groupKey !== null && !isOpen(g.key)) continue;
      for (const r of g.records.slice(0, limitOf(g.key))) visibleIds.push(r.id);
    }
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

  /**
   * Плашки ошибок над списком. В ленте их НЕТ: там те же провалы стоят
   * строками в порядке времени (§6), и второй раз плашкой сверху они бы
   * спорили сами с собой — «не смогли проверить» дважды читается как два
   * разных провала.
   */
  const errors = feedGroupsList ? [] : (data.meta.errors ?? []).filter(e => e.block === 'records' || e.block === 'list');
  const shown = shownOf(data.meta, records.length, filtered.length);
  const shownText = shown.kind === 'complete'
    ? t('kit.list.shown', { shown: shown.shown, total: shown.total })
    : shown.kind === 'truncated'
      ? t('kit.list.shownTruncated', { shown: shown.shown, total: shown.total, loaded: shown.loaded })
      : t('kit.list.shownUnknown', { shown: shown.shown, loaded: shown.loaded });

  /**
   * Оговорка о потолке групп (S9-02): словами, а не только видом списка.
   *
   * Две разные вещи, и путать их нельзя:
   *   • потолок сработал — надо сказать, из скольких групп выбран топ, иначе
   *     «10 и „Прочие“» не говорят, что групп 142;
   *   • выдача обрезана сервером — тогда топ посчитан по ЗАГРУЖЕННЫМ строкам,
   *     и «десять самых больших» неправда: в полной выдаче порядок групп может
   *     быть другим. Это верно и когда групп мало: числа в группах всё равно по
   *     загруженному.
   * Группировки нет или сказать нечего — молчим: пустая оговорка хуже, чем её
   * отсутствие, потому что приучает её не читать.
   */
  const groupCapNote: string | null = groupKey === null ? null
    : otherGroup
      ? (shown.kind === 'complete'
        ? t('kit.list.groupCap', { top: shownGroups, total: groupTotal })
        : t('kit.list.groupCapPage', { top: shownGroups, total: groupTotal }))
      : (shown.kind === 'complete' ? null : t('kit.list.groupsPage'));

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
      place={recordPlace?.value}
      onPlace={recordPlace?.onChange}
      columns={{
        all: configColumns
          // «Выбрать все» и «Действия» — не колонки данных: они появляются от
          // режима выбора и прав, и выбором ими не управляют.
          .filter(c => c !== 'select' && c !== 'actions')
          .map(c => ({ key: c, title: columnTitleText(c), locked: c === COLS_LOCKED })),
        chosen: chosenColumns.filter(c => c !== 'select' && c !== 'actions'),
      }}
      onColumns={setColumns}
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
  // Тип поля «date» (и «datetime» модели, он приходит сюда тем же «date»)
  // печатался СЫРЫМ: в «Технологиях» в клетке стоял ISO с миллисекундами.
  // Движок знает тип поля из модели — значит и показывать день должен он, а не
  // каждый экран по-своему (ревью 10.11, UX-долг).
  /** Тип объявил поля, и этого среди них нет — колонка к записи не относится. */
  const notApplicable = (kind: string, key: string): boolean => {
    const declared = config.kinds[kind]?.fields;
    if (!declared) return false;
    const name = key.startsWith('fields.') ? key.slice(7) : key;
    return !declared.some(f => f.key === name);
  };
  /** Подпись поля по любому типу, который его объявил; не нашлась — ключ как есть. */
  const fieldTitleOf = (key: string): string => {
    const name = key.startsWith('fields.') ? key.slice(7) : key;
    for (const k of Object.values(config.kinds)) {
      const f = k.fields?.find(x => x.key === name);
      if (f?.title) return f.title;
    }
    return key;
  };
  const fieldType = (kind: string, key: string): string | undefined => {
    // Колонка приходит с приставкой («fields.start»), а в модели поле зовётся
    // без неё — как и в fieldValue (listModel.ts:54). Без снятия приставки тип
    // не находился, и поле-дата печаталось сырым.
    const name = key.startsWith('fields.') ? key.slice(7) : key;
    return config.kinds[kind]?.fields?.find(f => f.key === name)?.type;
  };

  /**
   * Подписи чипов ЭТОЙ записи: код → подпись (S4-29).
   *
   * Значения ключуются кодом (иначе один проект с двумя подписями дал бы два
   * значения в фасете), а на экран идёт подпись — она пришла от источника
   * вместе с кодом, и показывать вместо неё код значит прятать то, что уже
   * есть в данных.
   *
   * Карта строится по записи, а не на весь список: подпись принадлежит
   * значению В ЭТОЙ записи, и общая карта тихо подменяла бы её чужой.
   */
  const chipLabelsOf = (r: KitRecord, key: string): Map<string, string> => {
    const raw = fieldValue(r, key);
    const m = new Map<string, string>();
    if (!isChipList(raw)) return m;
    for (const c of toChips(raw)) if (!m.has(c.id)) m.set(c.id, chipLabel(c));
    return m;
  };

  const valueCell = (key: string, r: KitRecord): ReactNode => {
    const vs = valuesOf(r, key);
    if (!vs.length) return '—';
    const labelOf = chipLabelsOf(r, key);
    if (fieldType(r.kind, key) === 'date') {
      return (
        <span className="sk-list__vals">
          {vs.map(v => <DayCell key={v} iso={String(v)} badTitle={t('kit.fmt.badDate')} />)}
        </span>
      );
    }
    return (
      <span className="sk-list__vals">
        {vs.map(v => (
          <span key={v} className="sk-list__val"><ValueIconMark icon={iconOf(key, v)} />{labelOf.get(v) ?? labels.valueTitle(key, v)}</span>
        ))}
      </span>
    );
  };

  const checkbox = (r: KitRecord) => (
    <label className="sk-list__check">
      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} aria-label={t('kit.list.select', { title: r.title })} aria-keyshortcuts="X" />
    </label>
  );

  /**
   * Выбор группы у её заголовка: чекбокс с именем группы и «отмечено N из M».
   * Чекбокс — рядом с кнопкой сворачивания, а не внутри неё: вложенная в
   * кнопку кнопка — недопустимая разметка, и нажатие било бы сразу по двум.
   */
  const groupPick = (g: ListGroup, title: string) => {
    const n = groupSelCount(g);
    const all = g.records.length > 0 && n === g.records.length;
    return (
      <label className="sk-list__check sk-list__gcheck">
        <input
          type="checkbox"
          checked={all}
          // «Часть группы» — это mixed, а не «снято»: снятый квадратик обещал
          // бы, что в группе ничего не выбрано.
          ref={el => { if (el) el.indeterminate = n > 0 && !all; }}
          onChange={() => toggleGroupSel(g)}
          aria-label={t('kit.list.selectGroup', { title })}
        />
      </label>
    );
  };
  const groupSelNote = (g: ListGroup) => {
    const n = groupSelCount(g);
    if (n === 0) return null;
    return (
      <span className="sk-list__gsel" data-testid={`kit-list-gsel-${g.key}`}>
        {t('kit.list.groupSelected', { n, total: g.records.length })}
      </span>
    );
  };

  const cell = (col: string, r: KitRecord): ReactNode => {
    switch (col) {
      case 'select': return checkbox(r);
      case 'title+id': return <><Title r={r} href={href} onOpen={onOpen} /> <Pill variant="id">{r.id}</Pill></>;
      case 'title': return <Title r={r} href={href} onOpen={onOpen} />;
      case 'id': return <Pill variant="id">{r.id}</Pill>;
      case 'status': return <StatusCell code={r.status} labels={labels} />;
      case 'kind': return labels.valueTitle('kind', r.kind);
      case 'verdict': return <VerdictCell r={r} ctx={ctx} lang={lang} />;
      case 'updated_at': return <DayCell iso={r.updated_at} badTitle={t('kit.fmt.badDate')} />;
      case 'edges_count': return <span className="sk-list__mono">{edgeCount.get(r.id) ?? 0}</span>;
      case 'actions': return rowActionsCell(r);
      default:
        if (col.startsWith('progress:')) return <ProgressCell value={fieldValue(r, col.slice(9))} />;
        // Сумма с охватом (S4-09): «12,5 д» или «12,5 д · у 9 из 14», и
        // «не заполнено» вместо нуля, когда не заполнено ни у кого.
        if (col.startsWith('sum:')) return <SumCell value={fieldValue(r, col.slice(4))} />;
        // Колонка, которой у типа нет (S4-35): в смешанном списке «—» читалось
        // бы как «значения нет», хотя поля у типа не бывает вовсе. Говорим это
        // только когда тип ОБЪЯВИЛ свои поля — иначе утверждать нечем.
        if (notApplicable(r.kind, col)) {
          const fieldTitle = fieldTitleOf(col);
          return <span className="sk-list__na" title={t('kit.list.cell.na', { kind: config.kinds[r.kind]?.title ?? r.kind, field: fieldTitle })}>{t('kit.list.cell.naShort')}</span>;
        }
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
      default: return labels.keyTitle(colKey(col));
    }
  };

  /**
   * Значки в углу карточки на доске (S4-36). Сверено с прототипом v4
   * (cardHtml): карточка несёт не только название и код, иначе при
   * переключении вида часть сведений пропадает.
   *
   * Статус не показываем — колонки доски и есть статусы. Пустые значения не
   * рисуем: пустой значок хуже отсутствующего. Не больше трёх, иначе угол
   * карточки превращается в таблицу.
   */
  const boardBadges = (r: KitRecord): ReactNode => {
    const keys = columns
      .filter(c0 => c0.startsWith('fields.'))
      .filter(c0 => valueKey(fieldValue(r, c0)) !== '')
      .slice(0, 3);
    if (keys.length === 0) return null;
    return (
      <span className="sk-board__badges" data-testid="board-badges">
        {keys.map(k => (
          <span key={k} className="sk-board__badge" title={labels.keyTitle(k)}>{cell(k, r)}</span>
        ))}
      </span>
    );
  };

  const moreButton = (g: ListGroup, limit: number, key: string = g.key) => {
    const rest = g.records.length - limit;
    return rest > 0
      ? <button type="button" className="sk-btn" onClick={() => showMore(key)}>{t('kit.list.more', { n: rest })}</button>
      : null;
  };

  /** Пустое состояние с оговоркой фильтра — общее для всех видов. */
  const emptyFilteredState = (
    <EmptyState
      title={t('kit.list.emptyFiltered')}
      hint={t('kit.list.emptyFilteredHint')}
      action={hasFilter ? <button type="button" className="sk-btn" onClick={resetFilters}>{t('kit.list.reset')}</button> : undefined}
    />
  );

  /**
   * Подпись группы ленты. Ведро времени — свои слова; группировка полем —
   * подпись ОБЩЕЙ группировки (`groupLabel`), а не вторая формулировка: иначе
   * «без связи» в таблице и в ленте разъехались бы.
   */
  // Какие тела раскрыты. В памяти, а не в адресе: ссылкой делятся видом,
  // фильтром и порядком, а раскрытый абзац — личное состояние чтения.
  const [bodyOpen, setBodyOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggleBody = (id: string) => setBodyOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const feedGroupTitle = (g: FeedGroup): string => {
    if (g.group) return groupTitle(g.group);
    switch (g.key) {
      case FEED_UNDATED: return t('kit.list.feed.undated');
      case FEED_UNREAD: return t('kit.list.feed.unread');
      case FEED_GAPS: return t('kit.list.feed.gaps');
      default: return t(`kit.list.feed.day.${g.key}` as KitKey);
    }
  };

  /** Время строки ленты: минуты по названному полю, отметки нет — «—». */
  const feedWhen = (at: string | null): ReactNode => {
    const m = at === null ? null : kitMinute(at);
    if (!m) return <span className="sk-feed__nowhen">—</span>;
    return (
      <time className="sk-list__mono" dateTime={m.ok ? m.title : undefined} data-date={m.ok ? 'minute' : 'raw'} title={m.title}>
        {m.text}
      </time>
    );
  };

  /**
   * Повод строки (§2): НАЗВАННЫЕ приложением связи записи. Связанная запись не
   * загружена — показываем её код, а не придумываем заголовок (то же правило,
   * что у разреза по связи). Связей нет — блока нет.
   */
  const feedRefs = (r: KitRecord): { id: string; type: string }[] => {
    const types = feedCfg?.because ?? [];
    if (types.length === 0) return [];
    const seen = new Set<string>();
    const refs: { id: string; type: string }[] = [];
    for (const e of data.edges) {
      if (!types.includes(e.type)) continue;
      const other = e.from === r.id ? e.to : e.to === r.id ? e.from : null;
      if (other === null || other === r.id || seen.has(other)) continue;
      seen.add(other);
      refs.push({ id: other, type: e.type });
    }
    return refs;
  };

  /** Ссылка на связанную запись. Не загружена — КОД, а не выдуманный заголовок. */
  const feedRef = (x: { id: string; type: string }): ReactNode => {
    const target = data.records.find(rr => rr.id === x.id);
    const label = config.edges?.[x.type]?.label ?? x.type;
    return href
      ? <a key={x.id} className="sk-feed__ref" href={href(x.id)} title={label}>{target?.title ?? x.id}</a>
      : <span key={x.id} className="sk-feed__ref" title={label}>{target?.title ?? x.id}</span>;
  };

  const feedBecause = (r: KitRecord): ReactNode => {
    const refs = feedRefs(r);
    if (refs.length === 0) return null;
    return <span className="sk-feed__because">{refs.map(feedRef)}</span>;
  };

  /**
   * Тело записи в ленте (K2-FEED-BODY-MORE): первые абзацы и свёртка остатка.
   *
   * Четыре состояния остатка (не загружен · здесь · едет · не дошёл) дают
   * ЧЕТЫРЕ разных предложения под телом — правило живёт чистой функцией
   * foldBody, потому что оно про утверждения, а не про разметку.
   *
   * «Ещё» без числа, когда числа не назвали: за «Ещё 4» человек ждёт четыре
   * абзаца, а не сорок, и выдуманное число здесь хуже отсутствующего.
   */
  const feedBodyBlock = (r: KitRecord): ReactNode => {
    const body = feedBody?.(r) ?? null;
    if (!body) return null;
    const open = bodyOpen.has(r.id);
    const { shown, action } = foldBody(body, open);
    if (shown.length === 0 && action.kind === 'none') return null;
    // Запрос остатка предлагаем только тому, кто умеет его выполнить.
    const askable = action.kind === 'load' || action.kind === 'retry' ? !!onFeedBody : true;
    const unknownN = action.kind === 'load' && action.n === null;
    const label =
      action.kind === 'open' ? t('kit.list.more', { n: action.n })
      : action.kind === 'close' ? t('kit.list.feed.body.less')
      : action.kind === 'busy' ? t('kit.list.feed.body.busy')
      : action.kind === 'retry' ? t('kit.list.feed.body.retry')
      : unknownN ? t('kit.list.feed.body.moreUnknown')
      : t('kit.list.more', { n: (action as { n: number }).n });
    const click = () => {
      if (action.kind === 'busy') return;
      if (action.kind === 'load' || action.kind === 'retry') {
        onFeedBody?.(r.id);
        if (action.kind === 'load' && !open) toggleBody(r.id);
        return;
      }
      toggleBody(r.id);
    };
    return (
      <span className="sk-feed__body" data-body={action.kind} data-open={open ? '' : undefined}>
        {shown.map((para, i) => <span key={i} className="sk-feed__para">{para}</span>)}
        {action.kind === 'retry' && (
          <span className="sk-feed__bodyfail" role="alert">
            {t('kit.list.feed.body.failed', { reason: action.reason })}
          </span>
        )}
        {action.kind !== 'none' && askable && (
          <button
            type="button"
            className="sk-btn sk-feed__bodymore"
            aria-disabled={action.kind === 'busy' ? 'true' : undefined}
            aria-expanded={action.kind === 'open' || action.kind === 'close' ? open : undefined}
            title={unknownN ? t('kit.list.feed.body.moreUnknownWhy') : undefined}
            onClick={e => { e.stopPropagation(); click(); }}
          >
            {label}
          </button>
        )}
      </span>
    );
  };

  /**
   * Относящееся к записи с телом — ВКЛЕЕННЫМ блоком с числом в заголовке
   * (§5, п.2; согласие владелицы 10.11.2026: «пусть встраивает»).
   *
   * Блок — ТОТ ЖЕ, что в хвосте тела паспорта (GluedBlock), а не похожий:
   * утверждение одно, и у него одни правила — счётчик обязателен, «не
   * проверено» это не ноль, пустой блок не рисуется. Второй такой же блок
   * разъехался бы с первым первой же правкой.
   *
   * Только у записи С ТЕЛОМ: у строки места под блок нет, и там те же связи
   * идут чипами в строке мета.
   */
  const feedGlued = (r: KitRecord): ReactNode => {
    const refs = feedRefs(r);
    if (refs.length === 0) return null;
    const types = feedCfg?.because ?? [];
    const label = types.length === 1
      ? (config.edges?.[types[0]]?.label ?? types[0])
      : t('kit.list.feed.body.related');
    return (
      <GluedBlock id="feed-because" label={label} count={refs.length} lang={lang}>
        <span className="sk-feed__because">{refs.map(feedRef)}</span>
      </GluedBlock>
    );
  };

  /**
   * Полоса верхнего уровня: числа ТЕМ ЖЕ путём, что в таблице (состав п.4).
   *
   * Рисует их тот же `cell`, что и ячейку таблицы, по тем же колонкам
   * `progress:`/`sum:`. Счёт здесь не повторяется НИ В ОДНОЙ строке кода —
   * иначе у чисел появилось бы две правды, и разошлись бы они первой правкой.
   *
   * У каждого числа подпись: «3/7» без подписи неизвестно о чём, а наведения
   * на телефоне нет, и спрятанная в подсказку подпись там не существует.
   */
  const feedStrip = (r: KitRecord): ReactNode => {
    if (stripCols.length === 0) return null;
    return (
      <span className="sk-feed__strip">
        {stripCols.map(c => (
          <span key={c} className="sk-feed__stripcell" data-col={c}>
            <span className="sk-feed__striplabel">{colTitle(c)}</span>
            {cell(c, r)}
          </span>
        ))}
      </span>
    );
  };

  /**
   * Нижний уровень под полосой (состав п.2, п.3).
   *
   * Пять состояний (не загружен · здесь · едет · не дошёл · нет прав) дают
   * пять разных предложений — правило живёт чистой функцией `foldUnder`,
   * потому что это утверждения о состоянии, а не вид. Разметка их только
   * рисует.
   *
   * Загруженное раскрывается НА МЕСТЕ и в сеть не ходит; незагруженное
   * запрашивается — слово владелицы 10.11.2026 «грузить при раскрытии». У
   * «нет прав» кнопки нет вовсе: повторять нечего, и чинится это не повтором.
   */
  const feedUnderBlock = (r: KitRecord, fold: FeedUnderFold): ReactNode => {
    const { rows, action, nothing, cut } = fold;
    const open = expanded.has(r.id);
    // Запрос предлагаем только тому, кто умеет его выполнить.
    const askable = action.kind === 'load' || action.kind === 'retry' ? !!onFeedUnder : true;
    const unknownN = action.kind === 'load' && action.n === null;
    const label =
      action.kind === 'open' ? t('kit.list.more', { n: action.n })
      : action.kind === 'close' ? t('kit.list.feed.under.less')
      : action.kind === 'busy' ? t('kit.list.feed.under.busy')
      : action.kind === 'retry' ? t('kit.list.feed.under.retry')
      : unknownN ? t('kit.list.feed.under.moreUnknown')
      : t('kit.list.more', { n: (action as { n: number }).n });
    const click = () => {
      if (action.kind === 'busy' || action.kind === 'none' || action.kind === 'denied') return;
      if (action.kind === 'load' || action.kind === 'retry') {
        // Нажали — значит уже спросили: отмечаем, чтобы догрузка по ссылке не
        // послала второй запрос за тем же самым.
        askedUnder.current.add(r.id);
        onFeedUnder?.(r.id);
        // Раскрываем сразу: иначе ответ приедет в свёрнутое, и человек не
        // увидит того, что сам попросил.
        if (action.kind === 'load' && !open) toggleExpand(r.id);
        return;
      }
      toggleExpand(r.id);
    };
    const showButton = action.kind !== 'none' && action.kind !== 'denied' && askable;
    return (
      <span className="sk-feed__undergroup" data-under={action.kind} data-open={open ? '' : undefined}>
        {/* «Ничего нет» — утверждение источника, а не пустое место под полосой. */}
        {nothing && (
          <span className="sk-feed__undernote" data-note="nothing" role="status">{t('kit.list.feed.under.nothing')}</span>
        )}
        {action.kind === 'denied' && (
          <span className="sk-feed__undernote" data-note="denied" role="status">
            {t('kit.list.feed.under.denied', { reason: action.reason })}
          </span>
        )}
        {action.kind === 'retry' && (
          <span className="sk-feed__undernote" data-note="failed" role="alert">
            {t('kit.list.feed.under.failed', { reason: action.reason })}
          </span>
        )}
        {rows.length > 0 && (
          /* Тот же вклеенный блок, что у паспорта и у тела записи: счётчик
             обязателен, и «показано не всё» названо числом рядом. */
          <GluedBlock id="feed-under" label={underCfg?.title ?? ''} count={cut ? cut.total : rows.length} lang={lang}>
            <ul className="sk-feed__under">
              {rows.map(rr => feedItem(rr, feedCfg ? feedTime(rr, feedCfg.timeField) : null, 'under'))}
            </ul>
            {cut && (
              <span className="sk-feed__undernote" data-note="cut" role="status">
                {t('kit.list.feed.under.cut', { shown: cut.shown, total: cut.total })}
              </span>
            )}
          </GluedBlock>
        )}
        {showButton && (
          <button
            type="button"
            className="sk-btn sk-feed__undermore"
            aria-disabled={action.kind === 'busy' ? 'true' : undefined}
            aria-expanded={action.kind === 'open' || action.kind === 'close' ? open : undefined}
            title={unknownN ? t('kit.list.feed.under.moreUnknownWhy') : undefined}
            onClick={e => { e.stopPropagation(); click(); }}
          >
            {label}
          </button>
        )}
      </span>
    );
  };

  /**
   * Строка ленты — ОДНА форма на все типы записей (§2, §7). Различия приходят
   * названными полями, а не своей вёрсткой под каждый тип: иначе при появлении
   * нового типа лента молча перестала бы его показывать как следует.
   */
  const feedItem = (r: KitRecord, at: string | null, level: FeedLevel = 'flat'): ReactNode => {
    const leads = (feedCfg?.lead ?? []).filter(k => valuesOf(r, k).length > 0);
    const bodyNode = feedBodyBlock(r);
    // Верхний уровень — тот, у кого приложение вернуло состояние нижнего
    // (K-14): kit не знает, что считать верхним.
    const under = underOf(r, level);
    const fold = under ? foldUnder(under, expanded.has(r.id)) : null;
    // Статуса у записи нет (или оси нет вовсе, K-14) — чипа нет: пустого места
    // не рисуем, а «∅» обещало бы значение, которого не существует.
    const withStatus = r.status !== '' && config.statuses.items.length > 0;
    return (
      <li
        key={r.id}
        className={`sk-feed__item${selected.has(r.id) ? ' is-selected' : ''}`}
        /* Уровень — ПРИЗНАКОМ, а не классом и не своей вёрсткой: форма строки
           на обоих уровнях одна, иначе нижний уровень поехал бы своим видом. */
        data-feed-level={twoLevel ? (level === 'under' ? 'under' : under ? 'top' : 'flat') : undefined}
        data-record-id={r.id}
        {...rowProps(r)}
        onClick={e => onRecordClick(e, r.id)}
      >
        <span className="sk-feed__when">{feedWhen(at)}</span>
        <span className="sk-feed__main">
          <span className="sk-feed__head">
            <span className="sk-feed__kind">{labels.valueTitle('kind', r.kind)}</span>
            <Pill variant="id">{r.id}</Pill>
          </span>
          <span className="sk-feed__title"><Title r={r} href={href} onOpen={onOpen} /></span>
          {leads.map(k => <span key={k} className="sk-feed__lead">{valueCell(k, r)}</span>)}
          {/* Статус у записи с телом остаётся в шапке: он часть утверждения о
              записи, а не часть текста. Связи же у записи с телом уезжают во
              вклеенный блок — там у них есть ЧИСЛО, которого в строке чипов
              нет. У записи без тела всё как было. */}
          {(withStatus || (!bodyNode && feedBecause(r))) && (
            <span className="sk-feed__meta">
              {withStatus && <StatusCell code={r.status} labels={labels} />}
              {!bodyNode && feedBecause(r)}
            </span>
          )}
          {under && feedStrip(r)}
          {bodyNode}
          {bodyNode && feedGlued(r)}
          {fold && feedUnderBlock(r, fold)}
        </span>
      </li>
    );
  };

  /**
   * Провал источника строкой ленты (§6). Стоит на своём месте по времени, с
   * причиной, и «нет прав» названо ИНАЧЕ, чем сбой: это два разных исхода, и
   * лечатся они по-разному.
   */
  const feedGapRow = (gap: FeedRow & { kind: 'gap' }, i: number): ReactNode => (
    <li
      key={`gap:${gap.gap.block}:${i}`}
      className="sk-feed__item sk-feed__item--gap"
      data-feed-gap={gap.gap.kind}
      data-block={gap.gap.block}
    >
      <span className="sk-feed__when">
        {gap.at === null ? <span className="sk-feed__nowhen" title={t('kit.list.feed.gap.noTime')}>—</span> : feedWhen(gap.at)}
      </span>
      <span className="sk-feed__main">
        <span className="sk-feed__head"><span className="sk-feed__kind">{gap.gap.block}</span></span>
        <span className="sk-feed__title">
          {t(gap.gap.kind === 'forbidden' ? 'kit.list.feed.gap.forbidden' : 'kit.list.feed.gap.failed')}
        </span>
        <span className="sk-feed__lead">{gap.gap.reason}</span>
      </span>
    </li>
  );

  let body: ReactNode;
  if (feedGroupsList) {
    /*
      Лента (K2-FEED-VIEW). Честные состояния здесь — не украшение, а часть
      вида: лента выглядит потоком событий, и пропуск в ней читается как
      «ничего не было». Поэтому она сама отвечает за все четыре исхода:
        • «не смогли проверить» и «нет прав» — строками в порядке времени;
        • «обрезано» — числом в каждой группе и оговоркой про обрезанную выдачу;
        • «пусто» — только когда источник ОТВЕТИЛ, провалов нет и записей
          действительно нет.
    */
    const empty = feedGroupsList.length === 0;
    body = (
      <div className="sk-feed">
        {feedGroupsList.map(g => {
          const limit = limitOf(g.key);
          const cutN = g.rows.length - limit;
          const title = feedGroupTitle(g);
          return (
            <section key={g.key} className="sk-feed__day" data-day={g.key} aria-label={t('kit.list.column', { title, n: g.rows.length })}>
              <h3 className="sk-feed__date">
                <span className="sk-feed__gtitle">{title}</span>
                <span className="sk-feed__count">{g.rows.length}</span>
              </h3>
              <ul className="sk-feed__items">
                {g.rows.slice(0, limit).map((row, i) => (row.kind === 'record' ? feedItem(row.record, row.at) : feedGapRow(row, i)))}
              </ul>
              {cutN > 0 && (
                <p className="sk-feed__cut" role="status">
                  <span>{t(g.group ? 'kit.list.feed.cutGroup' : 'kit.list.feed.cutDay', { shown: limit, total: g.rows.length })}</span>
                  {' '}
                  <button type="button" className="sk-btn" onClick={() => showMore(g.key)}>{t('kit.list.more', { n: cutN })}</button>
                </p>
              )}
            </section>
          );
        })}
        {/* Проверенный ноль: источник ответил целиком, провалов нет, записей нет. */}
        {empty && shown.kind === 'complete' && records.length === 0 && <EmptyState />}
        {/* Фильтр отсеял всё — это не «ничего не было», и чинится другим фильтром. */}
        {empty && records.length > 0 && emptyFilteredState}
        {/* Выдача неполная, а строк нет: «пусто» утверждать нельзя. */}
        {empty && shown.kind !== 'complete' && records.length === 0 && (
          <p className="sk-feed__none" role="status">{t('kit.list.feed.none')}</p>
        )}
        {/* Период показан не весь: числа групп — по загруженным строкам. */}
        {!empty && shown.kind !== 'complete' && (
          <p className="sk-feed__page" role="status">{t('kit.list.feed.cutPage')}</p>
        )}
      </div>
    );
  } else if (records.length === 0 && shown.kind === 'complete') {
    body = <EmptyState />;
  } else if (filtered.length === 0 && records.length > 0) {
    body = emptyFilteredState;
  } else if (view === 'cards') {
    // Карточки (S4-22): сетка auto-fit; на карточке — название, ID, статус и поля колонок.
    const extra = columns.filter(c0 => c0.startsWith('fields.'));
    body = (
      <ul className="sk-cards">
        {filtered.map(r => (
          <li key={r.id} className={`sk-cards__card${selected.has(r.id) ? ' is-selected' : ''}`} data-record-id={r.id} {...rowProps(r)} onClick={e => onRecordClick(e, r.id)}>
            <div className="sk-cards__head">{cell('status', r)}<Pill variant="id">{r.id}</Pill></div>
            <div className="sk-cards__title"><Title r={r} href={href} onOpen={onOpen} /></div>
            {extra.length > 0 && (
              <dl className="sk-cards__fields">
                {extra.map(k => <div key={k}><dt>{colTitle(k)}</dt><dd>{cell(k, r)}</dd></div>)}
              </dl>
            )}
          </li>
        ))}
      </ul>
    );
  } else if (view === 'timeline') {
    // Таймлайн (S4-22): дорожки той же группировки, что у списка и доски.
    const tl = listCfg?.timeline;
    body = tl
      ? <TimelineLanes config={config} data={data} records={filtered} group={groupKey} start={tl.start} end={tl.end} href={href} />
      : <EmptyState title={t('kit.list.timeline.noConfig')} />;
  } else if (view === 'tree') {
    // Дерево (S4-22): иерархия по list.tree над теми же отфильтрованными записями.
    body = <TreeView config={config} data={{ ...data, records: filtered }} href={href} onOpen={onOpen} />;
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
                    {boardBadges(r)}
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
                    {/* У «Прочих» число строк уже в подписи (S9-02) — второй раз рядом оно только спорит с собой. */}
                    {!lane.other && <span className="sk-list__gcount">{lane.records.length}</span>}
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
            <tr>
              {expand && <th scope="col" className="sk-list__th sk-list__xcell"><span className="sk-sr">{t('kit.list.col.expand')}</span></th>}
              {columns.map(c => {
                const head = colTitle(c);
                return (
                <th
                  key={c}
                  scope="col"
                  className={`sk-list__th sk-list__c-${c.replace(/[^a-z0-9]+/g, '-')}`}
                  style={appliedW[c] === undefined ? undefined : { width: `${appliedW[c]}px` }}
                >
                  {head}
                  {widths && !widths.narrow && (
                    // Ручка — только когда ширинами управляют: иначе это
                    // украшение, которое ничего не делает.
                    <span
                      className="sk-list__grip"
                      data-grip={c}
                      // aria-hidden: ручка — приспособление для мыши, и
                      // клавиатурного изменения ширины у неё НЕТ. Объявить её
                      // скринридеру значило бы обещать управление, которого
                      // нет; к тому же её подпись подмешивалась в имя колонки,
                      // и «Задачи» читались как «Задачи Ширина колонки
                      // Задачи» (поймано тестом списка спринтов).
                      aria-hidden="true"
                      title={t('kit.list.cols.width', { title: typeof head === 'string' ? head : c })}
                      onPointerDown={onGrip(c)}
                    />
                  )}
                </th>
                );
              })}
            </tr>
          </thead>
          {/*
            Поиск не нашёл ни одной группы — говорим это словами и повторяем
            запрос. Пустая таблица с одной шапкой читается как «данные есть, но
            их не видно», а здесь дело в запросе, и его надо показать.
          */}
          {find && foundGroups.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={span} className="sk-list__gfind-empty" role="status">
                  {t('kit.list.groupFindEmpty', { q: groupFind.trim() })}
                </td>
              </tr>
            </tbody>
          )}
          {groups.map(g => {
            const headed = grouped || g.key === CLOSED_KEY;
            const open = !headed || isOpen(g.key);
            const limit = limitOf(g.key);
            return (
              <tbody key={g.key}>
                {headed && (
                  <tr className="sk-list__ghead" data-group-key={g.key} data-other={g.other ? 'true' : undefined}>
                    <th colSpan={span} scope="rowgroup">
                      <div className="sk-list__ghrow">
                        {selecting && groupPick(g, groupTitle(g))}
                        <button type="button" className="sk-list__gbtn" aria-expanded={open} onClick={() => toggleGroup(g.key)}>
                          <span className="sk-list__chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                          <span className={g.unknown || g.missing || g.none ? 'sk-list__gtitle is-unknown' : 'sk-list__gtitle'}>{groupTitle(g)}</span>
                          {!g.other && <span className="sk-list__gcount">{g.records.length}</span>}
                        </button>
                        {selecting && groupSelNote(g)}
                      </div>
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
          {selHidden > 0 && (
            <span className="sk-list__selhidden" role="status" data-testid="kit-list-selhidden">
              {t('kit.list.selHidden', { n: selHidden })}
            </span>
          )}
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
          {filterKeys.map(k => {
            // Числа оси: у источника — по всей выдаче, иначе по загруженной
            // странице; «не посчитали» — «?» вместо чисел (S9-01). Значения
            // при «?» остаются страничными: выбрать значение всё равно надо,
            // а вот счёт по ним мы не обещаем.
            const src = axisSource(serverCounts, k, narrowing);
            const page = facetOf(records, filterSet, k);
            return (
              <FacetFilter
                key={k}
                title={labels.keyTitle(k)}
                filter={fieldFilterOf(k)}
                facet={src.from === 'all' ? facetFromAxis(src.axis) : page}
                valueTitle={v => labels.valueTitle(k, v)}
                valueIcon={v => iconOf(k, v)}
                compare={k === 'status' ? statusCompare : undefined}
                onChange={fl => setFieldFilter(k, fl)}
                lang={lang}
                countsFrom={src.from === 'all' || wholeLoaded ? 'all' : 'page'}
                countsUnknown={src.from === 'unknown' ? (src.reason ?? '') : undefined}
                multi={src.from === 'all' ? src.axis.multi : undefined}
                // Закреплённые значения оси (S9-03): их называет приложение,
                // потому что «почему именно эти» — предметное знание (K-14).
                pinned={facetPinned?.(k)}
              />
            );
          })}
        </fieldset>
        {/* Лента получает ТУ ЖЕ строку управления (K2-FEED-VIEW §1): просьба
            была именно про «фильтровать и группировать наверху, как в
            табличном виде». Без сегмента группировки лента была бы просто
            длинным списком. */}
        {(view === 'list' || view === 'board' || view === 'feed') && hasGroupings && (
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
          {/*
            Поиск по группам появляется, когда их столько, что глазами искать
            уже долго. Порог тот же, что у поиска по значениям внутри фасета
            (GROUP_FIND_FROM = FIND_FROM): два разных числа для одного и того же
            «их стало много» расходились бы без причины.
          */}
          {groupKey !== null && (rawGroups.length >= GROUP_FIND_FROM || find) && (
            <input
              type="search"
              role="searchbox"
              className="sk-list__gfind"
              aria-label={t('kit.list.groupFind')}
              placeholder={t('kit.list.groupFindPlaceholder')}
              value={groupFind}
              onChange={e => setGroupFind(e.target.value)}
            />
          )}
          {groupCapNote && <span className="sk-list__gcap" role="status">{groupCapNote}</span>}
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
        {/* Чип с нулевым счётчиком не рисуем (аудит 10.11): «Без версии 0» —
            чистый шум. Исключение — включённый фильтр: его надо видеть, чтобы
            было что снять, иначе фильтр остаётся навсегда. */}
        {visibleQuick.length > 0 && (
          <div role="group" aria-label={t('kit.list.quick')} className="sk-list__quick">
            <span className="sk-list__label" aria-hidden="true">{t('kit.list.quick')}</span>
            {visibleQuick.map(q => {
              const icon = quickIcons?.[q.id] ?? quickIconOf(q, config);
              const qColor = quickColorOf(q, config);
              // Число чипа — у источника или по странице; «не посчитали» — «?»
              // с подсказкой, тем же приёмом, что у счётчика вкладки (S9-01).
              const qc = quickCount(q);
              const qTitle = qc.n === null
                ? (qc.why ? t('kit.list.count.unknownWhy', { reason: qc.why }) : t('kit.list.count.unknown'))
                : t(qc.from === 'all' ? 'kit.list.count.all' : 'kit.list.count.page');
              return (
                <Pill
                  key={q.id}
                  variant="filter"
                  pressed={state.quick === q.id}
                  onToggle={on => update({ quick: on ? q.id : null })}
                >
                  {icon && <span className="sk-list__qicon" data-quick-icon={icon} style={qColor ? { color: qColor } : undefined}><GameIcon slug={icon} size={12} /></span>}
                  <span>{q.title}</span>
                  <span
                    className="sk-list__qcount"
                    data-src={qc.n === null ? undefined : qc.from}
                    data-unknown={qc.n === null ? '' : undefined}
                    title={qTitle}
                  >
                    {qc.n === null ? '?' : qc.n}
                  </span>
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
        {/* Полнота счёта — словами рядом с «Показано N из M» (S9-01): «посчитано
            не целиком», «счётчиков не бывает», «нет разрешённых проектов»,
            «сбой» — каждое своё, и ни одно из них не ноль. */}
        {countsWords.length > 0 && (
          <p className="sk-list__counts" data-testid="kit-list-counts" role="status">{countsWords.join(' ')}</p>
        )}
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
        {/*
          Строка условий держится в одну строку: выше порога остальные
          сворачиваются в «+N» (S9-12). Спрятанные не исчезают — «+N»
          раскрывает их НА МЕСТЕ, и каждое по-прежнему снимается по одному,
          иначе «что сейчас отсеивает записи» перестанет быть видно, а это и
          есть смысл строки-описания.
        */}
        {/* Чипы — в своей прокручиваемой полосе (S9-12, находка прода 09.11):
            «+N» и «Сбросить» лежали ВНУТРИ прокрутки и уезжали вместе с
            чипами за край экрана. Теперь листаются только условия, а
            управление остаётся на виду. */}
        <div className="sk-list__chipscroll">
          {(chipsOpen ? chips : chips.slice(0, chipsInline)).map(c => (
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
        </div>
        {chips.length > chipsInline && (
          <button
            type="button"
            className="sk-list__chipmore"
            aria-expanded={chipsOpen}
            onClick={() => setChipsOpen(v => !v)}
          >
            {chipsOpen ? t('kit.list.chipsLess') : kitPlural(lang, 'kit.list.chipsMore', chips.length - chipsInline)}
          </button>
        )}
        <button type="button" className="sk-btn" onClick={resetFilters}>{t('kit.list.reset')}</button>
      </div>
      )}
      {multi > 0 && <p className="sk-list__multi" data-testid="kit-list-multi">{t('kit.list.multi', { n: multi })}</p>}

      {body}
    </div>
  );
}
