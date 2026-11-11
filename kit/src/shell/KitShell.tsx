// KitShell — оболочка Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-02). Вынос из
// прототипа v4 (docs/prototypes/ux-redesign-shell-v4.tpl.html: шапка .top с
// .apps, меню .side с группами, «Избранное и виды», «Недавние», drawer на
// телефоне) в React-компонент, который рисуется из KitConfig (контракт ядра):
//
//   • модули — сверху (config.modules); planned виден, но недоступен;
//   • меню — группы по смыслу (config.menu.groups), тон группы — токеном;
//   • «Мои виды» (menu.myViews) и «Недавние» (menu.recent) — в хранилище с
//     откатом в память (S4-00f) и честной плашкой StorageBanner;
//   • узкий экран (≤720px) — меню уезжает в Sheet слева (drawer);
//   • модуль/раздел/вид — в URL (mod/sec/view) с фолбэком на «#».
//
// Пустое — честно: пустые «Недавние»/«Мои виды»/меню подписаны, запись,
// которой нет в выгрузке, помечена, а не выброшена молча.
import { ICON_CANON } from '../elements/iconCanon';
import { navClick } from '../core/navClick';
import { useNarrow } from '../core/narrow';
import { StatusDictCtx } from '../core/statusLook';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { KitConfig, KitData } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { IconButton } from '../elements/IconButton';
import { kitT, useKitLang } from '../i18n';
import type { KitLang } from '../i18n';
import { createSafeStorage } from '../resilience/safeStorage';
import type { SafeStorage } from '../resilience/safeStorage';
import { StorageBanner } from '../resilience/StorageBanner';
import { pushUrlState, readUrlState, sectionScopedPatch, urlStateHref } from '../resilience/urlState';
import type { UrlWindow } from '../resilience/urlState';
import { Sheet } from './Sheet';
import { Ear } from './Ear';
import { Popover } from './Popover';
import { ResizeBorder, zoneSize } from './ResizeBorder';

/** Где пользователь: модуль, пункт меню, вид пункта. */
export interface KitNav {
  module: string;
  item: string | null;
  view: string | null;
}

/** Сохранённый «мой вид» — снимок KitNav с подписью. */
export interface KitSavedView extends KitNav {
  id: string;
  title: string;
}

/**
 * Сколько видов закреплено в меню до свёртки «Все виды»
 * (SPRINT_UXR_S9_SCALE_OPT/S9-12).
 *
 * Пять — число из задачи владелицы, не подбор. Остальные не исчезают: пункт
 * «Все виды (N)» раскрывает их на месте. Отдельного окна со списком видов нет
 * намеренно — это была бы новая поверхность, то есть решение о виде, которого
 * задача не требует.
 */
export const PINNED_VIEWS = 5;

/**
 * Состояние левого меню (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MENU-STATES):
 * открыто — колонка с подписями; rail — только иконки; hidden — ушко на краю.
 */
export type KitMenuMode = 'open' | 'rail' | 'hidden';

const MENU_MODES: readonly KitMenuMode[] = ['open', 'rail', 'hidden'];

function isMenuMode(v: unknown): v is KitMenuMode {
  return typeof v === 'string' && (MENU_MODES as readonly string[]).includes(v);
}

/** Кнопка ходит по кругу: открыто → рейка → ушко → открыто. */
function nextMenuMode(m: KitMenuMode): KitMenuMode {
  return m === 'open' ? 'rail' : m === 'rail' ? 'hidden' : 'open';
}

/**
 * Подпись кнопки — что случится по нажатию, а не где мы сейчас. Ключи
 * перечислены по ветвям, а не таблицей: kitT принимает только известный ключ,
 * и literal-тип должен доживать до вызова.
 */
function menuModeLabel(lang: KitLang, m: KitMenuMode): string {
  if (m === 'open') return kitT(lang, 'kit.shell.menuMode.toRail');
  if (m === 'rail') return kitT(lang, 'kit.shell.menuMode.toHidden');
  return kitT(lang, 'kit.shell.menuMode.toOpen');
}

