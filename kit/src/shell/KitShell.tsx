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
}

export interface KitShellProps {
  config: KitConfig;
  /** Данные — для подписей «Недавних» (заголовок записи по id). */
  data?: KitData;
  /** Имя приложения в шапке; по умолчанию — заголовок первого модуля. */
  brand?: string;
  brandIcon?: string;
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

const ShellContext = createContext<KitShellApi | null>(null);

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

function useNarrow(force: boolean | undefined): boolean {
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
  config, data, brand, brandIcon, storage: storageProp, storageKey = 'seidr-kit', win, narrow: narrowProp,
  onNavigate, onOpenRecord, keepParams, children,
}: KitShellProps) {
  const lang = useKitLang();
  const urlWin = win ?? (typeof window !== 'undefined' ? window : undefined);
  const storage = useMemo(() => storageProp ?? createSafeStorage(), [storageProp]);
  const narrow = useNarrow(narrowProp);
  const mainId = useId();

  const [nav, setNav] = useState<KitNav>(() => resolveNav(config, urlWin ? readUrlState(urlWin) : new URLSearchParams()));
  const [recent, setRecent] = useState<string[]>(() => readList<string>(storage, `${storageKey}.recent`));
  const [views, setViews] = useState<KitSavedView[]>(() => readList<KitSavedView>(storage, `${storageKey}.views`));
  const [drawer, setDrawer] = useState(false);
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

  const api = useMemo<KitShellApi>(
    () => ({ nav, navigate, openRecord, recent, views, saveView, removeView }),
    [nav, navigate, openRecord, recent, views, saveView, removeView],
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
      onItem={(id, view) => { navigate({ item: id, view: view ?? null }); onPick?.(); }}
      onView={v => { navigate({ module: v.module, item: v.item, view: v.view }); onPick?.(); }}
      onRecent={id => { openRecord(id); onPick?.(); }}
      onSaveView={() => saveView()}
      onRemoveView={removeView}
    />
  );

  return (
    <ShellContext.Provider value={api}>
      <div className={['sk-shell', narrow ? 'sk-shell--narrow' : ''].filter(Boolean).join(' ')}>
        <header className="sk-shell__top">
          <a className="sk-shell__skip" href={`#${mainId}`}>{kitT(lang, 'kit.shell.skip')}</a>
          {narrow && (
            <IconButton
              icon="hamburger-menu"
              label={kitT(lang, 'kit.shell.menu')}
              aria-expanded={drawer}
              aria-haspopup="dialog"
              onClick={() => setDrawer(true)}
            />
          )}
          <div className="sk-shell__brand">
            <GameIcon slug={brandIcon ?? activeModule?.icon} size={16} />
            <span className="sk-shell__brand-text">{brand ?? config.modules[0]?.title ?? ''}</span>
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
        </header>
        <div className="sk-shell__body">
          {!narrow && <div className="sk-shell__side">{menu()}</div>}
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
  onItem: (id: string, view: string | undefined) => void;
  onView: (v: KitSavedView) => void;
  onRecent: (id: string) => void;
  onSaveView: () => void;
  onRemoveView: (id: string) => void;
}

function Group({ title, tone, children }: { title: string; tone?: string; children: ReactNode }) {
  const headId = useId();
  const cls = ['sk-shell__grp', tone && TONES.has(tone) ? `sk-shell__grp--${tone}` : ''].filter(Boolean).join(' ');
  return (
    <section className={cls} aria-labelledby={headId} data-tone={tone}>
      <h2 id={headId} className="sk-shell__grp-title">{title}</h2>
      {children}
    </section>
  );
}

function ShellMenu({ config, lang, nav, recent, titles, views, onItem, onView, onRecent, onSaveView, onRemoveView }: ShellMenuProps) {
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
                  <GameIcon slug="round-star" size={14} />
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
                <GameIcon slug="save" size={14} />
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
                    <GameIcon slug="back-forth" size={14} />
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
      {groups.map(g => (
        <Group key={g.id} title={g.title} tone={g.tone}>
          <ul className="sk-shell__list">
            {g.items.map(i => (
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
        </Group>
      ))}
    </nav>
  );
}
