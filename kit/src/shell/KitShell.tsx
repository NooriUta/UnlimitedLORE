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
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { KitConfig, KitData } from '../core/contract';
import { GameIcon } from '../elements/GameIcon';
import { IconButton } from '../elements/IconButton';
import { kitT, useKitLang } from '../i18n';
import type { KitLang } from '../i18n';
import { createSafeStorage } from '../resilience/safeStorage';
import type { SafeStorage } from '../resilience/safeStorage';
import { StorageBanner } from '../resilience/StorageBanner';
import { pushUrlState, readUrlState, sectionScopedPatch } from '../resilience/urlState';
import type { UrlWindow } from '../resilience/urlState';
import { Sheet } from './Sheet';
import { Ear } from './Ear';

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

export interface KitShellApi {
  nav: KitNav;
  navigate: (patch: Partial<KitNav>) => void;
  /** Открыть запись: попадает в «Недавние», уходит в onOpenRecord. */
  openRecord: (id: string) => void;
  recent: string[];
  views: KitSavedView[];
  saveView: (title?: string) => void;
  removeView: (id: string) => void;
  /** Меню свёрнуто в ушко (режим чтения, S5-05 · D-2026-UXR-READ-COLLAPSE). */
  menuCollapsed: boolean;
  /** Стабильная ссылка: свернуть/раскрыть меню (на узком экране меню и так в drawer). */
  setMenuCollapsed: (collapsed: boolean) => void;
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

const NARROW_QUERY = '(max-width: 720px)';
const RECENT_LIMIT = 8;
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
 * Узкий экран (телефон, ≤720px) — один порог на весь kit: оболочка уводит меню
 * в drawer, выбор проектов (S4-03) — в лист снизу. force задан — без matchMedia.
 */
export function useNarrow(force?: boolean): boolean {
  const [matches, setMatches] = useState(() => {
    if (force !== undefined || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(NARROW_QUERY).matches;
  });
  useEffect(() => {
    if (force !== undefined || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(NARROW_QUERY);
    setMatches(mql.matches);
    const onChange = (e: { matches: boolean }) => setMatches(e.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [force]);
  return force ?? matches;
}

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
  onNavigate, onOpenRecord, topStart, topEnd, account, keepParams, children,
}: KitShellProps) {
  const lang = useKitLang();
  const urlWin = win ?? (typeof window !== 'undefined' ? window : undefined);
  const storage = useMemo(() => storageProp ?? createSafeStorage(), [storageProp]);
  const narrow = useNarrow(narrowProp);
  const mainId = useId();

  const [nav, setNav] = useState<KitNav>(() => resolveNav(config, urlWin ? readUrlState(urlWin) : new URLSearchParams()));
  const [recent, setRecent] = useState<string[]>(() => readList<string>(storage, `${storageKey}.recent`));
  const [views, setViews] = useState<KitSavedView[]>(() => readList<KitSavedView>(storage, `${storageKey}.views`));
  // S4-01: свёрнутые группы меню — id групп; переживают перезагрузку.
  const [collapsed, setCollapsed] = useState<string[]>(() => readList<string>(storage, `${storageKey}.collapsed`));
  const [drawer, setDrawer] = useState(false);
  const [menuCollapsed, setMenuCollapsed] = useState(false);
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

  const openRecord = useCallback((id: string) => {
    setRecent(prev => {
      const next = [id, ...prev.filter(x => x !== id)].slice(0, RECENT_LIMIT);
      storage.set(`${storageKey}.recent`, JSON.stringify(next));
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

  const api = useMemo<KitShellApi>(
    () => ({ nav, navigate, openRecord, recent, views, saveView, removeView, menuCollapsed, setMenuCollapsed }),
    [nav, navigate, openRecord, recent, views, saveView, removeView, menuCollapsed],
  );

  const activeModule = config.modules.find(m => m.id === nav.module) ?? config.modules[0];
  const titles = useMemo(() => new Map((data?.records ?? []).map(r => [r.id, r.title])), [data]);

  const menu = (onPick?: () => void) => (
    <ShellMenu
      config={config}
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
    />
  );

  return (
    <ShellContext.Provider value={api}>
      <div className={['sk-shell', narrow ? 'sk-shell--narrow' : '', !narrow && menuCollapsed ? 'sk-shell--menu-collapsed' : ''].filter(Boolean).join(' ')}>
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
          <div className="sk-shell__brand">
            <GameIcon slug={brandIcon ?? activeModule?.icon} size={16} />
            <span className="sk-shell__brand-text">{brand ?? config.modules[0]?.title ?? ''}</span>
            {brandTag}
          </div>
          <nav className="sk-shell__mods" aria-label={kitT(lang, 'kit.shell.modules')}>
            {config.modules.map(m => {
              const planned = m.status === 'planned';
              const current = m.id === nav.module;
              return (
                <button
                  key={m.id}
                  type="button"
                  className="sk-shell__mod"
                  aria-label={planned ? `${m.title} · ${kitT(lang, 'kit.shell.planned')}` : m.title}
                  aria-current={current ? 'page' : undefined}
                  aria-disabled={planned ? true : undefined}
                  title={planned ? kitT(lang, 'kit.shell.plannedHint') : m.title}
                  onClick={() => { if (!planned && !current) navigate({ module: m.id }); }}
                >
                  <GameIcon slug={m.icon} size={15} />
                  <span className="sk-shell__label">{m.title}</span>
                  {planned && <span className="sk-shell__tag" aria-hidden="true">{kitT(lang, 'kit.shell.planned')}</span>}
                </button>
              );
            })}
          </nav>
          {topStart && <div className="sk-shell__top-start">{topStart}</div>}
          {topEnd && <div className="sk-shell__top-end">{topEnd}</div>}
          {account && <div className="sk-shell__account">{account}</div>}
        </header>
        <div className="sk-shell__body">
          {!narrow && !menuCollapsed && <div className="sk-shell__side">{menu()}</div>}
          {!narrow && menuCollapsed && (
            <Ear
              side="left"
              className="sk-shell__ear"
              label={kitT(lang, 'kit.shell.menu')}
              expanded={false}
              onToggle={() => setMenuCollapsed(false)}
            />
          )}
          <main id={mainId} className="sk-shell__main" tabIndex={-1}>
            <StorageBanner storage={storage} lang={lang} />
            {children}
          </main>
        </div>
        {narrow && (
          <Sheet open={drawer} onClose={() => setDrawer(false)} title={activeModule?.title ?? kitT(lang, 'kit.shell.menu')} side="left">
            {menu(() => setDrawer(false))}
          </Sheet>
        )}
      </div>
    </ShellContext.Provider>
  );
}

interface ShellMenuProps {
  config: KitConfig;
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
  config, lang, nav, recent, titles, views, collapsed, onToggleGroup, onItem, onView, onRecent, onSaveView, onRemoveView,
}: ShellMenuProps) {
  const { groups, myViews, recent: showRecent } = config.menu;
  return (
    <nav className="sk-shell__side-nav" aria-label={kitT(lang, 'kit.shell.sections')}>
      {myViews && (
        <Group title={kitT(lang, 'kit.shell.myViews')}>
          {views.length === 0 && <p className="sk-shell__note">{kitT(lang, 'kit.shell.myViewsEmpty')}</p>}
          <ul className="sk-shell__list">
            {views.map(v => (
              <li key={v.id} className="sk-shell__row">
                <button
                  type="button"
                  className="sk-shell__item"
                  aria-current={v.module === nav.module && v.item === nav.item && v.view === nav.view ? 'true' : undefined}
                  onClick={() => onView(v)}
                >
                  <GameIcon slug={ICON_CANON.myViews} size={14} />
                  <span className="sk-shell__label">{v.title}</span>
                </button>
                <IconButton
                  icon="cross-mark"
                  iconSize={12}
                  label={kitT(lang, 'kit.shell.removeView', { title: v.title })}
                  onClick={() => onRemoveView(v.id)}
                />
              </li>
            ))}
            <li>
              <button type="button" className="sk-shell__item sk-shell__item--action" onClick={onSaveView}>
                <GameIcon slug={ICON_CANON.saveView} size={14} />
                <span className="sk-shell__label">{kitT(lang, 'kit.shell.saveView')}</span>
              </button>
            </li>
          </ul>
        </Group>
      )}
      {showRecent && (
        <Group title={kitT(lang, 'kit.shell.recent')}>
          {recent.length === 0 && <p className="sk-shell__note">{kitT(lang, 'kit.shell.recentEmpty')}</p>}
          <ul className="sk-shell__list">
            {recent.map(id => {
              const title = titles.get(id);
              return (
                <li key={id}>
                  <button type="button" className="sk-shell__item" onClick={() => onRecent(id)}>
                    <GameIcon slug={ICON_CANON.recent} size={14} />
                    <span className="sk-shell__label">
                      {title ?? <span className="sk-shell__id">{id}</span>}
                    </span>
                    {title
                      ? <span className="sk-shell__id">{id}</span>
                      : <span className="sk-shell__tag">{kitT(lang, 'kit.shell.recentMissing')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </Group>
      )}
      {groups.length === 0 && <p className="sk-shell__note">{kitT(lang, 'kit.shell.menuEmpty')}</p>}
      {groups.map(g => {
        const expanded = !collapsed.includes(g.id);
        // Свёрнутая группа прячет пункты, кроме текущего: «где я» видно всегда.
        const shown = expanded ? g.items : g.items.filter(i => i.id === nav.item);
        return (
        <Group key={g.id} title={g.title} tone={g.tone} expanded={expanded} onToggle={() => onToggleGroup(g.id)}>
          {listId => (
          <ul id={listId} className="sk-shell__list">
            {shown.map(i => (
              <li key={i.id}>
                <button
                  type="button"
                  className="sk-shell__item"
                  aria-current={i.id === nav.item ? 'page' : undefined}
                  onClick={() => onItem(i.id, i.view)}
                >
                  {i.icon && <GameIcon slug={i.icon} size={14} />}
                  <span className="sk-shell__label">{i.title}</span>
                </button>
              </li>
            ))}
          </ul>
          )}
        </Group>
        );
      })}
    </nav>
  );
}