export interface KitShellApi {
  nav: KitNav;
  navigate: (patch: Partial<KitNav>) => void;
  /**
   * Открыть запись: попадает в «Недавние», уходит в onOpenRecord.
   *
   * Название и адрес необязательны, но без них «Недавнее» получается
   * неполным: оболочка берёт названия из data, которую приложение передаёт не
   * всегда, а адрес записи знает только приложение — раздел, в котором запись
   * живёт, оболочке неизвестен. Без адреса пункт остаётся кнопкой и работает
   * через onOpenRecord; с адресом становится ссылкой, которую можно открыть в
   * новой вкладке (находки P1 аудита 08.11: «Недавние пусто даже после
   * открытия записи» и «пункты — кнопки, 0 <a href>»).
   */
  openRecord: (id: string, meta?: { title?: string; href?: string }) => void;
  recent: string[];
  views: KitSavedView[];
  saveView: (title?: string) => void;
  removeView: (id: string) => void;
  /**
   * Меню свёрнуто до ушка — видимый итог: либо выбран режим hidden, либо меню
   * убрано на время чтения (S5-05 · D-2026-UXR-READ-COLLAPSE).
   */
  menuCollapsed: boolean;
  /**
   * Стабильная ссылка: убрать/вернуть меню на время чтения. В хранилище НЕ
   * пишет — это действие приложения, а не выбор человека, поэтому перезагрузку
   * не переживает и выбранный режим (например рейку) не затирает.
   */
  setMenuCollapsed: (collapsed: boolean) => void;
  /** Выбранное человеком состояние меню (S4-MENU-STATES). */
  menuMode: KitMenuMode;
  /** Выбрать состояние меню: запоминается в хранилище. */
  setMenuMode: (mode: KitMenuMode) => void;
  /**
   * Окно, в котором оболочка держит состояние в адресе; `null` — состояние в
   * памяти (`win={null}`).
   *
   * Нужно приложению, когда он дописывает СВОИ параметры к адресу раздела —
   * например «открыть эту запись» после перехода из поиска. Без этого
   * приложение пишет в глобальный `window`, а оболочка живёт в другом, и
   * параметр просто не доходит (поймано тестом палитры 09.11).
   *
   * Это точка расширения, а не утечка: решать, какие параметры у раздела есть,
   * должно приложение — kit про них не знает (K-10).
   */
  win: UrlWindow | null;
}

export interface KitShellProps {
  config: KitConfig;
  /** Данные — для подписей «Недавних» (заголовок записи по id). */
  data?: KitData;
  /** Имя приложения в шапке; по умолчанию — заголовок первого модуля. */
  brand?: string;
  brandIcon?: string;
  /** Метка после имени приложения (версия, стенд) — например, Pill variant="id". */
  brandTag?: ReactNode;
  /** Хранилище видов и недавних; по умолчанию localStorage с откатом в память. */
  storage?: SafeStorage;
  /** Префикс ключей хранилища — у каждого приложения свой. */
  storageKey?: string;
  /** Окно для URL-состояния (тесты, встройка). */
  win?: UrlWindow;
  /** Принудительно узкий/широкий режим; не задан — по matchMedia. */
  narrow?: boolean;
  onNavigate?: (nav: KitNav) => void;
  onOpenRecord?: (id: string) => void;
  /**
   * Адрес записи — чтобы «Недавнее» было ссылкой, а не кнопкой (находка P1
   * аудита 08.11). Адрес записи знает приложение, не оболочка; не передан —
   * пункт остаётся кнопкой: поддельная ссылка хуже кнопки.
   */
  recordHref?: (id: string) => string;
  /** Правый край шапки: выбор проектов (S4-03), профиль… */
  /** Сразу за приложениями (S4-23): охват проектов, как в прототипе v4. */
  topStart?: ReactNode;
  topEnd?: ReactNode;
  /** Слот аккаунта справа в шапке — меню аватара (AvatarMenu, S4-02). */
  account?: ReactNode;
  /**
   * Глобальные параметры URL, которые переживают смену раздела/модуля
   * (S4-13, B-07). Остальное — q, фильтры, вкладка — принадлежит разделу и
   * снимается при переходе. Смена вида внутри раздела ничего не снимает.
   */
  keepParams?: readonly string[];
  children?: ReactNode;
}

const RECENT_LIMIT = 8;

/**
 * Левое меню: умолчание и пределы ширины (S4-30).
 *
 * 232 — та же ширина, что в seidr.css и в прототипе v4: пока границу не
 * тянули, вид не меняется. Минимум — чтобы пункт с подписью оставался
 * читаемым, иначе человек получает колонку, в которой ничего не разобрать и
 * которая при этом не рейка. Максимум — чтобы меню не съело содержимое:
 * у зоны, которую можно тянуть без предела, «сломано» и «я так потянула»
 * выглядят одинаково.
 */
const SIDE_W = {
  def: 232,
  min: 168,
  max: 420,
  /** Ширина рейки иконок — то же число, что у трека рейки в seidr.css. */
  rail: 56,
  /** Уже этого подписи не сжимаются, а честно исчезают: становится рейка. */
  toRail: 140,
  /** Уже этого и иконки не нужны — меню уходит в ушко. */
  toHide: 70,
};
const TONES = new Set(['acc', 'suc', 'wrn', 'dng', 'inf']);

/**
 * Тон группы: и голое имя токена (acc), и форма var(--acc), которую требует
 * валидатор конфига (validateKitConfig) — иначе валидный конфиг терял цвет.
 */
function toneOf(tone: string | undefined): string | undefined {
  if (!tone) return undefined;
  const t = tone.trim();
  const name = /^var\(--([a-z0-9-]+)\)$/.exec(t)?.[1] ?? t;
  return TONES.has(name) ? name : undefined;
}

const ShellContext = createContext<KitShellApi | null>(null);

/** API оболочки или null вне <KitShell> — для блоков, работающих и без оболочки (режим чтения). */
export function useOptionalKitShell(): KitShellApi | null {
  return useContext(ShellContext);
}

/** API оболочки для содержимого: где мы, навигация, «Недавние», «Мои виды». */
export function useKitShell(): KitShellApi {
  const api = useContext(ShellContext);
  if (!api) throw new Error('useKitShell: вызван вне <KitShell> — оболочки нет, навигации нет');
  return api;
}

/** Что помним об открытой записи: как её звать и куда она открывается. */
interface RecentMeta { title?: string; href?: string }

function readRecentMeta(storage: SafeStorage, storageKey: string): Record<string, RecentMeta> {
  const raw = storage.get(`${storageKey}.recentMeta`);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, RecentMeta> = {};
    for (const [k, m] of Object.entries(v as Record<string, unknown>)) {
      if (!m || typeof m !== 'object') continue;
      const { title, href } = m as Record<string, unknown>;
      const row: RecentMeta = {};
      if (typeof title === 'string') row.title = title;
      if (typeof href === 'string') row.href = href;
      if (row.title || row.href) out[k] = row;
    }
    return out;
  } catch {
    return {};
  }
}

function readList<T>(storage: SafeStorage, key: string): T[] {
  const raw = storage.get(key);
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Узкий экран (телефон, ≤720px) — ОДИН порог на весь kit: оболочка уводит меню
 * в drawer, выбор проектов (S4-03) — в лист снизу, список — в карточки, а
 * строка условий сворачивает лишнее в «+N» (S9-12).
 *
 * Сам хук живёт в `core/narrow.ts`: список не может импортировать оболочку
 * ради одного хука, а второй порог в списке означал бы, что «узко» наступает
 * в разных местах по-разному. Здесь — реэкспорт, чтобы прежние импорты
 * `useNarrow` из оболочки продолжали работать.
 */
export { NARROW_QUERY } from '../core/narrow';
export { useNarrow };

function resolveNav(config: KitConfig, params: URLSearchParams): KitNav {
  const usable = config.modules.filter(m => m.status !== 'planned');
  const module = (usable.find(m => m.id === params.get('mod')) ?? usable[0] ?? config.modules[0])?.id ?? '';
  const items = config.menu.groups.flatMap(g => g.items);
  const fromUrl = items.find(i => i.id === params.get('sec'));
  const item = fromUrl ?? items[0];
  const view = (fromUrl && params.get('view')) || item?.view || null;
  return { module, item: item?.id ?? null, view };
}

export function KitShell({
  config, data, brand, brandIcon, brandTag, storage: storageProp, storageKey = 'seidr-kit', win, narrow: narrowProp,
  onNavigate, onOpenRecord, recordHref, topStart, topEnd, account, keepParams, children,
}: KitShellProps) {
  const lang = useKitLang();
  const urlWin = win ?? (typeof window !== 'undefined' ? window : undefined);
  const storage = useMemo(() => storageProp ?? createSafeStorage(), [storageProp]);
  const narrow = useNarrow(narrowProp);
  const mainId = useId();

  const [nav, setNav] = useState<KitNav>(() => resolveNav(config, urlWin ? readUrlState(urlWin) : new URLSearchParams()));
  const [recent, setRecent] = useState<string[]>(() => readList<string>(storage, `${storageKey}.recent`));
  // Название и адрес открытых записей — рядом со списком недавних, чтобы после
  // перезагрузки список не превращался в набор нерабочих кодов.
  const [recentMeta, setRecentMeta] = useState<Record<string, RecentMeta>>(
    () => readRecentMeta(storage, storageKey),
  );
  const [views, setViews] = useState<KitSavedView[]>(() => readList<KitSavedView>(storage, `${storageKey}.views`));
  // S4-01: свёрнутые группы меню — id групп; переживают перезагрузку.
  const [collapsed, setCollapsed] = useState<string[]>(() => readList<string>(storage, `${storageKey}.collapsed`));
  const [drawer, setDrawer] = useState(false);
  // S4-MENU-STATES: выбор человека — переживает перезагрузку.
  const [menuMode, setMenuModeState] = useState<KitMenuMode>(() => {
    const raw = storage.get(`${storageKey}.menuMode`);
    return isMenuMode(raw) ? raw : 'open';
  });
  // Меню, убранное на время чтения (S5-05) — состояние сеанса, не выбор.
  const [readCollapsed, setReadCollapsed] = useState(false);
  // S4-30: ширина левого меню — личная, как ширина колонки списка, и так же
  // живёт в хранилище, а не в адресе: ссылка общая, ширина личная.
  const [sideW, setSideW] = useState(() => zoneSize(storage, 'shell.side', SIDE_W.def, { min: SIDE_W.rail, max: SIDE_W.max }));
  const navRef = useRef(nav);
  navRef.current = nav;

  // «Назад» браузера и правка hash вручную возвращают оболочку к URL.
  useEffect(() => {
    if (!urlWin || typeof window === 'undefined' || urlWin !== window) return;
    const sync = () => setNav(resolveNav(config, readUrlState(window)));
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, [config, urlWin]);

  const navigate = useCallback((patch: Partial<KitNav>) => {
    const prev = navRef.current;
    const next = { ...prev, ...patch };
    navRef.current = next;
    setNav(next);
    if (urlWin) {
      const navParams = { mod: next.module, sec: next.item, view: next.view };
      // B-07: другой раздел/модуль — параметры прежнего раздела снимаются.
      const leaving = next.module !== prev.module || next.item !== prev.item;
      pushUrlState(leaving ? sectionScopedPatch(readUrlState(urlWin), navParams, keepParams) : navParams, { win: urlWin });
    }
    onNavigate?.(next);
  }, [keepParams, onNavigate, urlWin]);

  const openRecord = useCallback((id: string, meta?: { title?: string; href?: string }) => {
    let kept: string[] = [];
    setRecent(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, RECENT_LIMIT);
      storage.set(`${storageKey}.recent`, JSON.stringify(next));
      kept = next;
      return next;
    });
    setRecentMeta(prev => {
      // Помним только тех, кто остался в списке: иначе карта растёт без
      // предела, а старые имена переживают сами записи.
      const next: Record<string, RecentMeta> = {};
      for (const key of kept) {
        const was = prev[key] ?? {};
        const now = key === id ? { title: meta?.title ?? was.title, href: meta?.href ?? was.href } : was;
        if (now.title || now.href) next[key] = now;
      }
      storage.set(`${storageKey}.recentMeta`, JSON.stringify(next));
      return next;
    });
    onOpenRecord?.(id);
  }, [onOpenRecord, storage, storageKey]);

  const itemTitle = useCallback((id: string | null) => {
    for (const g of config.menu.groups) for (const i of g.items) if (i.id === id) return i.title;
    return id ?? '';
  }, [config]);

  const saveView = useCallback((title?: string) => {
    setViews(prev => {
      const cur = navRef.current;
      let n = prev.length + 1;
      while (prev.some(v => v.id === `view-${n}`)) n += 1;
      const view: KitSavedView = {
        ...cur,
        id: `view-${n}`,
        title: title?.trim() || kitT(lang, 'kit.shell.viewTitle', { item: itemTitle(cur.item), n }),
      };
      const next = [...prev, view];
      storage.set(`${storageKey}.views`, JSON.stringify(next));
      return next;
    });
  }, [itemTitle, lang, storage, storageKey]);

  const removeView = useCallback((id: string) => {
    setViews(prev => {
      const next = prev.filter(v => v.id !== id);
      storage.set(`${storageKey}.views`, JSON.stringify(next));
      return next;
    });
  }, [storage, storageKey]);

  const toggleGroup = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      storage.set(`${storageKey}.collapsed`, JSON.stringify(next));
      return next;
    });
  }, [storage, storageKey]);

  // Что видно на самом деле: чтение временно перебивает выбор, но не стирает его.
  const effMenuMode: KitMenuMode = readCollapsed ? 'hidden' : menuMode;
  const menuCollapsed = effMenuMode === 'hidden';

  const setMenuMode = useCallback((mode: KitMenuMode) => {
    setReadCollapsed(false);
    setMenuModeState(mode);
    storage.set(`${storageKey}.menuMode`, mode);
  }, [storage, storageKey]);

  const setMenuCollapsed = useCallback((collapsed: boolean) => {
    setReadCollapsed(collapsed);
  }, []);

  const api = useMemo<KitShellApi>(
    () => ({ nav, navigate, openRecord, recent, views, saveView, removeView, menuCollapsed, setMenuCollapsed, menuMode, setMenuMode, win: urlWin ?? null }),
    [nav, navigate, openRecord, recent, views, saveView, removeView, menuCollapsed, setMenuCollapsed, menuMode, setMenuMode, urlWin],
  );

  const activeModule = config.modules.find(m => m.id === nav.module) ?? config.modules[0];
  const titles = useMemo(() => {
    // Сначала запомненные при открытии, поверх — названия из данных экрана:
    // данные свежее, запомненное — то, что осталось от прошлых сеансов.
    const m = new Map<string, string>();
    for (const [id, meta] of Object.entries(recentMeta)) if (meta.title) m.set(id, meta.title);
    for (const r of data?.records ?? []) if (r.title) m.set(r.id, r.title);
    return m;
  }, [data, recentMeta]);

  /**
   * Адрес пункта меню — тот же, что запишет navigate (находка P1 аудита 08.11:
   * «пункты — кнопки, 0 <a href>»). Раздел и так живёт в URL, поэтому адрес не
   * придумывается, а берётся из той же логики: уход в другой раздел снимает
   * параметры прежнего (B-07) и якорь — это и есть «мусор place=…#SPRINT_…»,
   * который аудит нашёл после выхода из дока.
   */
  const itemHref = useCallback((id: string, view: string | null | undefined) => {
    if (!urlWin) return undefined;
    const navParams = { mod: nav.module, sec: id, view: view ?? null };
    const leaving = id !== nav.item;
    return leaving
      ? urlStateHref(urlWin, sectionScopedPatch(readUrlState(urlWin), navParams, keepParams), { anchor: null })
      : urlStateHref(urlWin, navParams);
  }, [keepParams, nav.item, nav.module, urlWin]);

  const menu = (onPick?: () => void, rail = false) => (
    <ShellMenu
      config={config}
      rail={rail}
      lang={lang}
      nav={nav}
      recent={recent}
      titles={titles}
      views={views}
      collapsed={collapsed}
      onToggleGroup={toggleGroup}
      onItem={(id, view) => { navigate({ item: id, view: view ?? null }); onPick?.(); }}
      onView={v => { navigate({ module: v.module, item: v.item, view: v.view }); onPick?.(); }}
      onRecent={id => { openRecord(id); onPick?.(); }}
      onSaveView={() => saveView()}
      onRemoveView={removeView}
      itemHref={itemHref}
      recordHref={id => recentMeta[id]?.href ?? recordHref?.(id)}
    />
  );

  // Кнопка модуля — одна на шапку и нижнюю панель телефона: имя, «скоро» и
  // текущий отмечаются одинаково, различается только раскладка.
  const moduleButton = (m: KitConfig['modules'][number], where: 'top' | 'dock') => {
    const planned = m.status === 'planned';
    const current = m.id === nav.module;
    const dock = where === 'dock';
    return (
      <button
        key={m.id}
        type="button"
        className={dock ? 'sk-shell__dock-item' : 'sk-shell__mod'}
        aria-label={planned ? `${m.title} · ${kitT(lang, 'kit.shell.planned')}` : m.title}
        aria-current={current ? 'page' : undefined}
        aria-disabled={planned ? true : undefined}
        title={planned ? kitT(lang, 'kit.shell.plannedHint') : m.title}
        onClick={() => { if (!planned && !current) navigate({ module: m.id }); }}
      >
        <GameIcon slug={m.icon} size={dock ? 18 : 15} />
        <span className={dock ? 'sk-shell__dock-label' : 'sk-shell__label'}>{m.title}</span>
        {planned && !dock && <span className="sk-shell__tag" aria-hidden="true">{kitT(lang, 'kit.shell.planned')}</span>}
      </button>
    );
  };

  return (
    <ShellContext.Provider value={api}>
      {/* Словарь статусов — всем, кто рисует статус (S4-STATUS-AXIS-CONFIG,
          слова владелицы 09.11: «статусную модель и иконки к ним по контракту
          несут они, а ты просто обрабатываешь»). Лента новостей и будущие виды
          получают данные своим источником, и конфиг до них не доходил — отсюда
          две правды об иконках статусов на проде v1.17.7. Провайдер здесь,
          потому что конфиг в руках у оболочки. */}
      <StatusDictCtx.Provider value={config.statuses.items}>
      <div className={[
        'sk-shell',
        narrow ? 'sk-shell--narrow' : '',
        !narrow && effMenuMode === 'hidden' ? 'sk-shell--menu-collapsed' : '',
        !narrow && effMenuMode === 'rail' ? 'sk-shell--menu-rail' : '',
      ].filter(Boolean).join(' ')}>
        <header className="sk-shell__top">
          <a className="sk-shell__skip" href={`#${mainId}`}>{kitT(lang, 'kit.shell.skip')}</a>
          {narrow && (
            <IconButton
              icon={ICON_CANON.ctlMenu}
              label={kitT(lang, 'kit.shell.menu')}
              aria-expanded={drawer}
              aria-haspopup="dialog"
              onClick={() => setDrawer(true)}
            />
          )}
          {/* S4-MENU-STATES: на узком экране меню и так в drawer — кнопка не нужна. */}
          {!narrow && (
            <IconButton
              icon={ICON_CANON.ctlMenu}
              label={menuModeLabel(lang, effMenuMode)}
              className="sk-shell__menu-toggle"
              onClick={() => setMenuMode(nextMenuMode(effMenuMode))}
            />
          )}
          <div className="sk-shell__brand">
            <GameIcon slug={brandIcon ?? activeModule?.icon} size={16} />
            <span className="sk-shell__brand-text">{brand ?? config.modules[0]?.title ?? ''}</span>
            {brandTag}
          </div>
          {/* На телефоне модули — нижней панелью (ниже), не в шапке:
              S4-MOBILE-COMPARE, замер 360 px — в шапке они выходили за край. */}
          {!narrow && (
            <nav className="sk-shell__mods" aria-label={kitT(lang, 'kit.shell.modules')}>
              {config.modules.map(m => moduleButton(m, 'top'))}
            </nav>
          )}
          {topStart && <div className="sk-shell__top-start">{topStart}</div>}
          {topEnd && <div className="sk-shell__top-end">{topEnd}</div>}
          {account && <div className="sk-shell__account">{account}</div>}
        </header>
        <div
          className="sk-shell__body"
          // Ширина — переменной, а не правкой сетки в CSS: трек один, а его
          // значение личное. Пока не тянули, переменной нет и работает
          // умолчание из seidr.css.
          style={{ '--side-w': `${sideW}px` } as CSSProperties}
        >
          {!narrow && !menuCollapsed && (
            <div className="sk-shell__side">
              {/* Сворачивание — в самой колонке и с видимой подписью: замечание
                  владелицы «до сих пор левое меню не имеет свойства к
                  сворачиванию». Кнопка была только в шапке, иконкой без
                  подписи, рядом с брендом — работала, но не находилась.
                  Подпись говорит, ЧТО СЛУЧИТСЯ по нажатию; в рейке её скрывает
                  то же правило, что прячет подписи пунктов. */}
              <button
                type="button"
                className="sk-shell__sidefold"
                onClick={() => setMenuMode(nextMenuMode(effMenuMode))}
              >
                <GameIcon slug={ICON_CANON.ctlMenu} size={13} />
                <span className="sk-shell__label">{menuModeLabel(lang, effMenuMode)}</span>
              </button>
              {menu(undefined, effMenuMode === 'rail')}
            </div>
          )}
          {/* Граница меню и содержимого (S4-30, слова владелицы 09.11: «левое,
              правое меню не имеет драг анд дроп мышкой»).
              Граница есть и у рейки: уточнение владелицы того же дня — «не
              только при полном развороте, это промежуточное состояние
              resizable состояния», и до этого рейку она «ни разу не получила»,
              потому что состояние жило только в кнопке-переключателе. Из рейки
              без границы не выбраться мышью, поэтому там она тоже нужна.
              У ушка колонки нет вовсе — туда возвращает само ушко. */}
          {!narrow && !menuCollapsed && (
            <ResizeBorder
              zone="shell.side"
              className="sk-shell__resize"
              size={effMenuMode === 'rail' ? SIDE_W.rail : sideW}
              // Минимум — ширина рейки, а не колонки: сжатая колонка с
              // обрезанными подписями не состояние, а поломка. Ниже порога
              // подписи честно исчезают, и остаётся рейка.
              min={SIDE_W.rail}
              max={SIDE_W.max}
              levels={{
                rail: SIDE_W.toRail,
                hide: SIDE_W.toHide,
                onLevel: level => {
                  // Возвращаясь из рейки, отдаём колонке читаемую ширину:
                  // иначе «раскрыть» даст колонку шириной иконки.
                  if (level === 'open' && sideW < SIDE_W.min) setSideW(SIDE_W.def);
                  setMenuMode(level);
                },
              }}
              store={storage}
              onSize={setSideW}
              label={kitT(lang, 'kit.shell.sideWidth')}
            />
          )}
          {!narrow && menuCollapsed && (
            <Ear
              side="left"
              className="sk-shell__ear"
              label={kitT(lang, 'kit.shell.menu')}
              expanded={false}
              // Убрано на время чтения — вернуть выбор; выбран hidden — раскрыть.
              onToggle={() => (readCollapsed ? setReadCollapsed(false) : setMenuMode('open'))}
            />
          )}
          <main id={mainId} className="sk-shell__main" tabIndex={-1}>
            <StorageBanner storage={storage} lang={lang} />
            {children}
          </main>
        </div>
        {/* Модули на телефоне — нижняя панель в зоне большого пальца, как в v1
            (SPRINT_LORE_MOBILE_UX/MOB-12; решение D-2026-UXR-MOBILE-FOLLOWS-V1).
            Иконка и короткая подпись под ней; текущий — aria-current. */}
        {narrow && (
          <nav className="sk-shell__dock" aria-label={kitT(lang, 'kit.shell.modules')}>
            {config.modules.map(m => moduleButton(m, 'dock'))}
          </nav>
        )}
        {narrow && (
          <Sheet open={drawer} onClose={() => setDrawer(false)} title={activeModule?.title ?? kitT(lang, 'kit.shell.menu')} side="left">
            {menu(() => setDrawer(false))}
          </Sheet>
        )}
      </div>
      </StatusDictCtx.Provider>
    </ShellContext.Provider>
  );
}

interface ShellMenuProps {
  config: KitConfig;
  /** Меню в состоянии рейки: подписей нет, личные блоки — кнопкой с меню. */
  rail?: boolean;
  lang: KitLang;
  nav: KitNav;
  recent: string[];
  titles: Map<string, string>;
  views: KitSavedView[];
  collapsed: string[];
  onToggleGroup: (id: string) => void;
  onItem: (id: string, view: string | undefined) => void;
  onView: (v: KitSavedView) => void;
  onRecent: (id: string) => void;
  onSaveView: () => void;
  onRemoveView: (id: string) => void;
  /** Адрес раздела/вида — пункт меню рисуется ссылкой (находка P1 аудита 08.11). */
  itemHref: (id: string, view: string | null | undefined) => string | undefined;
  /** Адрес записи для «Недавнего»; вернул undefined — пункт остаётся кнопкой. */
  recordHref?: (id: string) => string | undefined;
}

interface GroupProps {
  title: string;
  tone?: string;
  children: ReactNode | ((listId: string) => ReactNode);
  /** Задан — группа сворачивается: заголовок становится кнопкой-раскрывашкой (S4-01). */
  expanded?: boolean;
  onToggle?: () => void;
}

function Group({ title, tone, children, expanded, onToggle }: GroupProps) {
  const headId = useId();
  const listId = useId();
  const toneName = toneOf(tone);
  const collapsible = onToggle !== undefined;
  const cls = [
    'sk-shell__grp',
    toneName ? `sk-shell__grp--${toneName}` : '',
    collapsible && !expanded ? 'sk-shell__grp--collapsed' : '',
  ].filter(Boolean).join(' ');
  return (
    <section className={cls} aria-labelledby={headId} data-tone={tone}>
      <h2 id={headId} className="sk-shell__grp-title">
        {collapsible
          ? (
            <button
              type="button"
              className="sk-shell__grp-toggle"
              aria-expanded={expanded ? 'true' : 'false'}
              aria-controls={listId}
              onClick={onToggle}
            >
              <span className="sk-shell__caret" aria-hidden="true" />
              <span className="sk-shell__label">{title}</span>
            </button>
          )
          : title}
      </h2>
      {typeof children === 'function' ? children(listId) : children}
    </section>
  );
}

function ShellMenu({
  config, rail, lang, nav, recent, titles, views, collapsed, onToggleGroup, onItem, onView, onRecent, onSaveView, onRemoveView,
  itemHref, recordHref,
}: ShellMenuProps) {
  // Раскрыты ли все виды (S9-12). Местное: это способ дотянуться до своего
  // вида, а не состояние, которым делятся ссылкой.
  const [allViews, setAllViews] = useState(false);
  const { groups, myViews, recent: showRecent } = config.menu;
  // S4-MENU-STATES, слова владелицы 09.11 с прода: «новости должны стоять до
  // моих видов и недавних и при сворачивании левого меню». Какая группа идёт
  // первой, называет ПРИЛОЖЕНИЕ (`pinTop`): kit не знает, что «новости»
  // важнее личных блоков, и знать не должен (K-14).
  const pinned = groups.filter(g => g.pinTop);
  const rest = groups.filter(g => !g.pinTop);
  const groupBlock = (g: (typeof groups)[number]) => {
    const expanded = !collapsed.includes(g.id);
    // Свёрнутая группа прячет пункты, кроме текущего: «где я» видно всегда.
    const shown = expanded ? g.items : g.items.filter(i => i.id === nav.item);
    return (
      <Group key={g.id} title={g.title} tone={g.tone} expanded={expanded} onToggle={() => onToggleGroup(g.id)}>
        {listId => (
          <ul id={listId} className="sk-shell__list">
            {shown.map(i => (
              <li key={i.id}>
                <a
                  className="sk-shell__item"
                  href={itemHref(i.id, i.view) ?? '#'}
                  aria-current={i.id === nav.item ? 'page' : undefined}
                  // В рейке подписи скрыты правилом CSS, поэтому имя действия
                  // переносится в aria-label и подсказку: иначе пункт для
                  // скринридера и для мыши остаётся безымянным значком.
                  {...(rail ? { 'aria-label': i.title, title: i.title } : {})}
                  onClick={navClick(() => onItem(i.id, i.view))}
                >
                  {i.icon && <GameIcon slug={i.icon} size={14} />}
                  <span className="sk-shell__label">{i.title}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Group>
    );
  };
  /**
   * Личный блок в рейке — ОДНА кнопка с меню.
   *
   * Слова владелицы 09.11: «недавние должны быть кнопкой с меню, а не кучей
   * непонятных значков». В рейке подписи скрыты общим правилом, и список
   * недавних превращался в столбик одинаковых значков: пять записей выглядят
   * как пять одинаковых кнопок, выбрать нельзя — возможность есть, а
   * пользоваться нечем. Поэтому в рейке список складывается в кнопку, а
   * записи показываются с НАЗВАНИЯМИ.
   */
  const railBlock = (title: string, icon: string, children: ReactNode) => (
    <RailMenu title={title} icon={icon}>{children}</RailMenu>
  );
  /**
   * Блок меню: в рейке — кнопка с меню, иначе прежняя группа.
   *
   * Одним приёмом на «Мои виды» и «Недавние»: «куча непонятных значков» была у
   * обоих, и два разных лечения дали бы два разных поведения — то самое, из-за
   * чего границы зон пришлось сводить в один механизм.
   */
  const personal = (title: string, icon: string, body: ReactNode) =>
    (rail ? railBlock(title, icon, body) : <Group title={title}>{body}</Group>);
  return (
    <nav className="sk-shell__side-nav" aria-label={kitT(lang, 'kit.shell.sections')}>
      {pinned.map(groupBlock)}
      {myViews && personal(kitT(lang, 'kit.shell.myViews'), ICON_CANON.myViews, (
        <>
          {views.length === 0 && <p className="sk-shell__note">{kitT(lang, 'kit.shell.myViewsEmpty')}</p>}
          <ul className="sk-shell__list">
            {(allViews ? views : views.slice(0, PINNED_VIEWS)).map(v => (
              <li key={v.id} className="sk-shell__row">
                <a
                  className="sk-shell__item"
                  href={itemHref(v.item ?? '', v.view) ?? '#'}
                  aria-current={v.module === nav.module && v.item === nav.item && v.view === nav.view ? 'true' : undefined}
                  onClick={navClick(() => onView(v))}
                >
                  <GameIcon slug={ICON_CANON.myViews} size={14} />
                  <span className="sk-shell__label">{v.title}</span>
                </a>
                <IconButton
                  icon="cross-mark"
                  iconSize={12}
                  label={kitT(lang, 'kit.shell.removeView', { title: v.title })}
                  onClick={() => onRemoveView(v.id)}
                />
              </li>
            ))}
            {views.length > PINNED_VIEWS && (
              <li>
                <button
                  type="button"
                  className="sk-shell__item sk-shell__item--action sk-shell__viewsmore"
                  aria-expanded={allViews}
                  onClick={() => setAllViews(v => !v)}
                >
                  <GameIcon slug={ICON_CANON.myViews} size={14} />
                  <span className="sk-shell__label">
                    {allViews
                      ? kitT(lang, 'kit.shell.viewsLess')
                      : kitT(lang, 'kit.shell.viewsAll', { n: views.length - PINNED_VIEWS })}
                  </span>
                </button>
              </li>
            )}
            <li>
              <button type="button" className="sk-shell__item sk-shell__item--action" onClick={onSaveView}>
                <GameIcon slug={ICON_CANON.saveView} size={14} />
                <span className="sk-shell__label">{kitT(lang, 'kit.shell.saveView')}</span>
              </button>
            </li>
          </ul>
        </>
      ))}
      {showRecent && personal(kitT(lang, 'kit.shell.recent'), ICON_CANON.recent, (
        <>
          {recent.length === 0 && <p className="sk-shell__note">{kitT(lang, 'kit.shell.recentEmpty')}</p>}
          <ul className="sk-shell__list">
            {recent.map(id => {
              const title = titles.get(id);
              // Адрес есть — ссылка; нет — кнопка. Поддельную ссылку («#») не
              // рисуем: она обещает путь, которого нет.
              const href = recordHref?.(id);
              return (
                <li key={id}>
                  {/* Ссылка — только когда приложение дало адрес записи; иначе кнопка. */}
                  {href
                    ? (
                      <a className="sk-shell__item" href={href} onClick={navClick(() => onRecent(id))}>
                        <GameIcon slug={ICON_CANON.recent} size={14} />
                        <span className="sk-shell__label">
                          {title ?? <span className="sk-shell__id">{id}</span>}
                        </span>
                        {title
                          ? <span className="sk-shell__id">{id}</span>
                          : <span className="sk-shell__tag">{kitT(lang, 'kit.shell.recentMissing')}</span>}
                      </a>
                    )
                    : (
                      <button type="button" className="sk-shell__item" onClick={() => onRecent(id)}>
                        <GameIcon slug={ICON_CANON.recent} size={14} />
                        <span className="sk-shell__label">
                          {title ?? <span className="sk-shell__id">{id}</span>}
                        </span>
                        {title
                          ? <span className="sk-shell__id">{id}</span>
                          : <span className="sk-shell__tag">{kitT(lang, 'kit.shell.recentMissing')}</span>}
                      </button>
                    )}
                </li>
              );
            })}
          </ul>
        </>
      ))}
      {groups.length === 0 && <p className="sk-shell__note">{kitT(lang, 'kit.shell.menuEmpty')}</p>}
      {rest.map(groupBlock)}
    </nav>
  );
}

/**
 * Личный блок меню в рейке: кнопка, открывающая меню со НАЗВАНИЯМИ.
 *
 * Слова владелицы 09.11.2026 с прода: «недавние должны быть кнопкой с меню, а
 * не кучей непонятных значков».
 *
 * Оболочка всплывашки — общий Popover (S4-MENU-STATES, долг закрыт): Esc,
 * щелчок вне, ловушка фокуса, возврат фокуса на кнопку рейки, стрелки и край
 * экрана живут там, одним правилом на все три меню kit. Своей копии Esc и
 * щелчка-мимо здесь больше нет; ловушки фокуса и стрелок тут не было вовсе.
 */
function RailMenu({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const popId = `${useId()}-railmenu`;
  return (
    <div className="sk-shell__railmenu">
      <button
        type="button"
        className="sk-shell__item sk-shell__railmenu-btn"
        aria-label={title}
        title={title}
        aria-expanded={open}
        aria-haspopup="menu"
        // Связь названа: по ней общий поповер узнаёт СВОЙ открыватель и не
        // считает щелчок по нему «щелчком вне» (иначе кнопка-переключатель
        // закрывала бы меню по mousedown и тут же открывала по click).
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen(o => !o)}
      >
        <GameIcon slug={icon} size={14} />
      </button>
      {open && (
        // role="group", а не "menu": внутри ССЫЛКИ на записи и виды, а меню по
        // ARIA обязано содержать menuitem. Объявить меню и положить внутрь
        // ссылки значит соврать скринридеру о том, что это за элемент — и
        // отнять у ссылок их поведение (новая вкладка, копировать адрес).
        // Поэтому и стрелки тут ходят по фокусируемому, а не по menuitem.
        <Popover
          id={popId}
          role="group"
          label={title}
          align="side"
          walk="focusable"
          className="sk-shell__railmenu-pop"
          onClose={() => setOpen(false)}
        >
          <p className="sk-shell__railmenu-head">{title}</p>
          <div className="sk-shell__railmenu-body" onClick={() => setOpen(false)}>{children}</div>
        </Popover>
      )}
    </div>
  );
}
